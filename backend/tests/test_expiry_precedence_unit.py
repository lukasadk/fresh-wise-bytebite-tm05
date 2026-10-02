from datetime import date
from uuid import uuid4

import pytest_asyncio

from wastewise_grocery_vlm.main import _with_expiry_fallbacks
from wastewise_grocery_vlm.parsing import parse_model_output
from wastewise_grocery_vlm.schemas import GroceryUnit, RecognizedFoodItem


@pytest_asyncio.fixture(autouse=True)
async def _clean_core_tables():
    """Override the integration suite's Postgres fixture for these unit tests."""

    yield


def _chicken(**updates) -> RecognizedFoodItem:
    values = {
        "item_id": uuid4(),
        "food_name": "whole chicken",
        "category": "fresh poultry",
        "quantity": 1,
        "unit": GroceryUnit.tray,
        "bounding_box": (10, 10, 900, 900),
        "confidence": 0.95,
        "review_required": True,
        "packaging_text_evidence": ["BEST BEFORE 06-10-26"],
    }
    values.update(updates)
    return RecognizedFoodItem(**values)


def test_exact_printed_best_before_is_parsed_as_the_candidate() -> None:
    raw = """{
      "items": [{
        "food_name": "Whole chicken",
        "quantity": 1,
        "unit": "tray",
        "bounding_box": [10, 10, 900, 900],
        "confidence": 0.95,
        "packaging_text_evidence": ["DATE 02-10-26", "BEST BEFORE 06-10-26"],
        "expiry_date_candidate": "2026-10-06",
        "expiry_text_evidence": "BEST BEFORE 06-10-26"
      }]
    }"""

    items, warnings = parse_model_output(raw, confidence_threshold=0.75)

    assert not warnings
    assert len(items) == 1
    assert items[0].expiry_date_candidate == date(2026, 10, 6)
    assert items[0].expiry_text_evidence == "BEST BEFORE 06-10-26"


def test_exact_printed_expiry_clears_any_stale_estimate() -> None:
    item = _chicken(
        expiry_date_candidate=date(2026, 10, 6),
        expiry_text_evidence="BEST BEFORE 06-10-26",
        estimated_expiry_date=date(2026, 10, 12),
        expiry_estimate_days=10,
        expiry_estimate_basis="fresh poultry estimate",
    )

    result = _with_expiry_fallbacks([item])[0]

    assert result.expiry_date_candidate == date(2026, 10, 6)
    assert result.estimated_expiry_date is None
    assert result.expiry_estimate_days is None
    assert result.expiry_estimate_basis is None


def test_missing_printed_expiry_still_receives_an_editable_estimate() -> None:
    result = _with_expiry_fallbacks([_chicken(packaging_text_evidence=[])])[0]

    assert result.expiry_date_candidate is None
    assert result.estimated_expiry_date is not None
    assert result.expiry_estimate_days is not None
    assert result.expiry_estimate_basis
