import re
from typing import Any

import httpx


BARCODE_PATTERN = re.compile(r"^[0-9]{8,14}$")


class ProductLookupError(RuntimeError):
    pass


async def lookup_barcode(barcode: str, timeout_seconds: float = 5.0) -> dict[str, Any]:
    """Optional, keyless Open Food Facts lookup for a barcode supplied by a client."""

    if not BARCODE_PATTERN.fullmatch(barcode):
        raise ValueError("Barcode must contain 8 to 14 digits.")
    url = f"https://world.openfoodfacts.org/api/v2/product/{barcode}.json"
    try:
        async with httpx.AsyncClient(timeout=timeout_seconds) as client:
            response = await client.get(url, params={"fields": "code,product_name,brands,categories_tags,quantity"})
            response.raise_for_status()
    except httpx.HTTPError as exc:
        raise ProductLookupError(str(exc)) from exc
    payload = response.json()
    if payload.get("status") != 1:
        raise KeyError(barcode)
    product = payload.get("product", {})
    return {
        "barcode": payload.get("code", barcode),
        "product_name": product.get("product_name"),
        "brand": product.get("brands"),
        "categories": product.get("categories_tags", []),
        "package_quantity_text": product.get("quantity"),
        "source": "Open Food Facts",
    }
