import json
import re
from datetime import date
from typing import Any
from uuid import uuid4

from .schemas import GroceryUnit, RecognizedFoodItem


EXPIRY_DATE_KEY_PRIORITY = (
    "expiry_date_candidate",
    "expiry_date",
    "expiry",
    "expiration_date",
    "expiration",
    "best_before_date",
    "best_before",
    "use_by_date",
    "use_by",
)
EXPIRY_DATE_KEYS = set(EXPIRY_DATE_KEY_PRIORITY)
ITEM_ARRAY_KEY_PRIORITY = (
    "items",
    "products",
    "food_items",
    "grocery_items",
    "groceries",
    "detected_items",
    "detections",
    "objects",
    "results",
)

UNIT_ALIASES = {
    "pc": GroceryUnit.piece,
    "pcs": GroceryUnit.piece,
    "piece": GroceryUnit.piece,
    "pieces": GroceryUnit.piece,
    "item": GroceryUnit.piece,
    "items": GroceryUnit.piece,
    "packet": GroceryUnit.pack,
    "packets": GroceryUnit.pack,
    "pack": GroceryUnit.pack,
    "packs": GroceryUnit.pack,
    "bag": GroceryUnit.bag,
    "bags": GroceryUnit.bag,
    "box": GroceryUnit.box,
    "boxes": GroceryUnit.box,
    "bottle": GroceryUnit.bottle,
    "bottles": GroceryUnit.bottle,
    "can": GroceryUnit.can,
    "cans": GroceryUnit.can,
    "tin": GroceryUnit.can,
    "tins": GroceryUnit.can,
    "jar": GroceryUnit.jar,
    "jars": GroceryUnit.jar,
    "bunch": GroceryUnit.bunch,
    "bunches": GroceryUnit.bunch,
    "tray": GroceryUnit.tray,
    "trays": GroceryUnit.tray,
    "carton": GroceryUnit.carton,
    "cartons": GroceryUnit.carton,
    "kg": GroceryUnit.kilogram,
    "kilogram": GroceryUnit.kilogram,
    "kilograms": GroceryUnit.kilogram,
    "g": GroceryUnit.gram,
    "gram": GroceryUnit.gram,
    "grams": GroceryUnit.gram,
    "l": GroceryUnit.litre,
    "litre": GroceryUnit.litre,
    "liter": GroceryUnit.litre,
    "ml": GroceryUnit.millilitre,
    "millilitre": GroceryUnit.millilitre,
    "milliliter": GroceryUnit.millilitre,
}

GENERIC_NAMES = {
    "food",
    "food item",
    "grocery",
    "grocery item",
    "item",
    "product",
    "packaged product",
    "unknown",
    "unidentified item",
    "食品",
    "商品",
    "未知商品",
}

UNCERTAINTY_TERMS = (
    "possibly",
    "probably",
    "maybe",
    "unclear",
    "unknown",
    "unidentified",
    "疑似",
    "可能",
    "不确定",
    "未知",
)

SERVING_SIZE_MARKERS = tuple(
    _marker.casefold()
    for _marker in (
        "serving",
        "portion",
        "setiap hidangan",
        "saiz hidangan",
        "每份",
        "份量",
        "每食用份量",
    )
)

NET_CONTENT_MARKERS = tuple(
    _marker.casefold()
    for _marker in (
        "net weight",
        "net wt",
        "net volume",
        "net content",
        "isi bersih",
        "berat bersih",
        "净含量",
        "净重",
    )
)


class ModelOutputError(ValueError):
    pass


def _first_present(item: dict[str, Any], *keys: str) -> Any:
    for key in keys:
        value = item.get(key)
        if value not in (None, ""):
            return value
    return None


def _repair_common_json_syntax(text: str) -> str:
    """Repair only common key-quoting/trailing-comma errors from small VLMs.

    This deliberately does not invent values, close arbitrary strings, or try
    to recover repeated-token output. The normal schema/evidence gates still
    run on every recovered field.
    """

    repaired = re.sub(
        r'([,{]\s*)([A-Za-z_][A-Za-z0-9_]*)"\s*:', r'\1"\2":', text
    )
    repaired = re.sub(
        r"([,{]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:", r'\1"\2":', repaired
    )
    return re.sub(r",\s*([}\]])", r"\1", repaired)


