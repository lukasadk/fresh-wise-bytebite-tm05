"""Cache recipe-card images under the FreshWise API static directory.

The mobile app should not depend on Wikimedia or Unsplash being reachable from
the user's network. Run this script whenever a recipe source image changes.
"""

from __future__ import annotations

from hashlib import sha256
from io import BytesIO
import json
from pathlib import Path
import sys

import httpx
from PIL import Image, ImageOps


BACKEND_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_ROOT / "src"))

from wastewise_grocery_vlm.recipe_rag import (  # noqa: E402
    RECIPE_IMAGE_BY_ID,
    RECIPE_IMAGE_BY_TITLE,
    RECIPE_IMAGE_COMBINATIONS,
    RECIPE_IMAGE_URLS,
)


DATA_DIR = BACKEND_ROOT / "data" / "recipe_rag"
OUTPUT_DIR = BACKEND_ROOT / "app" / "static" / "recipe-images"


def cached_filename(url: str) -> str:
    return f"{sha256(url.encode('utf-8')).hexdigest()[:20]}.jpg"


def collect_urls() -> list[str]:
    urls = set(RECIPE_IMAGE_URLS.values())
    urls.update(RECIPE_IMAGE_BY_ID.values())
    urls.update(RECIPE_IMAGE_BY_TITLE.values())
    urls.update(url for _, url in RECIPE_IMAGE_COMBINATIONS)
    for path in DATA_DIR.glob("*.json"):
        payload = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(payload, list):
            continue
        for entry in payload:
            image_url = str(entry.get("image_url", "")) if isinstance(entry, dict) else ""
            if image_url.startswith("https://"):
                urls.add(image_url)
    return sorted(url for url in urls if url.startswith("https://"))


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    manifest: dict[str, str] = {}
    headers = {"User-Agent": "FreshWise/1.4 recipe-image-cache"}
    with httpx.Client(timeout=45, follow_redirects=True, headers=headers) as client:
        for url in collect_urls():
            filename = cached_filename(url)
            destination = OUTPUT_DIR / filename
            if not destination.exists():
                response = client.get(url)
                response.raise_for_status()
                with Image.open(BytesIO(response.content)) as source:
                    image = ImageOps.exif_transpose(source).convert("RGB")
                    image.thumbnail((1200, 900), Image.Resampling.LANCZOS)
                    image.save(destination, "JPEG", quality=84, optimize=True, progressive=True)
            manifest[url] = f"/static/recipe-images/{filename}"

    (OUTPUT_DIR / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"Cached {len(manifest)} recipe images in {OUTPUT_DIR}")


if __name__ == "__main__":
    main()
