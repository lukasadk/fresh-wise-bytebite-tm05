"""Epic 8 -- Smart Shopping List.

Epic 7 is faked by putting a module at `app.purchase_insights` into
sys.modules, which is exactly where the real one will live -- so these tests
exercise the same discovery path Epic 7's real code will go through.
"""
import sys
import types
import uuid
from datetime import date, timedelta

import pytest
from httpx import AsyncClient

pytestmark = pytest.mark.asyncio

EPIC7_MODULE = "app.purchase_insights"


def _fake_epic7(monkeypatch, recs=None, error: Exception | None = None):
    module = types.ModuleType(EPIC7_MODULE)

    async def compute_purchase_recommendations(db, user):
        if error:
            raise error
        return recs or []

    module.compute_purchase_recommendations = compute_purchase_recommendations
    monkeypatch.setitem(sys.modules, EPIC7_MODULE, module)


def _h(device_id: str) -> dict:
    return {"X-Device-Id": device_id}


async def _pantry(client, device_id, name, qty=1, category="Dairy", expiry_days=5) -> dict:
    body = {
        "name": name,
        "category": category,
        "quantity": qty,
        "unit": "carton",
        "expiry_date": (date.today() + timedelta(days=expiry_days)).isoformat(),
    }
    resp = await client.post("/v1/pantry", json=body, headers=_h(device_id))
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _list(client, device_id) -> dict:
    resp = await client.get("/v1/shopping-list", headers=_h(device_id))
    assert resp.status_code == 200, resp.text
    return resp.json()


async def _add(client, device_id, name, qty=1, category="Dairy", force=False):
    return await client.post(
        "/v1/shopping-list/items",
        json={"name": name, "category": category, "quantity": qty, "force": force},
        headers=_h(device_id),
    )


# --- Before Epic 7 exists ----------------------------------------------------


async def test_works_without_epic7(client: AsyncClient, registered_device: str, monkeypatch):
    # Epic 7 now exists in the repo, so hide its provider to test the
    # "Epic 7 not deployed" path: a module without the function counts as absent.
    monkeypatch.setitem(sys.modules, EPIC7_MODULE, types.ModuleType(EPIC7_MODULE))
    data = await _list(client, registered_device)
    assert data == {"to_buy": [], "bought": [], "skipped": [], "recommendations_available": False}

    resp = await _add(client, registered_device, "Bread", category="Pantry")
    assert resp.status_code == 201
    assert resp.json()["source"] == "manual"
    assert [i["name"] for i in (await _list(client, registered_device))["to_buy"]] == ["Bread"]


async def test_broken_epic7_does_not_break_list(client, registered_device, monkeypatch):
    _fake_epic7(monkeypatch, error=RuntimeError("epic 7 bug"))
    data = await _list(client, registered_device)
    assert data["recommendations_available"] is False


# --- 8.1 Auto-generated list ---------------------------------------------------


async def test_suggested_and_skipped(client, registered_device, monkeypatch):
    _fake_epic7(
        monkeypatch,
        [
            {"name": "Milk", "category": "Dairy", "state": "BUY_MORE", "recommended_qty": 2},
            {"name": "Eggs", "category": "Protein", "state": "keep_same", "recommended_qty": 1},
            {"name": "Bread", "category": "Pantry", "state": "BUY_LESS", "recommended_qty": 0},
            {"name": "Spinach", "category": "Vegetables", "state": "DO_NOT_BUY_YET", "reason": "You wasted 2 bunches"},
        ],
    )
    data = await _list(client, registered_device)
    assert data["recommendations_available"] is True
    to_buy = {i["name"]: i for i in data["to_buy"]}
    assert set(to_buy) == {"Milk", "Eggs"}  # Bread has qty 0 -> left out (AC 8.1.2)
    assert to_buy["Milk"]["source"] == "suggested"
    assert to_buy["Milk"]["rec_state"] == "BUY_MORE"
    assert to_buy["Milk"]["quantity"] == 2
    assert to_buy["Eggs"]["rec_state"] == "KEEP_SAME"
    assert data["skipped"] == [{"name": "Spinach", "category": "Vegetables", "reason": "You wasted 2 bunches"}]

    # Opening the list again doesn't duplicate suggestions.
    assert len((await _list(client, registered_device))["to_buy"]) == 2


