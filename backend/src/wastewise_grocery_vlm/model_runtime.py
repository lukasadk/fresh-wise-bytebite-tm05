import hashlib
import importlib.util
import json
import threading
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any, Protocol

from PIL import Image

from .config import Settings, get_settings
from .hardware import HardwareSnapshot, choose_model_profile, detect_hardware
from .prompting import structured_recovery_prompt


class ModelLoadError(RuntimeError):
    pass


class VisionBackend(Protocol):
    model_id: str

    def generate(self, image: Image.Image, prompt: str, max_new_tokens: int) -> str: ...


@dataclass
class RuntimeState:
    model_loaded: bool = False
    selected_model: str | None = None
    attempted_models: list[str] = field(default_factory=list)
    last_error: str | None = None


class MockVisionBackend:
    """Deterministic backend for API smoke tests only; never an evaluator."""

    model_id = "test/mock-grocery-vlm"

    def generate(self, image: Image.Image, prompt: str, max_new_tokens: int) -> str:
        del image, prompt, max_new_tokens
        return json.dumps(
            {
                "items": [
                    {
                        "food_name": "Apple",
                        "brand": None,
                        "product_variant": "green",
                        "net_content_text": None,
                        "category": "fruit",
                        "quantity": 2,
                        "unit": "piece",
                        "confidence": 0.91,
                        "review_required": False,
                        "packaging_text_evidence": [],
                    },
                    {
                        "food_name": "Possibly milk",
                        "brand": None,
                        "product_variant": None,
                        "net_content_text": None,
                        "category": "dairy",
                        "quantity": None,
                        "unit": "carton",
                        "confidence": 0.48,
                        "review_required": True,
                        "packaging_text_evidence": ["MILK"],
                    },
                ]
            },
            ensure_ascii=False,
        )


class Qwen3VLBackend:
    def __init__(self, model_id: str, processor: Any, model: Any, torch_module: Any):
        self.model_id = model_id
        self.processor = processor
        self.model = model
        self.torch = torch_module

    @classmethod
    def load(cls, profile: dict[str, Any]) -> "Qwen3VLBackend":
        if profile.get("quantization") == "nf4" and importlib.util.find_spec("bitsandbytes") is None:
            raise ModelLoadError(
                "bitsandbytes is required for the configured 4-bit NF4 model. "
                "Install requirements-model.txt before loading Qwen3-VL-4B."
            )
        project_root = Path(__file__).resolve().parents[2]
        configured_adapter_path = profile.get("adapter_path")
        adapter_source: Path | None = None
        peft_model_class: Any | None = None
        if configured_adapter_path:
            adapter_source = Path(str(configured_adapter_path))
            if not adapter_source.is_absolute():
                adapter_source = project_root / adapter_source
            if not adapter_source.is_dir():
                raise ModelLoadError(
                    f"Configured frozen adapter directory does not exist: {adapter_source}"
                )
            adapter_weights = adapter_source / "adapter_model.safetensors"
            if not adapter_weights.is_file():
                raise ModelLoadError(f"Frozen adapter weights are missing: {adapter_weights}")
            expected_hash = str(profile.get("adapter_sha256") or "").strip().lower()
            if expected_hash:
                digest = hashlib.sha256()
                with adapter_weights.open("rb") as handle:
                    for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                        digest.update(chunk)
                observed_hash = digest.hexdigest()
                if observed_hash != expected_hash:
                    raise ModelLoadError(
                        "Frozen adapter SHA-256 mismatch: "
                        f"expected {expected_hash}, observed {observed_hash}."
                    )
            if importlib.util.find_spec("peft") is None:
                raise ModelLoadError(
                    "peft is required for the configured frozen QLoRA adapter. "
                    "Install requirements-model.txt."
                )
        try:
            import torch
            from transformers import AutoProcessor, BitsAndBytesConfig, Qwen3VLForConditionalGeneration
            if adapter_source is not None:
                from peft import PeftModel

                peft_model_class = PeftModel
        except ImportError as exc:
            raise ModelLoadError(
                "Model dependencies are not installed. Install requirements-model.txt."
            ) from exc

        model_id = str(profile["model_id"])
        configured_local_path = profile.get("local_path")
        if configured_local_path:
            model_source = project_root / str(configured_local_path)
            if not model_source.is_dir():
                raise ModelLoadError(
                    f"Configured local model directory does not exist: {model_source}"
                )
            pretrained_source = str(model_source)
        else:
            pretrained_source = model_id
        load_kwargs: dict[str, Any] = {
            "device_map": "auto",
            "low_cpu_mem_usage": True,
        }
        if profile.get("quantization") == "nf4":
            compute_dtype = (
                torch.bfloat16
                if torch.cuda.is_available() and torch.cuda.is_bf16_supported()
                else torch.float16
            )
            load_kwargs["quantization_config"] = BitsAndBytesConfig(
                load_in_4bit=True,
                bnb_4bit_quant_type="nf4",
                bnb_4bit_use_double_quant=True,
                bnb_4bit_compute_dtype=compute_dtype,
            )

        try:
            processor = AutoProcessor.from_pretrained(pretrained_source)
            model = Qwen3VLForConditionalGeneration.from_pretrained(
                pretrained_source, **load_kwargs
            )
            if adapter_source is not None:
                model = peft_model_class.from_pretrained(
                    model,
                    str(adapter_source),
                    is_trainable=False,
                )
                model_id = f"{model_id} + {adapter_source.name}"
            model.eval()
        except Exception as exc:  # external library/download errors need API-safe wrapping
            raise ModelLoadError(f"Failed to load {model_id}: {exc}") from exc
        return cls(model_id=model_id, processor=processor, model=model, torch_module=torch)

    def generate(self, image: Image.Image, prompt: str, max_new_tokens: int) -> str:
        messages = [
            {
                "role": "user",
                "content": [
                    {"type": "image", "image": image},
                    {"type": "text", "text": prompt},
                ],
            }
        ]
        inputs = self.processor.apply_chat_template(
            messages,
            add_generation_prompt=True,
            tokenize=True,
            return_dict=True,
            return_tensors="pt",
        )
        inputs = inputs.to(self.model.device)
        input_length = inputs["input_ids"].shape[-1]
        with self.torch.inference_mode():
            generated = self.model.generate(
                **inputs,
                max_new_tokens=max_new_tokens,
                do_sample=False,
            )
        generated_only = generated[:, input_length:]
        return self.processor.batch_decode(
            generated_only,
            skip_special_tokens=True,
            clean_up_tokenization_spaces=False,
        )[0]