def _extract_json_object(text: str) -> tuple[dict[str, Any], bool]:
    cleaned = re.sub(r"^\s*```(?:json)?\s*|\s*```\s*$", "", text.strip(), flags=re.IGNORECASE)
    if cleaned.lstrip().startswith("{"):
        try:
            value, _ = json.JSONDecoder().raw_decode(cleaned)
        except json.JSONDecodeError:
            pass
        else:
            if isinstance(value, dict):
                return value, False
    if "items" in cleaned:
        repaired = _repair_common_json_syntax(cleaned)
        if repaired.lstrip().startswith("{"):
            try:
                value, _ = json.JSONDecoder().raw_decode(repaired)
            except json.JSONDecodeError:
                pass
            else:
                if isinstance(value, dict):
                    return value, True
    raise ModelOutputError("The model did not return a valid JSON object.")


def _extract_partial_items_object(text: str) -> tuple[dict[str, Any], bool]:
    """Recover complete item objects from a truncated top-level items array."""

    cleaned = re.sub(r"^\s*```(?:json)?\s*|\s*```\s*$", "", text.strip(), flags=re.IGNORECASE)
    match = re.search(r'"items"\s*:\s*\[', cleaned)
    if not match:
        raise ModelOutputError("The model did not return a valid JSON object.")

    decoder = json.JSONDecoder()
    items: list[dict[str, Any]] = []
    cursor = match.end()
    while cursor < len(cleaned):
        while cursor < len(cleaned) and cleaned[cursor] in " \r\n\t,":
            cursor += 1
        if cursor >= len(cleaned) or cleaned[cursor] == "]":
            break
        if cleaned[cursor] != "{":
            cursor += 1
            continue
        try:
            value, offset = decoder.raw_decode(cleaned[cursor:])
        except json.JSONDecodeError:
            break
        if isinstance(value, dict):
            items.append(value)
        cursor += offset

    if not items:
        raise ModelOutputError("The model did not return a valid JSON object.")
    return {"items": items, "_partial_items_recovered": True}, True


def _extract_item_array(
    payload: dict[str, Any],
) -> tuple[list[Any], str | None]:
    for key in ITEM_ARRAY_KEY_PRIORITY:
        value = payload.get(key)
        if isinstance(value, list):
            if key == "items":
                return value, None
            return value, f"Model used top-level `{key}`; normalized it to `items`."

    for container_key in ("data", "result", "output", "response"):
        container = payload.get(container_key)
        if not isinstance(container, dict):
            continue
        for key in ITEM_ARRAY_KEY_PRIORITY:
            value = container.get(key)
            if isinstance(value, list):
                return (
                    value,
                    f"Model nested `{key}` under `{container_key}`; normalized it to `items`.",
                )

    raise ModelOutputError("Model JSON must contain an 'items' array.")


def _as_confidence(value: Any) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return 0.0
    if number > 1.0 and number <= 100.0:
        number /= 100.0
    return min(1.0, max(0.0, number))