async def test_removed_suggestion_returns_after_new_pantry_entry(client, registered_device, monkeypatch):
    _fake_epic7(monkeypatch, [{"name": "Milk", "category": "Dairy", "state": "BUY_MORE", "recommended_qty": 2}])
    milk = (await _list(client, registered_device))["to_buy"][0]

    resp = await client.delete(f"/v1/shopping-list/items/{milk['list_item_id']}", headers=_h(registered_device))
    assert resp.status_code == 204
    assert (await _list(client, registered_device))["to_buy"] == []  # not suggested again (AC 8.1.6)

    await _pantry(client, registered_device, "milk", qty=1)
    assert [i["name"] for i in (await _list(client, registered_device))["to_buy"]] == ["Milk"]


async def test_suggestion_dropped_when_no_longer_recommended(client, registered_device, monkeypatch):
    _fake_epic7(monkeypatch, [{"name": "Milk", "category": "Dairy", "state": "BUY_MORE", "recommended_qty": 2}])
    assert len((await _list(client, registered_device))["to_buy"]) == 1
    _fake_epic7(monkeypatch, [{"name": "Milk", "category": "Dairy", "state": "DO_NOT_BUY_YET", "reason": "x"}])
    data = await _list(client, registered_device)
    assert data["to_buy"] == []
    assert data["skipped"][0]["name"] == "Milk"


async def test_name_suggestions(client, registered_device):
    await _pantry(client, registered_device, "Milk", category="Other")
    await _pantry(client, registered_device, "Milk")  # same name again: latest category wins, listed once
    await _pantry(client, registered_device, "Oat milk")
    await _pantry(client, registered_device, "Eggs", category="Protein")
    resp = await client.get("/v1/shopping-list/name-suggestions", params={"q": "mil"}, headers=_h(registered_device))
    assert resp.status_code == 200
    assert resp.json() == [
        {"name": "Milk", "category": "Dairy"},
        {"name": "Oat milk", "category": "Dairy"},
    ]


async def test_empty_name_rejected(client, registered_device):
    resp = await _add(client, registered_device, "   ")
    assert resp.status_code == 422


# --- 8.2 Duplicate warning --------------------------------------------------------


async def test_duplicate_warning_and_add_anyway(client, registered_device):
    later = await _pantry(client, registered_device, "Milk", qty=1, expiry_days=6)
    sooner = await _pantry(client, registered_device, "milk", qty=1, expiry_days=2)

    resp = await _add(client, registered_device, "MILK")
    assert resp.status_code == 409
    warning = resp.json()
    assert warning["code"] == "duplicate_stock"
    assert warning["qty_at_home"] == 2
    assert warning["pantry_item_id"] == sooner["item_id"]  # earliest expiry
    assert warning["earliest_expiry"] == sooner["expiry_date"]
    assert later["item_id"] != sooner["item_id"]
    assert (await _list(client, registered_device))["to_buy"] == []  # not added yet (AC 8.2.1)

    resp = await _add(client, registered_device, "MILK", force=True)
    assert resp.status_code == 201
    assert resp.json()["have_at_home_qty"] == 2  # "Have 2 at home" tag (AC 8.2.2)


async def test_similar_name_triggers_warning(client, registered_device):
    await _pantry(client, registered_device, "Tomatoes", category="Vegetables")
    assert (await _add(client, registered_device, "Tomatoe", category="Vegetables")).status_code == 409
    assert (await _add(client, registered_device, "Potatoes", category="Vegetables")).status_code == 201


async def test_expired_stock_ignored(client, registered_device):
    await _pantry(client, registered_device, "Milk", expiry_days=-1)
    resp = await _add(client, registered_device, "Milk")
    assert resp.status_code == 201  # AC 8.2.4
    assert resp.json()["have_at_home_qty"] is None


# --- 8.3 Auto-tick ------------------------------------------------------------------


async def test_partial_then_full_match(client, registered_device):
    row = (await _add(client, registered_device, "Apples", qty=3, category="Fruit")).json()

    saved = await _pantry(client, registered_device, "apples", qty=1, category="Fruit")
    assert saved["shopping_ticked"] is False
    data = await _list(client, registered_device)
    assert data["to_buy"][0]["remaining_qty"] == 2  # "2 of 3 left" (AC 8.3.3)

    saved = await _pantry(client, registered_device, "Apple", qty=2, category="fruit")
    assert saved["shopping_ticked"] is True
    data = await _list(client, registered_device)
    assert data["to_buy"] == []
    assert data["bought"][0]["list_item_id"] == row["list_item_id"]
    assert data["bought"][0]["bought_at"] is not None  # AC 8.3.2


