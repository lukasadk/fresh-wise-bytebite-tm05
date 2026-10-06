from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from app.db import get_db
from app.deps import get_current_user
from app.main import app
from app.purchase_insights import _build_recommendations, compute_purchase_recommendations
from app.schemas import (
    PurchaseRecommendationOut,
    PurchaseRecommendationRequest,
)


# This module tests a pure read policy with a fake AsyncSession. Override the
# integration suite's Postgres cleanup fixture so it is safe without Postgres.
@pytest_asyncio.fixture(autouse=True)
async def _clean_core_tables():
    yield


TODAY = date(2026, 10, 5)


def _row(**overrides):
    purchase_date = overrides.pop("purchase_date", TODAY)
    row = {
        "item_id": uuid4(),
        "name": "Item",
        "canonical_food_name": None,
        "category": None,
        "unit": "piece",
        "quantity": 0,
        "status": "consumed",
        "purchase_date": purchase_date,
        "expiry_date": None,
        "created_at": datetime.combine(purchase_date, datetime.min.time(), tzinfo=timezone.utc),
        "consumed_qty": 0,
        "wasted_qty": 0,
    }
    row.update(overrides)
    return row


def _by_name(rows):
    return {item["name"]: item for item in _build_recommendations(rows, today=TODAY)}


def test_policy_returns_all_four_next_shop_states():
    rows = [
        # 28-day interval and eight-week consumption of 12: demand 6 vs usual 4.
        _row(name="  milk", unit="carton", purchase_date=TODAY - timedelta(days=56), consumed_qty=4),
        _row(name="MILK  ", unit="carton", purchase_date=TODAY - timedelta(days=28), consumed_qty=4),
        _row(name="Milk", category="Dairy products", unit="carton", consumed_qty=4),
        # Demand 4; usual purchase 3.33, exactly 120%, so KEEP_SAME.
        _row(name="Eggs", unit="piece", purchase_date=TODAY - timedelta(days=56), consumed_qty=3, wasted_qty=1),
        _row(name="eggs", unit="piece", purchase_date=TODAY - timedelta(days=28), consumed_qty=3, wasted_qty=1),
        _row(name="Eggs", unit="piece", consumed_qty=2),
        # 14-day interval and heavy waste: demand 2 vs usual 10.
        _row(name="Yogurt", unit="tub", purchase_date=TODAY - timedelta(days=28), consumed_qty=3, wasted_qty=7),
        _row(name="yogurt", unit="tub", purchase_date=TODAY - timedelta(days=14), consumed_qty=3, wasted_qty=7),
        _row(name="Yogurt", unit="tub", consumed_qty=2, wasted_qty=8),
        # Demand 4, but 5 non-expired units are already at home.
        _row(name="Rice", unit="kg", purchase_date=TODAY - timedelta(days=56), consumed_qty=3),
        _row(name="rice", unit="kg", purchase_date=TODAY - timedelta(days=28), consumed_qty=3),
        _row(
            name="Rice",
            unit="kg",
            quantity=5,
            status="active",
            consumed_qty=2,
            expiry_date=TODAY + timedelta(days=30),
        ),
    ]

    by_name = _by_name(rows)
    assert set(by_name) == {"Eggs", "Milk", "Rice", "Yogurt"}

    milk = by_name["Milk"]
    assert milk["state"] == "BUY_MORE"
    assert milk["recommended_qty"] == 6
    assert milk["purchase_count"] == 3
    assert milk["average_purchase_interval_days"] == 28
    assert milk["days_until_next_shop"] == 28
    assert milk["category"] == "Dairy"
    assert "You usually buy 4 carton" in milk["summary"]

    eggs = by_name["Eggs"]
    assert eggs["state"] == "KEEP_SAME"
    assert eggs["recommended_qty"] == 4
    assert eggs["habit_status"] == "on_track"

    yogurt = by_name["Yogurt"]
    assert yogurt["state"] == "BUY_LESS"
    assert yogurt["recommended_qty"] == 2
    assert yogurt["over_purchase_detected"] is True
    assert yogurt["average_waste_rate"] == pytest.approx(22 / 30, abs=0.0001)
    assert yogurt["status_label"] == "Possible Over-Purchase"

    rice = by_name["Rice"]
    assert rice["state"] == "DO_NOT_BUY_YET"
    assert rice["recommended_qty"] == 0
    assert rice["current_inventory"] == 5


