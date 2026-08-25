import uuid

import pytest
from httpx import AsyncClient

pytestmark = pytest.mark.asyncio


async def _add_item(client: AsyncClient, device_id: str, **overrides) -> dict:
    body = {
        "name": "Milk",
        "category": "Dairy",
        "canonical_food_name": "milk",
        "quantity": 1,
        "unit": "carton",
        "purchase_date": "2026-08-20",
        "expiry_date": "2026-08-27",
    }
    body.update(overrides)
    resp = await client.post("/v1/pantry", json=body, headers={"X-Device-Id": device_id})
    assert resp.status_code == 201
    return resp.json()


async def test_create_and_list_pantry_item(client: AsyncClient, registered_device: str):
    item = await _add_item(client, registered_device)
    assert item["status"] == "active"
    assert item["days_to_expiry"] is not None

    resp = await client.get("/v1/pantry", headers={"X-Device-Id": registered_device})
    assert resp.status_code == 200
    assert len(resp.json()) == 1


async def test_pantry_isolated_between_devices(client: AsyncClient, registered_device: str):
    item = await _add_item(client, registered_device)
    other_device = str(uuid.uuid4())
    await client.post("/v1/users", json={"user_id": other_device, "household_size": 1})

    resp = await client.get(f"/v1/pantry/{item['item_id']}", headers={"X-Device-Id": other_device})
    assert resp.status_code == 404


async def test_log_full_waste_marks_item_wasted(client: AsyncClient, registered_device: str):
    item = await _add_item(client, registered_device)
    resp = await client.post(
        "/v1/logs",
        json={"item_id": item["item_id"], "status": "wasted", "quantity": 1, "waste_reason": "spoiled"},
        headers={"X-Device-Id": registered_device},
    )
    assert resp.status_code == 201

    resp = await client.get(f"/v1/pantry/{item['item_id']}", headers={"X-Device-Id": registered_device})
    assert resp.json()["status"] == "wasted"
    assert resp.json()["quantity"] == 0


async def test_log_partial_consumption_marks_partially_used(client: AsyncClient, registered_device: str):
    item = await _add_item(client, registered_device, quantity=500, unit="g", canonical_food_name="chicken breast")
    resp = await client.post(
        "/v1/logs",
        json={"item_id": item["item_id"], "status": "consumed", "quantity": 300},
        headers={"X-Device-Id": registered_device},
    )
    assert resp.status_code == 201

    resp = await client.get(f"/v1/pantry/{item['item_id']}", headers={"X-Device-Id": registered_device})
    body = resp.json()
    assert body["status"] == "partially_used"
    assert body["quantity"] == 200


async def test_log_more_than_remaining_is_rejected(client: AsyncClient, registered_device: str):
    item = await _add_item(client, registered_device, quantity=1)
    resp = await client.post(
        "/v1/logs",
        json={"item_id": item["item_id"], "status": "consumed", "quantity": 5},
        headers={"X-Device-Id": registered_device},
    )
    assert resp.status_code == 422


async def test_waste_reason_required_when_wasted(client: AsyncClient, registered_device: str):
    item = await _add_item(client, registered_device)
    resp = await client.post(
        "/v1/logs",
        json={"item_id": item["item_id"], "status": "wasted", "quantity": 1},
        headers={"X-Device-Id": registered_device},
    )
    assert resp.status_code == 422


async def test_dashboard_summary_reflects_logs(client: AsyncClient, registered_device: str):
    item = await _add_item(client, registered_device)
    await client.post(
        "/v1/logs",
        json={"item_id": item["item_id"], "status": "wasted", "quantity": 1, "waste_reason": "expired"},
        headers={"X-Device-Id": registered_device},
    )

    resp = await client.get("/v1/dashboard/summary", headers={"X-Device-Id": registered_device})
    assert resp.status_code == 200
    body = resp.json()
    assert body["total_wasted_events"] == 1
    assert body["total_wasted_quantity"] == 1.0
    assert body["waste_rate"] == 1.0
