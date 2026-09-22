"""OpenAI-compatible multimodal API backend.

The endpoint, model name and optional bearer token are server-side settings.
Recognition requests never accept credentials or arbitrary upstream URLs, so a
public upload route cannot be turned into a credential leak or SSRF proxy.
"""

from __future__ import annotations

import base64
import json
from functools import lru_cache
from io import BytesIO
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit, urlunsplit

import httpx
from PIL import Image

from .config import API_CONFIG_PATH, PROJECT_ROOT, Settings, get_settings
from .prompting import structured_recovery_prompt
from .schemas import APIRecognitionConfigResponse


class APIRecognitionError(RuntimeError):
    """Base class for failures in the external recognition provider."""


class APIRecognitionNotConfiguredError(APIRecognitionError):
    pass


class APIRecognitionTimeoutError(APIRecognitionError):
    pass


def _chat_completions_url(base_url: str) -> str:
    value = base_url.strip()
    if not value:
        raise APIRecognitionNotConfiguredError("WW_API_BASE_URL is empty.")
    parsed = urlsplit(value)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise APIRecognitionNotConfiguredError(
            "WW_API_BASE_URL must be an absolute http:// or https:// URL."
        )
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise APIRecognitionNotConfiguredError(
            "WW_API_BASE_URL must not contain credentials, a query, or a fragment."
        )
    path = parsed.path.rstrip("/")
    if not path.endswith("/chat/completions"):
        path = f"{path}/chat/completions"
    return urlunsplit((parsed.scheme, parsed.netloc, path, "", ""))


def _display_prompt_path(path: Path) -> str:
    try:
        return str(path.resolve().relative_to(PROJECT_ROOT.resolve())).replace("\\", "/")
    except ValueError:
        return str(path)


def api_recognition_status(settings: Settings | None = None) -> APIRecognitionConfigResponse:
    settings = settings or get_settings()
    error: str | None = None
    normalized_url: str | None = None
    model = (settings.api_model or "").strip() or None
    api_key_configured = bool(
        settings.api_key and settings.api_key.get_secret_value().strip()
    )
    try:
        if settings.api_base_url:
            normalized_url = _chat_completions_url(settings.api_base_url)
        else:
            error = "Set WW_API_BASE_URL."
        if model is None:
            error = f"{error} Set WW_API_MODEL." if error else "Set WW_API_MODEL."
        if settings.api_key_required and not api_key_configured:
            message = "Set WW_API_KEY in the server environment."
            error = f"{error} {message}" if error else message
        if not settings.api_prompt_path.is_file():
            message = f"Prompt file not found: {settings.api_prompt_path}"
            error = f"{error} {message}" if error else message
        if not settings.api_receipt_prompt_path.is_file():
            message = f"Receipt prompt file not found: {settings.api_receipt_prompt_path}"
            error = f"{error} {message}" if error else message
    except APIRecognitionNotConfiguredError as exc:
        error = str(exc)

    return APIRecognitionConfigResponse(
        enabled=error is None,
        base_url=normalized_url,
        model=model,
        api_key_required=settings.api_key_required,
        api_key_configured=api_key_configured,
        json_mode=settings.api_json_mode,
        prompt_file=_display_prompt_path(settings.api_prompt_path),
        prompt_loaded=settings.api_prompt_path.is_file(),
        receipt_prompt_file=_display_prompt_path(settings.api_receipt_prompt_path),
        receipt_prompt_loaded=settings.api_receipt_prompt_path.is_file(),
        config_file=_display_prompt_path(API_CONFIG_PATH),
        config_loaded=API_CONFIG_PATH.is_file(),
        timeout_seconds=settings.api_timeout_seconds,
        image_max_edge=settings.api_image_max_edge,
        max_tokens=settings.api_max_tokens,
        configuration_error=error,
    )