def test_waste_rate_uses_outcomes_and_keeps_purchase_denominator_as_secondary_metric():
    item = _by_name(
        [
            _row(
                name="Bread",
                unit="loaf",
                purchase_date=TODAY - timedelta(days=14),
                quantity=4,
                status="partially_used",
                consumed_qty=3,
                wasted_qty=1,
            ),
            _row(
                name="Bread",
                unit="loaf",
                purchase_date=TODAY - timedelta(days=7),
                quantity=3,
                status="partially_used",
                consumed_qty=3,
            ),
            _row(
                name="Bread",
                unit="loaf",
                quantity=3,
                status="partially_used",
                consumed_qty=2,
                wasted_qty=1,
            ),
        ]
    )["Bread"]

    # Board metric: 2 / (8 + 2). Secondary audit metric: 2 / (10 + 8 + 2).
    assert item["average_waste_rate"] == 0.2
    assert item["purchase_waste_rate"] == 0.1
    assert item["current_inventory"] == 10


def test_over_purchase_requires_three_trips_and_thirty_percent_outcome_waste():
    two_trip_item = _by_name(
        [
            _row(name="Spinach", purchase_date=TODAY - timedelta(days=7), consumed_qty=1, wasted_qty=9),
            _row(name="Spinach", consumed_qty=1, wasted_qty=9),
        ]
    )["Spinach"]
    assert two_trip_item["over_purchase_detected"] is False
    assert two_trip_item["habit_status"] == "still_learning"
    assert two_trip_item["status_label"] == "Not enough history"
    assert two_trip_item["average_waste_rate"] is None
    assert two_trip_item["purchase_waste_rate"] is None
    assert "Record 1 more shopping trip" in two_trip_item["summary"]
    assert "90%" not in two_trip_item["summary"]
    assert two_trip_item["reason"].startswith("Early estimate from 2 recent purchases")
    assert two_trip_item["recommendation_available"] is True
    assert two_trip_item["recommended_qty"] == 1

    three_trip_item = _by_name(
        [
            _row(name="Spinach", purchase_date=TODAY - timedelta(days=14), consumed_qty=7, wasted_qty=3),
            _row(name="Spinach", purchase_date=TODAY - timedelta(days=7), consumed_qty=7, wasted_qty=3),
            _row(name="Spinach", consumed_qty=7, wasted_qty=3),
        ]
    )["Spinach"]
    assert three_trip_item["average_waste_rate"] == 0.3
    assert three_trip_item["over_purchase_detected"] is True
    assert three_trip_item["habit_status"] == "possible_over_purchase"
    assert "About 30%" in three_trip_item["summary"]


def test_eight_week_window_and_non_expired_inventory_are_applied_separately():
    rows = [
        _row(name="Beans", purchase_date=TODAY - timedelta(days=80), consumed_qty=100),
        _row(
            name="Beans",
            purchase_date=TODAY - timedelta(days=70),
            quantity=2,
            status="active",
            expiry_date=TODAY + timedelta(days=5),
        ),
        _row(
            name="Beans",
            purchase_date=TODAY - timedelta(days=65),
            quantity=9,
            status="active",
            expiry_date=TODAY - timedelta(days=1),
        ),
        _row(name="Beans", purchase_date=TODAY - timedelta(days=56), consumed_qty=4),
        _row(name="Beans", purchase_date=TODAY - timedelta(days=28), consumed_qty=4),
        _row(name="Beans", consumed_qty=4),
    ]

    item = _by_name(rows)["Beans"]
    assert item["purchase_count"] == 3
    assert item["average_consumption"] == 4
    assert item["current_inventory"] == 2
    assert item["evidence_window_days"] == 56


def test_exact_unit_conversion_and_incompatible_unit_exclusion():
    rows = [
        _row(name="Plain Flour", unit="g", purchase_date=TODAY - timedelta(days=14), consumed_qty=1000),
        _row(name="  plain   flour ", unit="bag", purchase_date=TODAY - timedelta(days=7), consumed_qty=1),
        _row(name="PLAIN FLOUR", unit="kg", consumed_qty=1),
    ]

    item = _by_name(rows)["PLAIN FLOUR"]
    assert item["unit"] == "kg"
    assert item["usual_purchase"] == 1
    assert item["purchase_count"] == 2
    assert item["average_purchase_interval_days"] == 14
    assert any("Excluded 1" in warning for warning in item["warnings"])


