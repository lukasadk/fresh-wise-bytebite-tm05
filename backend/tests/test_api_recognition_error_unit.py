from __future__ import annotations

import httpx
import pytest_asyncio

from wastewise_grocery_vlm.api_recognition import _safe_provider_error


@pytest_asyncio.fixture(autouse=True)
async def _clean_core_tables():
    """Override the integration suite's Postgres fixture for these unit tests."""

    yield


def test_safe_provider_error_keeps_code_and_message() -> None:
    response = httpx.Response(
        400,
        json={"error": {"code": "InvalidParameter", "message": "Unsupported option."}},
    )

    assert _safe_provider_error(response) == "InvalidParameter: Unsupported option."


def test_safe_provider_error_redacts_api_keys() -> None:
    response = httpx.Response(
        401,
        json={"error": {"message": "Invalid api_key=sk-secret-value"}},
    )

    detail = _safe_provider_error(response)

    assert "sk-secret-value" not in detail
    assert "[redacted" in detail
