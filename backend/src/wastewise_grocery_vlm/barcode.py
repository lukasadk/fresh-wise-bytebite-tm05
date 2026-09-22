"""Local product-barcode evidence extraction using ZXing-C++."""

from __future__ import annotations

from PIL import Image
import zxingcpp

from .schemas import BarcodeCandidate


PRODUCT_FORMATS = {
    "EAN8",
    "EAN13",
    "UPCA",
    "UPCE",
    "DataBar",
    "DataBarExpanded",
    "DataBarLimited",
}


def decode_product_barcodes(image: Image.Image) -> list[BarcodeCandidate]:
    """Return valid retail barcode evidence without performing network lookup."""

    try:
        decoded = zxingcpp.read_barcodes(
            image,
            try_rotate=True,
            try_downscale=True,
            return_errors=False,
        )
    except (RuntimeError, ValueError):
        # Barcode evidence is optional and must never make VLM recognition fail.
        return []
    candidates: list[BarcodeCandidate] = []
    seen: set[str] = set()
    for result in decoded:
        format_name = result.format.name
        value = result.text.strip()
        if (
            not result.valid
            or format_name not in PRODUCT_FORMATS
            or not value.isdigit()
            or len(value) not in {8, 12, 13, 14}
            or value in seen
        ):
            continue
        seen.add(value)
        candidates.append(BarcodeCandidate(value=value, format=format_name))
    return candidates