async def test_category_must_match(client, registered_device):
    await _add(client, registered_device, "Apples", category="Fruit")
    saved = await _pantry(client, registered_device, "Apples", category="Other")
    assert saved["shopping_ticked"] is False
    assert len((await _list(client, registered_device))["to_buy"]) == 1


async def test_one_save_ticks_one_row(client, registered_device):
    await _add(client, registered_device, "Bread", category="Pantry")
    await _add(client, registered_device, "Bread", category="Pantry")
    await _pantry(client, registered_device, "Bread", qty=5, category="Pantry")
    data = await _list(client, registered_device)
    assert len(data["bought"]) == 1 and len(data["to_buy"]) == 1


async def test_manual_tick_untick_and_clear(client, registered_device):
    row = (await _add(client, registered_device, "Bread", category="Pantry")).json()
    url = f"/v1/shopping-list/items/{row['list_item_id']}"

    resp = await client.patch(url, json={"status": "bought"}, headers=_h(registered_device))
    assert resp.status_code == 200 and resp.json()["bought_at"] is not None
    resp = await client.patch(url, json={"status": "to_buy"}, headers=_h(registered_device))
    assert resp.json()["status"] == "to_buy" and resp.json()["bought_at"] is None

    await client.patch(url, json={"status": "bought"}, headers=_h(registered_device))
    resp = await client.delete("/v1/shopping-list/bought", headers=_h(registered_device))
    assert resp.status_code == 204
    data = await _list(client, registered_device)
    assert data["bought"] == [] and data["to_buy"] == []


async def test_user_can_edit_recommended_quantity(client, registered_device, monkeypatch):
    _fake_epic7(monkeypatch, [{"name": "Milk", "category": "Dairy", "state": "BUY_LESS", "recommended_qty": 2}])
    row = (await _list(client, registered_device))["to_buy"][0]
    url = f"/v1/shopping-list/items/{row['list_item_id']}"

    resp = await client.patch(url, json={"quantity": 1}, headers=_h(registered_device))

    assert resp.status_code == 200
    assert resp.json()["quantity"] == 1
    assert resp.json()["remaining_qty"] == 1
    assert resp.json()["source"] == "manual"
    # A later list refresh must retain the user's explicit quantity.
    assert (await _list(client, registered_device))["to_buy"][0]["quantity"] == 1


async def test_rows_isolated_between_devices(client, registered_device):
    row = (await _add(client, registered_device, "Bread", category="Pantry")).json()
    other = str(uuid.uuid4())
    await client.post("/v1/users", json={"user_id": other, "household_size": 1})
    resp = await client.delete(f"/v1/shopping-list/items/{row['list_item_id']}", headers=_h(other))
    assert resp.status_code == 404


async def test_missing_category_taken_from_pantry_history(client, registered_device):
    await _pantry(client, registered_device, "Milk", category="Dairy", expiry_days=-3)  # expired: no warning
    resp = await client.post(
        "/v1/shopping-list/items", json={"name": "milk"}, headers=_h(registered_device)
    )
    assert resp.status_code == 201
    assert resp.json()["category"] == "Dairy"
    # ...so it auto-ticks against the Dairy milk the user brings home.
    saved = await _pantry(client, registered_device, "Milk", category="Dairy")
    assert saved["shopping_ticked"] is True

    resp = await client.post(
        "/v1/shopping-list/items", json={"name": "Dragonfruit"}, headers=_h(registered_device)
    )
    assert resp.json()["category"] == "Other"


async def test_pantry_save_survives_missing_shopping_tables(client, registered_device):
    """Backend deployed before db/003_shopping_list.sql ran: pantry saves must still work."""
    from sqlalchemy import text

    from app.db import engine

    async with engine.begin() as conn:
        await conn.execute(text("ALTER TABLE shopping_list_item RENAME TO shopping_list_item_hidden"))
    try:
        saved = await _pantry(client, registered_device, "Milk")
        assert saved["shopping_ticked"] is False
        resp = await client.get("/v1/pantry", headers=_h(registered_device))
        assert [i["name"] for i in resp.json()] == ["Milk"]
    finally:
        async with engine.begin() as conn:
            await conn.execute(text("ALTER TABLE shopping_list_item_hidden RENAME TO shopping_list_item"))
