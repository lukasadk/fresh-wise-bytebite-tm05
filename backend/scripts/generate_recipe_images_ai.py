"""Generate one accurate, self-hosted cover image for every recipe document.

This is an offline build task, never an app request path. It is resumable: a
recipe is skipped when its generated JPEG and manifest entry already exist.
Generated provider URLs are downloaded immediately because they expire.
"""

from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from hashlib import sha256
from io import BytesIO
import json
import os
from pathlib import Path
import re
from threading import Lock
import time
from typing import Any

import httpx
from PIL import Image, ImageOps


BACKEND_ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = BACKEND_ROOT / "data" / "recipe_rag"
OUTPUT_DIR = BACKEND_ROOT / "app" / "static" / "recipe-images" / "ai-generated"
MANIFEST_PATH = OUTPUT_DIR / "manifest.json"
DEFAULT_MODEL = "qwen-image-2.0-2026-03-03"
DEFAULT_CHINA_ENDPOINT = (
    "https://dashscope.aliyuncs.com/api/v1/services/"
    "aigc/multimodal-generation/generation"
)
DEFAULT_INTERNATIONAL_ENDPOINT = (
    "https://dashscope-intl.aliyuncs.com/api/v1/services/"
    "aigc/multimodal-generation/generation"
)


def _load_recipes() -> list[dict[str, Any]]:
    recipes: list[dict[str, Any]] = []
    for name in (
        "mini_recipes.json",
        "malaysian_recipes_expanded.json",
        "generated_recipes_500.json",
    ):
        payload = json.loads((DATA_DIR / name).read_text(encoding="utf-8"))
        recipes.extend(item for item in payload if isinstance(item, dict))
    return recipes


def _safe_filename(recipe_id: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9_-]+", "-", recipe_id).strip("-")[:80] or "recipe"
    return f"{slug}-{sha256(recipe_id.encode('utf-8')).hexdigest()[:8]}.jpg"


def _prompt(recipe: dict[str, Any]) -> str:
    title = str(recipe.get("title") or "Home-cooked meal").strip()
    ingredients = [str(item).strip() for item in recipe.get("ingredients", []) if str(item).strip()]
    quantities = [str(item).strip() for item in recipe.get("ingredient_quantities", []) if str(item).strip()]
    steps = [str(item).strip() for item in recipe.get("steps", []) if str(item).strip()]
    visible = ", ".join(ingredients[:10])
    measured = "; ".join(quantities[:8])
    method = " ".join(steps[-2:])[:700]
    exclusions = []
    joined = " ".join(ingredients).lower()
    for label in ("bread", "rice", "noodles", "egg", "chicken", "fish"):
        if label not in joined and label not in title.lower():
            exclusions.append(label)
    return (
        "Photorealistic premium food photography for a mobile recipe card. "
        f"Dish: {title}. Required visible ingredients: {visible}. "
        f"Recipe quantities for context: {measured}. Final cooking and serving context: {method}. "
        "Show the completed edible dish exactly as described, with the principal ingredients visibly "
        "recognisable and no unsupported major ingredients. Present one realistic serving in tasteful "
        "Malaysian home-cooking style on a warm cream stone tabletop. Slightly angled top-down 4:3 "
        "composition, dish centred, soft natural window light, appetising true-to-life texture, restrained "
        "props, consistent warm cream and forest-green accent palette. No people, hands, packaging, menus, "
        "labels, logos, watermark, or written text. "
        f"Do not show these absent staple ingredients: {', '.join(exclusions) or 'none'}."
    )


def _endpoint() -> str:
    explicit = os.getenv("WW_IMAGE_API_URL", "").strip()
    if explicit:
        return explicit
    base = os.getenv("WW_API_BASE_URL", "").lower()
    if "dashscope-intl" in base:
        return DEFAULT_INTERNATIONAL_ENDPOINT
    return DEFAULT_CHINA_ENDPOINT


def _load_manifest() -> dict[str, Any]:
    if not MANIFEST_PATH.exists():
        return {}
    payload = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    return payload if isinstance(payload, dict) else {}


def _public_path_to_file(public_path: str) -> Path:
    """Resolve a `/static/...` URL to the file copied into the backend image."""

    relative = public_path.removeprefix("/static/")
    return BACKEND_ROOT / "app" / "static" / relative


def _save_jpeg(content: bytes, destination: Path) -> None:
    with Image.open(BytesIO(content)) as source:
        image = ImageOps.exif_transpose(source).convert("RGB")
        image.thumbnail((1200, 900), Image.Resampling.LANCZOS)
        image.save(destination, "JPEG", quality=84, optimize=True, progressive=True)