class OpenAICompatibleVisionBackend:
    """Calls one configured OpenAI-compatible chat-completions vision API."""

    def __init__(
        self,
        settings: Settings,
        *,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        status = api_recognition_status(settings)
        if not status.enabled or status.base_url is None or status.model is None:
            raise APIRecognitionNotConfiguredError(
                status.configuration_error or "External recognition API is not configured."
            )
        self.settings = settings
        self.endpoint = status.base_url
        self.upstream_model = status.model
        self.model_id = f"api:{self.upstream_model}"
        self._transport = transport

    def _image_data_url(self, image: Image.Image) -> str:
        prepared = image.copy()
        maximum = self.settings.api_image_max_edge
        prepared.thumbnail((maximum, maximum), Image.Resampling.LANCZOS)
        output = BytesIO()
        prepared.convert("RGB").save(output, format="JPEG", quality=88, optimize=True)
        encoded = base64.b64encode(output.getvalue()).decode("ascii")
        return f"data:image/jpeg;base64,{encoded}"

    @staticmethod
    def _extract_content(payload: dict[str, Any]) -> str:
        try:
            content = payload["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError) as exc:
            raise APIRecognitionError(
                "Recognition API response did not contain choices[0].message.content."
            ) from exc
        if isinstance(content, str) and content.strip():
            return content
        if isinstance(content, list):
            text_parts = [
                str(part.get("text", ""))
                for part in content
                if isinstance(part, dict) and part.get("type") in {None, "text"}
            ]
            combined = "".join(text_parts).strip()
            if combined:
                return combined
        raise APIRecognitionError("Recognition API returned empty non-text content.")

    def generate(self, image: Image.Image, prompt: str, max_new_tokens: int) -> str:
        headers = {"Content-Type": "application/json"}
        if self.settings.api_key:
            key = self.settings.api_key.get_secret_value().strip()
            if key:
                headers["Authorization"] = f"Bearer {key}"

        payload: dict[str, Any] = {
            "model": self.upstream_model,
            "temperature": 0,
            "max_tokens": max_new_tokens,
            "messages": [
                {"role": "system", "content": prompt},
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": (
                                "Analyze the supplied grocery or receipt image now. Follow the system "
                                "contract exactly and return only the JSON object."
                            ),
                        },
                        {
                            "type": "image_url",
                            "image_url": {"url": self._image_data_url(image), "detail": "high"},
                        },
                    ],
                },
            ],
        }
        if self.settings.api_json_mode:
            payload["response_format"] = {"type": "json_object"}

        timeout = httpx.Timeout(self.settings.api_timeout_seconds)
        try:
            with httpx.Client(
                timeout=timeout,
                transport=self._transport,
                follow_redirects=False,
            ) as client:
                response = client.post(self.endpoint, headers=headers, json=payload)
        except httpx.TimeoutException as exc:
            raise APIRecognitionTimeoutError(
                f"Recognition API timed out after {self.settings.api_timeout_seconds:g} seconds."
            ) from exc
        except httpx.RequestError as exc:
            raise APIRecognitionError(
                f"Could not reach the configured recognition API ({type(exc).__name__})."
            ) from exc

        if response.status_code >= 400:
            raise APIRecognitionError(
                f"Recognition API returned HTTP {response.status_code}. Check its URL, model, "
                "credentials, and JSON-mode support."
            )
        try:
            response_payload = response.json()
        except json.JSONDecodeError as exc:
            raise APIRecognitionError("Recognition API response was not valid JSON.") from exc
        if not isinstance(response_payload, dict):
            raise APIRecognitionError("Recognition API response must be a JSON object.")
        return self._extract_content(response_payload)


class APIRecognitionRuntime:
    """Small process-local wrapper that reloads the editable prompt per request."""

    def __init__(self, settings: Settings, prompt_path: Path | None = None) -> None:
        self.settings = settings
        self.prompt_path = prompt_path or settings.api_prompt_path
        self.backend = OpenAICompatibleVisionBackend(settings)

    def generate(self, image: Image.Image, recovery: bool = False) -> tuple[str, str]:
        try:
            prompt = self.prompt_path.read_text(encoding="utf-8")
        except OSError as exc:
            raise APIRecognitionNotConfiguredError(
                f"Could not read API prompt file: {self.prompt_path}"
            ) from exc
        if not prompt.strip():
            raise APIRecognitionNotConfiguredError("The configured API prompt file is empty.")
        if recovery:
            prompt = structured_recovery_prompt(prompt, self.settings.max_recognized_items)
        output = self.backend.generate(image, prompt, self.settings.api_max_tokens)
        return output, self.backend.model_id


@lru_cache(maxsize=1)
def get_api_recognition_runtime() -> APIRecognitionRuntime:
    return APIRecognitionRuntime(get_settings())


@lru_cache(maxsize=1)
def get_api_receipt_recognition_runtime() -> APIRecognitionRuntime:
    settings = get_settings()
    return APIRecognitionRuntime(settings, settings.api_receipt_prompt_path)