def test_most_common_compatible_unit_wins_over_newest_incompatible_unit():
    rows = [
        _row(name="Milk", unit="carton", purchase_date=TODAY - timedelta(days=21), consumed_qty=1),
        _row(name="Milk", unit="carton", purchase_date=TODAY - timedelta(days=14), consumed_qty=1),
        _row(name="Milk", unit="carton", purchase_date=TODAY - timedelta(days=7), consumed_qty=1),
        _row(name="Milk", unit="piece", consumed_qty=1),
        _row(name="Orange Juice", unit="ml", purchase_date=TODAY - timedelta(days=21), consumed_qty=500),
        _row(name="Orange Juice", unit="ml", purchase_date=TODAY - timedelta(days=14), consumed_qty=500),
        _row(name="Orange Juice", unit="l", purchase_date=TODAY - timedelta(days=7), consumed_qty=1),
        _row(name="Orange Juice", unit="piece", consumed_qty=1),
    ]

    items = _by_name(rows)
    milk = items["Milk"]
    assert milk["unit"] == "carton"
    assert milk["purchase_count"] == 3
    assert any("Excluded 1" in warning and "carton" in warning for warning in milk["warnings"])

    orange_juice = items["Orange Juice"]
    assert orange_juice["unit"] == "ml"
    assert orange_juice["purchase_count"] == 3
    assert orange_juice["category"] == "Beverages"
    assert any("Excluded 1" in warning and "ml" in warning for warning in orange_juice["warnings"])


@pytest.mark.parametrize(
    ("name", "expected_category"),
    [
        ("Salmon", "Protein"),
        ("Tilapia", "Protein"),
        ("Turkey", "Protein"),
        ("Tomatoes", "Vegetables"),
        ("Zucchini", "Vegetables"),
    ],
)
def test_specific_food_names_are_normalised_for_shopping_list_matching(
    name: str,
    expected_category: str,
):
    item = _by_name([_row(name=name)])[name]
    assert item["category"] == expected_category


def test_two_dates_use_observed_interval_but_report_not_enough_history():
    item = _by_name(
        [
            _row(name="Apples", purchase_date=TODAY - timedelta(days=20), consumed_qty=4),
            _row(name="Apples", consumed_qty=4),
        ]
    )["Apples"]

    assert item["purchase_count"] == 2
    assert item["average_purchase_interval_days"] == 20
    assert item["days_until_next_shop"] == 20
    assert item["is_cold_start"] is True
    assert item["recommendation_available"] is True
    assert item["status_label"] == "Not enough history"
    assert item["average_waste_rate"] is None


def test_reason_text_matches_each_board_pattern():
    items = _by_name(
        [
            _row(name="More", unit="pack", purchase_date=TODAY - timedelta(days=56), consumed_qty=4),
            _row(name="More", unit="pack", purchase_date=TODAY - timedelta(days=28), consumed_qty=4),
            _row(name="More", unit="pack", consumed_qty=4),
            _row(name="Same", unit="pack", purchase_date=TODAY - timedelta(days=56), consumed_qty=3, wasted_qty=1),
            _row(name="Same", unit="pack", purchase_date=TODAY - timedelta(days=28), consumed_qty=3, wasted_qty=1),
            _row(name="Same", unit="pack", consumed_qty=2),
            _row(name="Less", unit="pack", purchase_date=TODAY - timedelta(days=28), consumed_qty=3, wasted_qty=7),
            _row(name="Less", unit="pack", purchase_date=TODAY - timedelta(days=14), consumed_qty=3, wasted_qty=7),
            _row(name="Less", unit="pack", consumed_qty=2, wasted_qty=8),
            _row(name="None", unit="pack", purchase_date=TODAY - timedelta(days=56), consumed_qty=3),
            _row(name="None", unit="pack", purchase_date=TODAY - timedelta(days=28), consumed_qty=3),
            _row(name="None", unit="pack", quantity=5, status="active", consumed_qty=2),
        ]
    )

    assert items["More"]["reason"] == "You usually use all 4 pack and run out before your next shop."
    assert items["Same"]["reason"] == "Your usual amount matches what you use."
    assert items["Less"]["reason"] == (
        "You usually buy 10 pack, use about 2.67 pack and waste about 7.33 pack. Try 2 pack."
    )
    assert items["None"]["reason"] == "You still have 5 pack at home — enough until your next shop."


