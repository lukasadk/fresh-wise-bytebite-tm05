"""Epic 9 -- price matching, unit conversion and monthly waste value.

Pure tests against the committed PriceCatcher snapshot; no database needed.
"""
from datetime import date
from decimal import Decimal
from types import SimpleNamespace

import pytest
import pytest_asyncio

from app.food_value import (
    WastedRow,
    apply_estimate,
    classify_user_unit,
    estimate_unit_value,
    get_snapshot,
    normalise_name,
    parse_price_unit,
    price_label,
    summarise_wasted,
)
from app.routers.food_value import _headline


@pytest_asyncio.fixture(autouse=True)
async def _clean_core_tables():
    # Override the integration suite's Postgres cleanup: these are pure tests.
    yield


def uv(name, unit):
    return estimate_unit_value(name, unit).unit_value_rm


# --- AC 9.1.4 label -------------------------------------------------------

def test_snapshot_is_one_month_and_label_names_it():
    snap = get_snapshot()
    assert snap.month == date(2026, 8, 1)
    assert len({i.month for i in snap.items}) == 1
    assert snap.label == "Based on Malaysian market prices, August 2026 (PriceCatcher)"
    assert price_label(date(2027, 1, 1)) == "Based on Malaysian market prices, January 2027 (PriceCatcher)"


# --- unit parsing ---------------------------------------------------------

@pytest.mark.parametrize("raw, base, amount, count", [
    ("1kg", "g", 1000, None),
    ("10 kg", "g", 10000, None),
    ("+- 500g", "g", 500, None),
    ("1.5 liter", "ml", 1500, None),
    ("345ml", "ml", 345, None),
    ("30 biji", None, None, 30),
    ("100 beg", None, None, 100),
    ("5 X 79g", "g", 395, 5),
])
def test_parse_price_unit(raw, base, amount, count):
    u = parse_price_unit(raw)
    assert (u.base, u.amount, u.count) == (base, amount, count)


def test_classify_user_unit():
    assert classify_user_unit("KG") == ("mass", 1000)
    assert classify_user_unit("L") == ("volume", 1000)
    assert classify_user_unit("pcs") == ("count", 1)
    assert classify_user_unit("dozen") == ("count", 12)
    assert classify_user_unit("carton") == ("pack", 1)
    assert classify_user_unit("") == ("blank", 1)
    assert classify_user_unit("handful") is None


# --- AC 9.1.1 matching ----------------------------------------------------

def test_name_match_ignores_case_spaces_and_size_tokens():
    assert normalise_name("  Fresh   MILK 1L ") == "fresh milk"
    assert uv("MILK", "carton") == uv("milk", "carton") == Decimal("8.49000")
    assert uv("Fresh Milk 1L", "bottle") == Decimal("8.49000")


def test_85_percent_similarity_covers_plurals_but_not_unrelated_foods():
    assert uv("Tomatoes", "kg") == Decimal("9.39000")      # 'tomato' alias, ratio 0.857
    assert uv("Egg", "pcs") == Decimal("0.48000")          # RM 14.40 / 30 eggs
    assert uv("Cheese", "pack") is None                    # 'cheese spread' is not >= 85%
    assert uv("Bread", "loaf") is None                     # not in PriceCatcher


def test_malay_names_match_too():
    assert uv("Ayam", "kg") == Decimal("9.29000")
    assert uv("santan", "ml") == Decimal("0.01995")         # RM 3.99 / 200 ml


@pytest.mark.parametrize("name, unit, expected", [
    ("Chicken breast", "kg", Decimal("13.50000")),
    ("Chicken breast", "g", Decimal("0.01350")),
    ("Milk", "ml", Decimal("0.00849")),
    ("Milk", "L", Decimal("8.49000")),
    ("Milk", "", Decimal("8.49000")),                       # blank unit = one pack
    ("Eggs", "tray", Decimal("14.40000")),
    ("Eggs", "dozen", Decimal("5.76000")),
    ("Rice", "kg", Decimal("3.59900")),                     # RM 35.99 / 10 kg
    ("Rice", "bag", Decimal("35.99000")),
    ("Instant noodles", "pcs", Decimal("1.04000")),         # RM 5.20 / 5-pack
    ("Pineapple", "", Decimal("4.49000")),                  # priced per fruit
])
def test_unit_conversion(name, unit, expected):
    assert uv(name, unit) == expected


# --- AC 9.1.2 no match ----------------------------------------------------

