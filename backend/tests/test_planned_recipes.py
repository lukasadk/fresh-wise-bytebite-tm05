"""Planned recipes ("Plan to cook") -- /v1/planned-recipes."""
import sys
import types
import uuid
from datetime import date, timedelta

import pytest
from httpx import AsyncClient

pytestmark = pytest.mark.asyncio

EPIC7_MODULE = "app.purchase_insights"


@pytest.fixture(autouse=True)
def _no_epic7_suggestions(monkeypatch):
    # Keep the shopping list to manual rows only, so the assertions below
    # only see what planning added.
    module = types.ModuleType(EPIC7_MODULE)

    async def compute_purchase_recommendations(db, user):
        return []

    module.compute_purchase_recommendations = compute_purchase_recommendations
    monkeypatch.setitem(sys.modules, EPIC7_MODULE, module)


NASI_LEMAK = {
    "recipe_key": "title:nasi lemak",
    "title": "Nasi lemak",
    "ingredients": ["Coconut milk", " Anchovies ", "", "Cucumber", "coconut milk"],
    "recipe": {"recipe_id": "rag-1", "title": "Nasi lemak", "steps": ["Cook rice", "Fry anchovies"]},
}


def _h(device_id: str) -> dict:
    return {"X-Device-Id": device_id}


async def _plan(client: AsyncClient, device_id: str, body: dict | None = None) -> dict:
    resp = await client.post("/v1/planned-recipes", json=body or NASI_LEMAK, headers=_h(device_id))
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _to_buy(client: AsyncClient, device_id: str) -> list[str]:
    resp = await client.get("/v1/shopping-list", headers=_h(device_id))
    assert resp.status_code == 200, resp.text
    return sorted(i["name"] for i in resp.json()["to_buy"])


async def _pantry(client: AsyncClient, device_id: str, name: str, expiry_days: int = 5) -> None:
    body = {
        "name": name,
        "category": "Pantry",
        "quantity": 1,
        "unit": "piece",
        "expiry_date": (date.today() + timedelta(days=expiry_days)).isoformat(),
    }
    resp = await client.post("/v1/pantry", json=body, headers=_h(device_id))
    assert resp.status_code == 201, resp.text


async def test_plan_saves_recipe_and_adds_missing_ingredients(client: AsyncClient, registered_device: str):
    result = await _plan(client, registered_device)
    # Blank and repeated names are dropped; text is trimmed.
    assert result["added"] == ["Coconut milk", "Anchovies", "Cucumber"]
    assert result["already_planned"] is False
    assert len(result["plan"]["shopping_item_ids"]) == 3
    assert result["plan"]["recipe"]["steps"] == ["Cook rice", "Fry anchovies"]

    assert await _to_buy(client, registered_device) == ["Anchovies", "Coconut milk", "Cucumber"]

    resp = await client.get("/v1/planned-recipes", headers=_h(registered_device))
    assert resp.status_code == 200
    assert [p["title"] for p in resp.json()] == ["Nasi lemak"]


async def test_skips_items_already_on_list_or_at_home(client: AsyncClient, registered_device: str):
    resp = await client.post(
        "/v1/shopping-list/items", json={"name": "Cucumber", "quantity": 1}, headers=_h(registered_device)
    )
    assert resp.status_code == 201
    await _pantry(client, registered_device, "Anchovies")
    await _pantry(client, registered_device, "Coconut milk", expiry_days=-2)  # expired: still needed

    result = await _plan(client, registered_device)
    assert result["added"] == ["Coconut milk"]
    assert result["already_on_list"] == ["Cucumber"]
    assert result["already_at_home"] == ["Anchovies"]
    # No second Cucumber row.
    assert await _to_buy(client, registered_device) == ["Coconut milk", "Cucumber"]


