"""Run one grocery photo through the configured API model and print expiry fields."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from PIL import Image, ImageOps

from wastewise_grocery_vlm.api_recognition import get_api_recognition_runtime
from wastewise_grocery_vlm.main import _generate_validated, _prepare_inference_image


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("image", type=Path)
    args = parser.parse_args()

    with Image.open(args.image) as source:
        image = ImageOps.exif_transpose(source).convert("RGB")
    model_id, items, warnings, attempts = _generate_validated(
        get_api_recognition_runtime(),
        _prepare_inference_image(image),
    )
    print(
        json.dumps(
            {
                "model_id": model_id,
                "attempts": attempts,
                "warnings": warnings,
                "items": [
                    {
                        "food_name": item.food_name,
                        "expiry_date_candidate": (
                            item.expiry_date_candidate.isoformat()
                            if item.expiry_date_candidate
                            else None
                        ),
                        "expiry_text_evidence": item.expiry_text_evidence,
                    }
                    for item in items
                ],
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