@pytest.mark.parametrize("name, unit", [
    ("Chicken", "pcs"),        # sold by the kilo; a piece has no known weight
    ("Tomato", "pcs"),
    ("Milk", "kg"),            # no density guessing
    ("Spinach", "bunch"),      # a package word on a loose food
    ("Milk", "handful"),       # unit not understood
    ("Dragon's breath", "kg"),
    ("", "kg"),
])
def test_unconvertible_or_unmatched_is_left_unvalued(name, unit):
    est = estimate_unit_value(name, unit)
    assert est.unit_value_rm is None and est.item_code is None
    assert est.month == date(2026, 8, 1)  # still records which snapshot was tried


def test_apply_estimate_writes_traceable_fields():
    item = SimpleNamespace(name="Milk", unit="carton")
    apply_estimate(item)
    assert item.est_unit_value_rm == Decimal("8.49000")
    assert item.est_price_item_code == "224"   # SUSU SEGAR DUTCH LADY, 1 liter
    assert item.est_price_month == date(2026, 8, 1)


# --- AC 9.3.1 - 9.4.2 monthly summary --------------------------------------

def row(name, qty, unit_value, category="Dairy", unit="carton"):
    return WastedRow(name=name, category=category, unit=unit, quantity=Decimal(str(qty)),
                     unit_value_rm=None if unit_value is None else Decimal(str(unit_value)))


def test_monthly_total_is_unit_value_times_wasted_quantity():
    s = summarise_wasted([row("Milk", 2, "8.49"), row("Chicken", 0.5, "9.29", "Protein", "kg")])
    assert s["total_rm"] == pytest.approx(16.98 + 4.65)
    assert s["sufficient"] and s["unvalued_count"] == 0


def test_low_coverage_flags_insufficient():
    s = summarise_wasted([row("Milk", 1, "8.49"), row("Bread", 1, None), row("Kuih", 1, None)])
    assert s["valued_count"] == 1 and s["unvalued_count"] == 2
    assert s["sufficient"] is False                     # 1 of 3 < 50%
    assert summarise_wasted([row("Milk", 1, "8.49"), row("Bread", 1, None)])["sufficient"] is True  # exactly 50%
    assert summarise_wasted([])["sufficient"] is False


def test_categories_top_five_plus_other_sorted_desc():
    rows = [row(f"x{i}", 1, v, cat) for i, (cat, v) in enumerate([
        ("Dairy", 10), ("Protein", 30), ("Fruit", 5), ("Vegetables", 20),
        ("Pantry", 3), ("Frozen", 2), ("Beverages", 1), ("Other", 4)])]
    cats = summarise_wasted(rows)["by_category"]
    assert [c["label"] for c in cats] == ["Protein", "Vegetables", "Dairy", "Fruit", "Pantry", "Other"]
    assert cats[-1] == {"label": "Other", "value_rm": 7.0, "is_other": True}   # Other 4 + Frozen 2 + Beverages 1


def test_top_three_groups_by_name_ignoring_case():
    s = summarise_wasted([
        row("Milk", 1, "8.49"), row("milk ", 1, "8.49"),
        row("Chicken", 1, "9.29", "Protein", "kg"), row("Eggs", 3, "0.48", "Protein", "pcs"),
        row("Rice", 1, "3.60", "Pantry", "kg"),
    ])
    top = s["top_items"]
    assert [t["name"] for t in top] == ["Milk", "Chicken", "Rice"]
    assert top[0]["value_rm"] == 16.98 and top[0]["quantity"] == 2


def test_all_items_ranks_every_valued_item_and_unpriced_items_are_grouped():
    s = summarise_wasted([
        row("Milk", 1, "8.49"), row("Chicken", 1, "9.29", "Protein", "kg"),
        row("Eggs", 3, "0.48", "Protein", "pcs"), row("Rice", 1, "3.60", "Pantry", "kg"),
        row("Kuih", 2, None, "Other", "pcs"), row("kuih ", 1, None, "Other", "pcs"), row("Herbs", 1, None),
    ])
    assert [t["name"] for t in s["all_items"]] == ["Chicken", "Milk", "Rice", "Eggs"]
    assert s["top_items"] == s["all_items"][:3]
    assert [(u["name"], u["quantity"]) for u in s["unpriced_items"]] == [("Kuih", 3.0), ("Herbs", 1.0)]
    assert "value_rm" not in s["unpriced_items"][0]


def test_headline_wording():
    assert _headline(32.4, -12.2, True) == "About RM 32 of food wasted this month, about RM 12 less than last month"
    assert _headline(32.4, 5, True).endswith("about RM 5 more than last month")
    assert _headline(32.4, None, True) == "About RM 32 of food wasted this month"
    assert _headline(32.4, 0.2, True).endswith("about the same as last month")
    assert _headline(None, None, False) is None
