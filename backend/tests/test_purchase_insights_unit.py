from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest
import pytest_asyncio

from app.purchase_insights import compute_purchase_recommendations


# This module tests a pure read policy with a fake AsyncSession. Override the
# integration suite's Postgres cleanup fixture so these tests remain runnable
# on a machine that does not have the test database started.
@pytest_asyncio.fixture(autouse=True)
async def _clean_core_tables():
    yield


def _row(**overrides):
    now = datetime.now(timezone.utc)
    row = {
        "item_id": uuid4(),
        "name": "Item",
        "category": None,
        "unit": "piece",
        "quantity": 0,
        "status": "consumed",
        "created_at": now,
        "consumed_qty": 0,
        "wasted_qty": 0,
        "recent_consumed_qty": 0,
        "prior_consumed_qty": 0,
    }
    row.update(overrides)
    return row


@pytest.mark.asyncio
async def test_provider_returns_all_four_states_with_exact_contract_values():
    now = datetime.now(timezone.utc)
    rows = [
        # Two completed purchases with faster recent consumption -> BUY_MORE.
        _row(
            name="milk",
            category="groceries",
            unit="carton",
            created_at=now - timedelta(days=8),
            consumed_qty=2,
            recent_consumed_qty=2,
        ),
        _row(
            name="Milk",
            category="Dairy products",
            unit="carton",
            created_at=now,
            consumed_qty=2,
            recent_consumed_qty=1,
            prior_consumed_qty=1,
        ),
        # Stable recent/prior consumption -> KEEP_SAME.
        _row(
            name="Eggs",
            category="Food",
            unit="piece",
            consumed_qty=6,
            recent_consumed_qty=3,
            prior_consumed_qty=3,
        ),
        _row(
            name="eggs",
            category="Food",
            unit="piece",
            created_at=now - timedelta(days=1),
            consumed_qty=6,
            recent_consumed_qty=3,
            prior_consumed_qty=3,
        ),
        # Half of the recorded amount was wasted -> BUY_LESS.
        _row(
            name="Yogurt",
            category="Chilled",
            unit="tub",
            consumed_qty=1,
            wasted_qty=1,
            recent_consumed_qty=1,
        ),
        # More than half a normal purchase remains -> DO_NOT_BUY_YET.
        _row(
            name="Rice",
            category="Staples",
            unit="kg",
            quantity=3,
            status="active",
            consumed_qty=2,
        ),
    ]
    result = MagicMock()
    result.mappings.return_value.all.return_value = rows
    db = AsyncMock()
    db.execute.return_value = result

    recommendations = await compute_purchase_recommendations(
        db,
        SimpleNamespace(user_id=uuid4()),
    )

    db.execute.assert_awaited_once()
    by_name = {item["name"]: item for item in recommendations}
    assert set(by_name) == {"Eggs", "Milk", "Rice", "Yogurt"}

    assert by_name["Milk"]["state"] == "BUY_MORE"
    assert by_name["Milk"]["category"] == "Dairy"
    assert by_name["Milk"]["recommended_qty"] == 3

    assert by_name["Eggs"]["state"] == "KEEP_SAME"
    assert by_name["Eggs"]["category"] == "Protein"
    assert by_name["Eggs"]["recommended_qty"] == 6

    assert by_name["Yogurt"]["state"] == "BUY_LESS"
    assert by_name["Yogurt"]["category"] == "Dairy"
    assert by_name["Yogurt"]["recommended_qty"] == 1.5

    assert by_name["Rice"]["state"] == "DO_NOT_BUY_YET"
    assert by_name["Rice"]["category"] == "Pantry"
    assert by_name["Rice"]["recommended_qty"] == 0


@pytest.mark.asyncio
async def test_provider_returns_an_empty_list_for_no_purchase_history():
    result = MagicMock()
    result.mappings.return_value.all.return_value = []
    db = AsyncMock()
    db.execute.return_value = result

    recommendations = await compute_purchase_recommendations(
        db,
        SimpleNamespace(user_id=uuid4()),
    )

    assert recommendations == []
