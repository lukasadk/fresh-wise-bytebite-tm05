"""Upload one photo to the deployed API without printing shared credentials."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import httpx

from app.config import get_settings


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("image", type=Path)
    parser.add_argument(
        "--base-url",
        default="https://wastewise-ai-api-production.up.railway.app",
    )
    args = parser.parse_args()
    settings = get_settings()

    with args.image.open("rb") as source:
        response = httpx.post(
            f"{args.base_url.rstrip('/')}/v1/api-recognition/analyze",
            headers={settings.api_key_header: settings.api_key},
            files={"file": (args.image.name, source, "image/jpeg")},
            timeout=150,
        )
    response.raise_for_status()
    payload = response.json()
    print(
        json.dumps(
            {
                "analysis_id": payload.get("analysis_id"),
                "model_id": payload.get("model_id"),
                "review_image_url": payload.get("review_image_url"),
                "items": [
                    {
                        "food_name": item.get("food_name"),
                        "expiry_date_candidate": item.get("expiry_date_candidate"),
                        "expiry_text_evidence": item.get("expiry_text_evidence"),
                        "estimated_expiry_date": item.get("estimated_expiry_date"),
                        "expiry_estimate_days": item.get("expiry_estimate_days"),
                    }
                    for item in payload.get("items", [])
                ],
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