class ModelRuntime:
    """Thread-safe, process-local singleton wrapper around one 4B model instance."""

    def __init__(self, settings: Settings):
        self.settings = settings
        self.hardware: HardwareSnapshot = detect_hardware()
        self.profile = choose_model_profile(settings.model_profiles_path, self.hardware)
        self.state = RuntimeState()
        self._backend: VisionBackend | None = None
        self._load_lock = threading.Lock()
        self._generation_lock = threading.Lock()

    @property
    def loaded(self) -> bool:
        return self._backend is not None

    def ensure_loaded(self) -> None:
        if self._backend is not None:
            return
        with self._load_lock:
            if self._backend is not None:
                return
            model_id = (
                MockVisionBackend.model_id
                if self.settings.backend == "mock"
                else str(self.profile["model_id"])
            )
            self.state.attempted_models.append(model_id)
            try:
                if self.settings.backend == "mock":
                    backend: VisionBackend = MockVisionBackend()
                else:
                    if not self.profile.get("hardware_suitable", False):
                        raise ModelLoadError(
                            "The configured 4B profile does not meet its conservative hardware threshold. "
                            "No smaller fallback is enabled."
                        )
                    backend = Qwen3VLBackend.load(self.profile)
                self._backend = backend
                self.state.model_loaded = True
                self.state.selected_model = backend.model_id
                self.state.last_error = None
            except Exception as exc:
                self.state.last_error = str(exc)
                raise

    def generate(self, image: Image.Image, recovery: bool = False) -> tuple[str, str]:
        self.ensure_loaded()
        if self._backend is None:
            raise ModelLoadError("Model backend was not initialized.")
        prompt = Path(self.settings.prompt_path).read_text(encoding="utf-8")
        if recovery:
            prompt = structured_recovery_prompt(prompt, self.settings.max_recognized_items)
        with self._generation_lock:
            output = self._backend.generate(image, prompt, self.settings.max_new_tokens)
        return output, self._backend.model_id


@lru_cache(maxsize=1)
def get_model_runtime() -> ModelRuntime:
    return ModelRuntime(get_settings())
