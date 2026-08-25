import uuid

import pytest
from httpx import AsyncClient

pytestmark = pytest.mark.asyncio


async def test_register_creates_profile(client: AsyncClient, device_id: str):
    resp = await client.post("/v1/users", json={"user_id": device_id, "household_size": 4})
    assert resp.status_code == 200
    body = resp.json()
    assert body["user_id"] == device_id
    assert body["household_size"] == 4
    assert body["risk_score"] == "low"


async def test_register_is_idempotent(client: AsyncClient, device_id: str):
    await client.post("/v1/users", json={"user_id": device_id, "household_size": 4})
    resp = await client.post("/v1/users", json={"user_id": device_id, "household_size": 99})
    assert resp.status_code == 200
    # Second call must NOT overwrite -- get-or-create returns the existing row.
    assert resp.json()["household_size"] == 4


async def test_me_requires_header(client: AsyncClient):
    resp = await client.get("/v1/users/me")
    assert resp.status_code == 400


async def test_me_404_for_unregistered_device(client: AsyncClient):
    resp = await client.get("/v1/users/me", headers={"X-Device-Id": str(uuid.uuid4())})
    assert resp.status_code == 404


async def test_update_me(client: AsyncClient, registered_device: str):
    resp = await client.patch(
        "/v1/users/me", json={"household_size": 5}, headers={"X-Device-Id": registered_device}
    )
    assert resp.status_code == 200
    assert resp.json()["household_size"] == 5


async def test_delete_me(client: AsyncClient, registered_device: str):
    resp = await client.delete("/v1/users/me", headers={"X-Device-Id": registered_device})
    assert resp.status_code == 204
    resp = await client.get("/v1/users/me", headers={"X-Device-Id": registered_device})
    assert resp.status_code == 404
