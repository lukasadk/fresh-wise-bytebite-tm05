"""Check configured model access without printing credentials."""

from __future__ import annotations

import json

import httpx

from wastewise_grocery_vlm.api_recognition import (
    _chat_completions_url,
    _safe_provider_error,
)
from wastewise_grocery_vlm.config import get_settings


def main() -> None:
    settings = get_settings()
    key = settings.api_key.get_secret_value().strip() if settings.api_key else ""
    response = httpx.post(
        _chat_completions_url(settings.api_base_url),
        headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        },
        json={
            "model": settings.api_model,
            "messages": [{"role": "user", "content": "Reply with OK."}],
            "max_tokens": 8,
        },
        timeout=30,
    )
    request_id = next(
        (
            value
            for name, value in response.headers.items()
            if "request-id" in name.lower() or "request_id" in name.lower()
        ),
        None,
    )
    print(
        json.dumps(
            {
                "model": settings.api_model,
                "key_configured": bool(key),
                "http_status": response.status_code,
                "request_id": request_id,
                "provider_error": (
                    _safe_provider_error(response) if response.status_code >= 400 else None
                ),
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