def _generate_one(
    recipe: dict[str, Any],
    *,
    api_key: str,
    endpoint: str,
    model: str,
    client: httpx.Client,
    submit_gate: Lock,
    last_submit: list[float],
) -> tuple[str, dict[str, Any]]:
    recipe_id = str(recipe["recipe_id"])
    prompt = _prompt(recipe)
    payload = {
        "model": model,
        "input": {"messages": [{"role": "user", "content": [{"text": prompt}]}]},
        "parameters": {
            "negative_prompt": (
                "low quality, blurry, illustration, cartoon, plastic texture, distorted food, duplicate "
                "ingredients, raw ingredients beside the cooked dish, text, logo, watermark, people, hands"
            ),
            "prompt_extend": True,
            "watermark": False,
            "size": "2368*1728",
            "n": 1,
        },
    }
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    image_url = ""
    request_id = ""
    error: Exception | None = None
    for attempt in range(1, 6):
        try:
            # qwen-image-2.0 is limited to two submissions per second. Keep a
            # global 0.55-second gap while allowing requests to finish in parallel.
            with submit_gate:
                wait = max(0.0, 0.55 - (time.monotonic() - last_submit[0]))
                if wait:
                    time.sleep(wait)
                last_submit[0] = time.monotonic()
            # A provider-side job can occasionally leave the synchronous
            # connection open indefinitely. Fail fast enough that a worker
            # can retry instead of blocking the whole batch for ten minutes.
            response = client.post(endpoint, headers=headers, json=payload)
            if response.is_error:
                try:
                    provider_error = response.json()
                except ValueError:
                    provider_error = {"message": response.text[:500]}
                code = str(provider_error.get("code", "unknown"))
                message = str(provider_error.get("message", "unknown"))[:500]
                raise RuntimeError(f"provider HTTP {response.status_code} {code}: {message}")
            result = response.json()
            request_id = str(result.get("request_id", ""))
            choices = result.get("output", {}).get("choices", [])
            content = choices[0].get("message", {}).get("content", []) if choices else []
            image_url = next(
                (str(item.get("image")) for item in content if isinstance(item, dict) and item.get("image")),
                "",
            )
            if not image_url:
                raise RuntimeError(f"Image URL missing from provider response ({result.get('code', 'unknown')}).")
            image_response = client.get(image_url)
            image_response.raise_for_status()
            filename = _safe_filename(recipe_id)
            destination = OUTPUT_DIR / filename
            _save_jpeg(image_response.content, destination)
            return recipe_id, {
                "path": f"/static/recipe-images/ai-generated/{filename}",
                "title": str(recipe.get("title", "")),
                "model": model,
                "prompt_sha256": sha256(prompt.encode("utf-8")).hexdigest(),
                "request_id": request_id,
                "generated_at": datetime.now(timezone.utc).isoformat(),
            }
        except Exception as exc:  # retry rate limits and transient provider/OSS errors
            error = exc
            if attempt < 5:
                time.sleep(min(30, 2**attempt))
    raise RuntimeError(f"{recipe_id} failed after retries: {type(error).__name__}: {error}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=0, help="Generate at most N pending recipes; 0 means all.")
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--model", default=os.getenv("WW_IMAGE_MODEL", DEFAULT_MODEL))
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    api_key = (os.getenv("WW_IMAGE_API_KEY") or os.getenv("WW_API_KEY") or "").strip()
    if not api_key:
        raise SystemExit("WW_IMAGE_API_KEY or WW_API_KEY is required.")

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    manifest = _load_manifest()
    recipes = _load_recipes()
    pending = []
    for recipe in recipes:
        recipe_id = str(recipe.get("recipe_id", ""))
        existing = manifest.get(recipe_id) if isinstance(manifest.get(recipe_id), dict) else None
        existing_path = _public_path_to_file(str(existing.get("path", ""))) if existing else None
        if args.force or not existing or not existing_path or not existing_path.is_file():
            pending.append(recipe)
    already_complete = len(recipes) - len(pending)
    if args.limit > 0:
        pending = pending[: args.limit]

    print(
        f"recipes={len(recipes)} complete={already_complete} selected={len(pending)} "
        f"model={args.model} endpoint={_endpoint()}",
        flush=True,
    )
    if not pending:
        return

    submit_gate = Lock()
    last_submit = [0.0]
    failures: list[str] = []
    limits = httpx.Limits(
        max_connections=max(16, min(args.workers * 2, 24)),
        max_keepalive_connections=max(8, min(args.workers, 12)),
        keepalive_expiry=60,
    )
    timeout = httpx.Timeout(150, connect=30, read=150, write=30, pool=30)
    with httpx.Client(timeout=timeout, follow_redirects=True, limits=limits) as client:
        with ThreadPoolExecutor(max_workers=max(1, min(args.workers, 12))) as executor:
            futures = {
                executor.submit(
                    _generate_one,
                    recipe,
                    api_key=api_key,
                    endpoint=_endpoint(),
                    model=args.model,
                    client=client,
                    submit_gate=submit_gate,
                    last_submit=last_submit,
                ): str(recipe["recipe_id"])
                for recipe in pending
            }
            for index, future in enumerate(as_completed(futures), start=1):
                recipe_id = futures[future]
                try:
                    result_id, entry = future.result()
                    manifest[result_id] = entry
                    MANIFEST_PATH.write_text(
                        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
                        encoding="utf-8",
                    )
                    print(f"[{index}/{len(pending)}] generated {result_id}", flush=True)
                except Exception as exc:
                    failures.append(f"{recipe_id}: {exc}")
                    print(f"[{index}/{len(pending)}] FAILED {recipe_id}: {exc}", flush=True)

    print(f"complete={len(manifest)}/{len(recipes)} failures={len(failures)}", flush=True)
    if failures:
        (OUTPUT_DIR / "failures.txt").write_text("\n".join(failures) + "\n", encoding="utf-8")
        raise SystemExit(1)
    failure_path = OUTPUT_DIR / "failures.txt"
    if failure_path.exists():
        failure_path.unlink()


if __name__ == "__main__":
    main()