async def test_planning_twice_keeps_one_plan(client: AsyncClient, registered_device: str):
    first = await _plan(client, registered_device)
    second = await _plan(client, registered_device)
    assert second["already_planned"] is True
    assert second["plan"]["planned_id"] == first["plan"]["planned_id"]
    assert second["added"] == []
    assert sorted(second["already_on_list"]) == ["Anchovies", "Coconut milk", "Cucumber"]
    resp = await client.get("/v1/planned-recipes", headers=_h(registered_device))
    assert len(resp.json()) == 1
    assert await _to_buy(client, registered_device) == ["Anchovies", "Coconut milk", "Cucumber"]


async def test_remove_after_cooking_keeps_shopping_rows(client: AsyncClient, registered_device: str):
    plan = (await _plan(client, registered_device))["plan"]
    resp = await client.delete(f"/v1/planned-recipes/{plan['planned_id']}", headers=_h(registered_device))
    assert resp.status_code == 204
    assert (await client.get("/v1/planned-recipes", headers=_h(registered_device))).json() == []
    assert await _to_buy(client, registered_device) == ["Anchovies", "Coconut milk", "Cucumber"]


async def test_cancel_removes_only_unbought_rows_no_other_plan_needs(client: AsyncClient, registered_device: str):
    plan = (await _plan(client, registered_device))["plan"]
    other = await _plan(
        client,
        registered_device,
        {"recipe_key": "title:acar", "title": "Acar", "ingredients": ["Cucumber", "Carrot"], "recipe": {}},
    )
    assert other["added"] == ["Carrot"]
    assert other["already_on_list"] == ["Cucumber"]

    # Anchovies has been bought already.
    rows = (await client.get("/v1/shopping-list", headers=_h(registered_device))).json()["to_buy"]
    anchovies = next(r for r in rows if r["name"] == "Anchovies")
    resp = await client.patch(
        f"/v1/shopping-list/items/{anchovies['list_item_id']}", json={"status": "bought"}, headers=_h(registered_device)
    )
    assert resp.status_code == 200

    resp = await client.delete(
        f"/v1/planned-recipes/{plan['planned_id']}?remove_items=true", headers=_h(registered_device)
    )
    assert resp.status_code == 204
    # Coconut milk removed; Cucumber kept for Acar; bought Anchovies untouched.
    assert await _to_buy(client, registered_device) == ["Carrot", "Cucumber"]
    bought = (await client.get("/v1/shopping-list", headers=_h(registered_device))).json()["bought"]
    assert [r["name"] for r in bought] == ["Anchovies"]


async def test_households_are_isolated(client: AsyncClient, registered_device: str):
    plan = (await _plan(client, registered_device))["plan"]
    other = str(uuid.uuid4())
    resp = await client.post("/v1/users", json={"user_id": other, "household_size": 1, "location": "Johor"})
    assert resp.status_code == 200

    assert (await client.get("/v1/planned-recipes", headers=_h(other))).json() == []
    resp = await client.delete(f"/v1/planned-recipes/{plan['planned_id']}", headers=_h(other))
    assert resp.status_code == 404
    assert await _to_buy(client, other) == []


async def test_validation(client: AsyncClient, registered_device: str):
    for bad in (
        {**NASI_LEMAK, "title": "   "},
        {**NASI_LEMAK, "recipe_key": ""},
        {**NASI_LEMAK, "ingredients": ["x" * 101]},
        {**NASI_LEMAK, "ingredients": ["egg"] * 41},
        {**NASI_LEMAK, "recipe": {"notes": "x" * 20001}},
    ):
        resp = await client.post("/v1/planned-recipes", json=bad, headers=_h(registered_device))
        assert resp.status_code == 422, bad


async def test_plan_with_nothing_missing(client: AsyncClient, registered_device: str):
    result = await _plan(client, registered_device, {**NASI_LEMAK, "ingredients": []})
    assert result["added"] == []
    assert result["plan"]["shopping_item_ids"] == []
    assert await _to_buy(client, registered_device) == []