def test_eighty_and_one_hundred_twenty_percent_boundaries_keep_same():
    items = _by_name(
        [
            # Total consumption 16 over 8 weeks × a 4-week interval = 8.
            _row(name="Lower Boundary", purchase_date=TODAY - timedelta(days=56), consumed_qty=6, wasted_qty=4),
            _row(name="Lower Boundary", purchase_date=TODAY - timedelta(days=28), consumed_qty=5, wasted_qty=5),
            _row(name="Lower Boundary", consumed_qty=5, wasted_qty=5),
            # Total consumption 24 over 8 weeks × a 4-week interval = 12.
            _row(name="Upper Boundary", purchase_date=TODAY - timedelta(days=56), consumed_qty=8, wasted_qty=2),
            _row(name="Upper Boundary", purchase_date=TODAY - timedelta(days=28), consumed_qty=8, wasted_qty=2),
            _row(name="Upper Boundary", consumed_qty=8, wasted_qty=2),
        ]
    )

    assert items["Lower Boundary"]["usual_purchase"] == 10
    assert items["Lower Boundary"]["recommended_qty"] == 8
    assert items["Lower Boundary"]["state"] == "KEEP_SAME"
    assert items["Upper Boundary"]["usual_purchase"] == 10
    assert items["Upper Boundary"]["recommended_qty"] == 12
    assert items["Upper Boundary"]["state"] == "KEEP_SAME"


@pytest.mark.asyncio
async def test_provider_executes_one_query_and_empty_history_is_safe():
    result = MagicMock()
    result.mappings.return_value.all.return_value = []
    db = AsyncMock()
    db.execute.return_value = result

    recommendations = await compute_purchase_recommendations(db, SimpleNamespace(user_id=uuid4()))

    db.execute.assert_awaited_once()
    assert recommendations == []


def test_public_schema_and_all_routes_are_registered():
    request = PurchaseRecommendationRequest(food_name="  Milk  ")
    assert request.food_name == "Milk"

    item = _by_name([_row(name="Milk", unit="carton", quantity=1, status="active")])["Milk"]
    validated = PurchaseRecommendationOut.model_validate(item)
    assert validated.food_name == "Milk"
    assert validated.recommendation == validated.state
    assert validated.summary.startswith("You probably do not need to buy Milk yet.")
    assert validated.method == "rule_baseline_v2_early_estimate"

    paths = app.openapi()["paths"]
    assert "get" in paths["/v1/purchase-insights"]
    assert "post" in paths["/v1/purchase-insights/recommend"]
    assert "post" in paths["/api/shopping/recommend"]
    assert "get" in paths["/v1/shopping-list"]
    assert "post" in paths["/v1/shopping-list/items"]
    assert "delete" in paths["/v1/shopping-list/items/{list_item_id}"]


@pytest.mark.asyncio
@pytest.mark.parametrize("path", ["/v1/purchase-insights/recommend", "/api/shopping/recommend"])
async def test_post_recommendation_contract_filters_internal_fields(path: str):
    result = MagicMock()
    result.mappings.return_value.all.return_value = [
        _row(name="Milk", unit="carton", quantity=1, status="active")
    ]
    db = AsyncMock()
    db.execute.return_value = result
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(user_id=uuid4())

    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.post(path, json={"food_name": "Milk"})
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    body = response.json()
    assert body["food_name"] == "Milk"
    assert body["recommendation"] == body["state"]
    assert body["recommendation_available"] is True
    assert body["recommended_qty"] == 0
    assert body["status_label"] == "Not enough history"
    assert body["average_waste_rate"] is None
    assert body["summary"].startswith("You probably do not need to buy Milk yet.")
    assert body["evidence_window_days"] == 56
    assert body["method"] == "rule_baseline_v2_early_estimate"
    assert "_aliases" not in body
