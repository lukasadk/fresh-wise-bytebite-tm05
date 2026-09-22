import re
import unicodedata
from collections import defaultdict
from statistics import mean
from typing import Any


def _fold_text(value: Any) -> str:
    folded = unicodedata.normalize("NFKD", str(value or "").casefold())
    return "".join(char for char in folded if not unicodedata.combining(char))


def normalize_name(value: Any) -> str:
    return re.sub(r"[\W_]+", " ", _fold_text(value), flags=re.UNICODE).strip()


def normalize_compact(value: Any) -> str:
    """Normalize short structured package fields such as brand and net content."""

    return re.sub(r"[\W_]+", "", _fold_text(value), flags=re.UNICODE)


def _match_items(
    ground_truth: list[dict[str, Any]], predictions: list[dict[str, Any]]
) -> tuple[list[tuple[dict[str, Any], dict[str, Any]]], list[dict[str, Any]]]:
    remaining = list(predictions)
    matches: list[tuple[dict[str, Any], dict[str, Any]]] = []
    for expected in ground_truth:
        accepted = {normalize_name(expected.get("food_name", ""))}
        accepted.update(normalize_name(value) for value in expected.get("accepted_names", []))
        accepted.discard("")
        match_index = next(
            (
                index
                for index, predicted in enumerate(remaining)
                if normalize_name(predicted.get("food_name", "")) in accepted
            ),
            None,
        )
        if match_index is not None:
            matches.append((expected, remaining.pop(match_index)))
    return matches, remaining


def calculate_metrics(
    references: list[dict[str, Any]], predictions: list[dict[str, Any]]
) -> dict[str, Any]:
    """Calculate VLM basket metrics without inventing values for unavailable fields."""

    prediction_by_id = {row["image_id"]: row for row in predictions}
    total_reference_items = 0
    total_predictions = 0
    matched_items = 0
    class_name_correct = 0
    food_name_contract_correct = 0
    brand_reference_items = 0
    brand_correct = 0
    brand_absent_reference_matches = 0
    brand_hallucinations = 0
    net_content_reference_items = 0
    net_content_correct = 0
    product_identity_correct = 0
    quantity_errors: list[float] = []
    exact_baskets = 0
    hallucinations = 0
    latencies: list[float] = []
    correction_flags: list[bool] = []

    for reference in references:
        predicted_basket = prediction_by_id.get(reference["image_id"], {"items": []})
        expected_items = reference.get("items", [])
        predicted_items = predicted_basket.get("items", [])
        matches, unmatched_predictions = _match_items(expected_items, predicted_items)
        total_reference_items += len(expected_items)
        brand_reference_items += sum(
            bool(normalize_compact(item.get("brand"))) for item in expected_items
        )
        net_content_reference_items += sum(
            bool(normalize_compact(item.get("net_content_text"))) for item in expected_items
        )
        total_predictions += len(predicted_items)
        matched_items += len(matches)
        hallucinations += len(unmatched_predictions)

        basket_exact = len(matches) == len(expected_items) and not unmatched_predictions
        for expected, predicted in matches:
            canonical_name_equal = normalize_name(expected.get("food_name", "")) == normalize_name(
                predicted.get("food_name", "")
            )
            if canonical_name_equal:
                food_name_contract_correct += 1
            category_equal = normalize_name(expected.get("category", "")) == normalize_name(
                predicted.get("category", "")
            )
            if category_equal:
                class_name_correct += 1
            expected_brand = normalize_compact(expected.get("brand"))
            predicted_brand = normalize_compact(predicted.get("brand"))
            brand_equal = not expected_brand or expected_brand == predicted_brand
            brand_field_equal = expected_brand == predicted_brand
            if expected_brand:
                if brand_equal:
                    brand_correct += 1
            else:
                brand_absent_reference_matches += 1
                if predicted_brand:
                    brand_hallucinations += 1
            expected_net_content = normalize_compact(expected.get("net_content_text"))
            predicted_net_content = normalize_compact(predicted.get("net_content_text"))
            if expected_net_content:
                if expected_net_content == predicted_net_content:
                    net_content_correct += 1
            expected_variant = normalize_name(expected.get("product_variant", ""))
            predicted_variant = normalize_name(predicted.get("product_variant", ""))
            variant_field_equal = expected_variant == predicted_variant
            if canonical_name_equal and brand_field_equal and variant_field_equal:
                product_identity_correct += 1
            try:
                error = abs(float(predicted["quantity"]) - float(expected["quantity"]))
                quantity_errors.append(error)
                if error != 0:
                    basket_exact = False
            except (KeyError, TypeError, ValueError):
                basket_exact = False
        if basket_exact:
            exact_baskets += 1

        latency = predicted_basket.get("latency_ms")
        if isinstance(latency, (int, float)) and latency >= 0:
            latencies.append(float(latency))
        for item in predicted_items:
            if "corrected_by_user" in item:
                correction_flags.append(bool(item["corrected_by_user"]))

    basket_count = len(references)
    return {
        "evaluated_baskets": basket_count,
        "ground_truth_items": total_reference_items,
        "predicted_items": total_predictions,
        "item_recognition_accuracy": (
            matched_items / total_reference_items if total_reference_items else None
        ),
        "class_name_accuracy": (
            class_name_correct / total_reference_items if total_reference_items else None
        ),
        "food_name_contract_accuracy": (
            food_name_contract_correct / total_reference_items if total_reference_items else None
        ),
        "brand_accuracy": (
            brand_correct / brand_reference_items if brand_reference_items else None
        ),
        "brand_reference_items": brand_reference_items,
        "brand_hallucination_rate": (
            brand_hallucinations / brand_absent_reference_matches
            if brand_absent_reference_matches
            else None
        ),
        "net_content_accuracy": (
            net_content_correct / net_content_reference_items
            if net_content_reference_items
            else None
        ),
        "net_content_reference_items": net_content_reference_items,
        "product_identity_accuracy": (
            product_identity_correct / total_reference_items if total_reference_items else None
        ),
        "counting_mae": mean(quantity_errors) if quantity_errors else None,
        "exact_basket_accuracy": exact_baskets / basket_count if basket_count else None,
        "hallucination_rate": hallucinations / total_predictions if total_predictions else None,
        "user_correction_rate": (
            sum(correction_flags) / len(correction_flags) if correction_flags else None
        ),
        "mean_latency_ms": mean(latencies) if latencies else None,
    }