def _as_positive_quantity(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if number > 0 else None


def _normalize_unit(value: Any) -> GroceryUnit:
    normalized = str(value or "").strip().lower()
    return UNIT_ALIASES.get(normalized, GroceryUnit.unknown)


def _as_bounding_box(value: Any) -> tuple[int, int, int, int] | None:
    if not isinstance(value, (list, tuple)) or len(value) != 4:
        return None
    try:
        x1, y1, x2, y2 = (round(float(coordinate)) for coordinate in value)
    except (TypeError, ValueError):
        return None
    if not (0 <= x1 < x2 <= 1000 and 0 <= y1 < y2 <= 1000):
        return None
    if x2 - x1 < 10 or y2 - y1 < 10:
        return None
    return x1, y1, x2, y2


def _evidence_list(item: dict[str, Any]) -> list[str]:
    raw = _first_present(
        item,
        "packaging_text_evidence",
        "ocr_text",
        "ocr",
        "text_evidence",
        "evidence",
        "visible_text",
    )
    raw = raw if raw is not None else []
    if isinstance(raw, str):
        raw = [raw]
    if not isinstance(raw, list):
        return []
    return [str(value).strip()[:200] for value in raw if str(value).strip()][:10]


def _optional_text(item: dict[str, Any], key: str, maximum: int) -> str | None:
    value = item.get(key)
    if value is None:
        return None
    normalized = str(value).strip()
    return normalized[:maximum] or None


def _compact_text(value: str) -> str:
    return "".join(character for character in value.casefold() if character.isalnum())


def _packaging_field_supported(value: str | None, evidence: list[str]) -> bool:
    """Conservatively check whether an OCR-derived field appears in its evidence.

    This is not a claim that OCR is correct. It only prevents unsupported brand,
    variant and net-content strings from looking equally trustworthy.
    """

    if not value:
        return True
    needle = _compact_text(value)
    if not needle:
        return False
    joined = _compact_text(" ".join(evidence))
    return bool(joined and needle in joined)


def _net_content_is_only_serving_size(
    value: str | None, evidence: list[str]
) -> bool:
    """Reject a package amount supported only by serving-size OCR.

    A serving or portion amount describes nutrition/preparation, not the total
    amount inside the retail package.  Preserve the value when any matching
    evidence fragment explicitly identifies it as net weight/content/volume.
    """

    if not value:
        return False
    needle = _compact_text(value)
    matching_fragments = [
        fragment
        for fragment in evidence
        if needle and needle in _compact_text(fragment)
    ]
    if not matching_fragments:
        return False

    compact_serving_markers = tuple(_compact_text(marker) for marker in SERVING_SIZE_MARKERS)
    compact_net_markers = tuple(_compact_text(marker) for marker in NET_CONTENT_MARKERS)
    if any(
        any(marker in _compact_text(fragment) for marker in compact_net_markers)
        for fragment in matching_fragments
    ):
        return False
    return all(
        any(marker in _compact_text(fragment) for marker in compact_serving_markers)
        for fragment in matching_fragments
    )


def _strip_duplicated_brand_prefix(food_name: str, brand: str | None) -> tuple[str, bool]:
    if not brand or not food_name.casefold().startswith(brand.casefold()):
        return food_name, False
    remainder = food_name[len(brand) :].lstrip(" \t-–—_:|/·.,，：")
    if not remainder or not _compact_text(remainder):
        return food_name, False
    return remainder, True


def _identity_key(item: RecognizedFoodItem) -> tuple[str, ...]:
    return (
        _compact_text(item.food_name),
        _compact_text(item.brand or ""),
        _compact_text(item.product_variant or ""),
        _compact_text(item.net_content_text or ""),
        _compact_text(item.category),
        item.unit.value,
    )


def _collapse_duplicate_items(
    items: list[RecognizedFoodItem],
) -> tuple[list[RecognizedFoodItem], int]:
    """Collapse repeated identity rows without adding their quantities.

    Generative repetition must never inflate inventory counts. The largest
    reported count is kept as a review candidate, all evidence is preserved,
    and the row is forced through explicit review.
    """

    collapsed: list[RecognizedFoodItem] = []
    positions: dict[tuple[str, ...], int] = {}
    duplicate_count = 0
    for item in items:
        key = _identity_key(item)
        position = positions.get(key)
        if position is None:
            positions[key] = len(collapsed)
            collapsed.append(item)
            continue
        duplicate_count += 1
        existing = collapsed[position]
        quantities = [value for value in (existing.quantity, item.quantity) if value is not None]
        evidence = list(
            dict.fromkeys(existing.packaging_text_evidence + item.packaging_text_evidence)
        )[:10]
        reasons = list(
            dict.fromkeys(
                existing.review_reasons
                + item.review_reasons
                + ["duplicate_model_rows_collapsed_quantity_not_summed"]
            )
        )
        expiry_matches = (
            existing.expiry_date_candidate == item.expiry_date_candidate
            and existing.expiry_text_evidence == item.expiry_text_evidence
        )
        collapsed[position] = existing.model_copy(
            update={
                "quantity": max(quantities) if quantities else None,
                "confidence": min(existing.confidence, item.confidence),
                "bounding_box": existing.bounding_box or item.bounding_box,
                "review_required": True,
                "review_reasons": reasons,
                "packaging_text_evidence": evidence,
                "expiry_date_candidate": (
                    existing.expiry_date_candidate if expiry_matches else None
                ),
                "expiry_text_evidence": existing.expiry_text_evidence if expiry_matches else None,
            }
        )
    return collapsed, duplicate_count


def _expiry_candidate(item: dict[str, Any]) -> tuple[date | None, str | None, str | None]:
    raw_date = next(
        (
            item.get(key)
            for key in EXPIRY_DATE_KEY_PRIORITY
            if item.get(key) not in (None, "")
        ),
        None,
    )
    if raw_date is None:
        return None, None, None

    raw_evidence = item.get("expiry_text_evidence", item.get("expiry_evidence"))
    if isinstance(raw_evidence, list):
        raw_evidence = next((value for value in raw_evidence if str(value).strip()), None)
    evidence = str(raw_evidence).strip()[:100] if raw_evidence is not None else None
    if not evidence:
        return None, None, "expiry candidate had no visible-text evidence and was discarded"

    try:
        candidate = date.fromisoformat(str(raw_date).strip())
    except (TypeError, ValueError):
        return None, evidence, "expiry candidate was not an ISO YYYY-MM-DD date and was discarded"
    return candidate, evidence, None


def parse_model_output(
    raw_text: str,
    confidence_threshold: float,
    max_items: int | None = None,
) -> tuple[list[RecognizedFoodItem], list[str]]:
    """Parse, project and review-flag untrusted model JSON.

    An expiry candidate is retained only when it is an ISO date with verbatim
    visible-text evidence. It remains a review candidate and never flows into
    Active Inventory without an explicit user decision and final confirmation.
    """

    try:
        payload, syntax_repaired = _extract_json_object(raw_text)
    except ModelOutputError:
        payload, syntax_repaired = _extract_partial_items_object(raw_text)
    raw_items, item_array_warning = _extract_item_array(payload)

    warnings: list[str] = []
    partial_items_recovered = bool(payload.get("_partial_items_recovered"))
    if partial_items_recovered:
        warnings.append(
            "Model output was truncated; recovered only complete item objects and the basket may be incomplete."
        )
    if item_array_warning:
        warnings.append(item_array_warning)
    if syntax_repaired:
        warnings.append(
            "Model JSON syntax was repaired conservatively; every recovered item requires review."
        )
    item_limit_applied = max_items is not None and len(raw_items) > max_items
    if item_limit_applied:
        warnings.append(
            f"Model returned {len(raw_items)} item rows; only the first {max_items} were "
            "retained and the basket may be incomplete."
        )
        raw_items = raw_items[:max_items]
    top_level_expiry = sorted(
        EXPIRY_DATE_KEYS.intersection(key.lower() for key in payload)
    )
    if top_level_expiry:
        warnings.append("Top-level expiry fields were ignored; candidates must belong to an item.")
    recognized: list[RecognizedFoodItem] = []
    removed_brand_prefixes = 0
    for index, raw_item in enumerate(raw_items):
        if not isinstance(raw_item, dict):
            warnings.append(f"items[{index}] was not an object and was skipped.")
            continue

        food_name = str(
            _first_present(
                raw_item,
                "food_name",
                "product_name",
                "name",
                "item_name",
                "label",
                "class_name",
            )
            or "Unidentified item"
        ).strip()[:200]
        if raw_item.get("brand") is None and raw_item.get("brand_name") is not None:
            raw_item["brand"] = raw_item["brand_name"]
        if (
            raw_item.get("product_variant") is None
            and raw_item.get("variant") is not None
        ):
            raw_item["product_variant"] = raw_item["variant"]
        brand = _optional_text(raw_item, "brand", 100)
        product_variant = _optional_text(raw_item, "product_variant", 150)
        used_legacy_net_content = (
            raw_item.get("net_content_text") is None
            and _first_present(raw_item, "net_content", "net_weight", "size") is not None
        )
        net_content_text = _optional_text(
            raw_item,
            (
                "net_content"
                if raw_item.get("net_content") is not None
                else "net_weight"
                if raw_item.get("net_weight") is not None
                else "size"
                if used_legacy_net_content
                else "net_content_text"
            ),
            50,
        )
        category = str(
            _first_present(raw_item, "category", "food_category", "type") or "unknown"
        ).strip()[:100]
        food_name = food_name or "Unidentified item"
        food_name, brand_prefix_removed = _strip_duplicated_brand_prefix(food_name, brand)
        if brand_prefix_removed:
            removed_brand_prefixes += 1
        category = category or "unknown"
        quantity = _as_positive_quantity(_first_present(raw_item, "quantity", "qty", "count"))
        unit_value = _first_present(raw_item, "unit", "quantity_unit")
        unit = _normalize_unit(unit_value if unit_value is not None else "piece")
        bounding_box = _as_bounding_box(
            _first_present(raw_item, "bounding_box", "bbox", "box", "position")
        )
        confidence_value = _first_present(
            raw_item, "confidence", "confidence_score", "score", "probability"
        )
        confidence = _as_confidence(confidence_value if confidence_value is not None else 0.8)
        evidence = _evidence_list(raw_item)
        expiry_date_candidate, expiry_text_evidence, expiry_warning = _expiry_candidate(raw_item)
        reasons: list[str] = []

        if syntax_repaired:
            reasons.append("model_json_syntax_repaired")
        if used_legacy_net_content:
            reasons.append("legacy_net_content_alias_normalized")

        if brand_prefix_removed:
            reasons.append("duplicated_brand_prefix_removed_from_food_name")

        if expiry_warning:
            warnings.append(f"items[{index}] {expiry_warning}.")
            reasons.append("expiry_candidate_invalid_or_unsupported")
        if expiry_date_candidate is not None:
            reasons.append("expiry_candidate_requires_confirmation")

        if confidence < confidence_threshold:
            reasons.append("low_confidence")
        if quantity is None:
            reasons.append("quantity_uncertain")
        if unit is GroceryUnit.unknown:
            reasons.append("unit_uncertain")
        if bounding_box is None:
            reasons.append("position_uncertain")
        if food_name.casefold() in GENERIC_NAMES:
            reasons.append("generic_or_unidentified_name")
        combined_text = f"{food_name} {raw_item.get('notes', '')}".casefold()
        if any(term in combined_text for term in UNCERTAINTY_TERMS):
            reasons.append("model_expressed_uncertainty")
        if bool(raw_item.get("review_required")):
            reasons.append("model_requested_review")
        if _net_content_is_only_serving_size(net_content_text, evidence):
            net_content_text = None
            reasons.append("serving_size_not_net_content")
            warnings.append(
                f"items[{index}] serving/portion amount was discarded because it is not "
                "the package net content."
            )
        for field_name, value in (
            ("brand", brand),
            ("product_variant", product_variant),
            ("net_content_text", net_content_text),
        ):
            if field_name == "product_variant" and not evidence:
                # Unpackaged produce can have a visually inferred variety/color.
                continue
            if not _packaging_field_supported(value, evidence):
                reasons.append(f"{field_name}_not_supported_by_packaging_text")
                warnings.append(
                    f"items[{index}] unsupported {field_name} was discarded because no matching "
                    "visible packaging text was returned."
                )
                if field_name == "brand":
                    brand = None
                elif field_name == "product_variant":
                    product_variant = None
                else:
                    net_content_text = None
        if item_limit_applied:
            reasons.append("basket_may_be_incomplete_due_to_item_limit")
        if partial_items_recovered:
            reasons.append("basket_may_be_incomplete_due_to_truncated_output")

        recognized.append(
            RecognizedFoodItem(
                item_id=uuid4(),
                food_name=food_name,
                brand=brand,
                product_variant=product_variant,
                net_content_text=net_content_text,
                category=category,
                quantity=quantity,
                unit=unit,
                bounding_box=bounding_box,
                confidence=confidence,
                review_required=bool(reasons),
                review_reasons=list(dict.fromkeys(reasons)),
                packaging_text_evidence=evidence,
                expiry_date_candidate=expiry_date_candidate,
                expiry_text_evidence=expiry_text_evidence,
            )
        )

    recognized, duplicate_count = _collapse_duplicate_items(recognized)
    if removed_brand_prefixes:
        warnings.append(
            f"Removed duplicated brand prefixes from {removed_brand_prefixes} food name(s)."
        )
    if duplicate_count:
        warnings.append(
            f"Collapsed {duplicate_count} repeated model item row(s); quantities were not summed."
        )
    return recognized, warnings
