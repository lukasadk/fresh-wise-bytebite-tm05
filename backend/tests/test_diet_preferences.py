import pytest
from httpx import AsyncClient

pytestmark = pytest.mark.asyncio


async def test_add_diet_preference(client: AsyncClient, registered_device: str):
    resp = await client.post(
        "/v1/diet-preferences", json={"tag": "high-protein", "target_value": 80}, headers={"X-Device-Id": registered_device}
    )
    assert resp.status_code == 201
    assert resp.json()["tag"] == "high-protein"


@pytest.mark.parametrize("tag", ["halal", "Kosher", "JAIN", "hindu-vegetarian", "buddhist-vegetarian"])
async def test_religion_linked_tags_rejected(client: AsyncClient, registered_device: str, tag: str):
    resp = await client.post(
        "/v1/diet-preferences", json={"tag": tag}, headers={"X-Device-Id": registered_device}
    )
    assert resp.status_code == 422


async def test_duplicate_tag_rejected(client: AsyncClient, registered_device: str):
    await client.post("/v1/diet-preferences", json={"tag": "vegetarian"}, headers={"X-Device-Id": registered_device})
    resp = await client.post(
        "/v1/diet-preferences", json={"tag": "vegetarian"}, headers={"X-Device-Id": registered_device}
    )
    assert resp.status_code == 409


async def test_delete_diet_preference(client: AsyncClient, registered_device: str):
    created = (
        await client.post(
            "/v1/diet-preferences", json={"tag": "low-carb"}, headers={"X-Device-Id": registered_device}
        )
    ).json()
    resp = await client.delete(
        f"/v1/diet-preferences/{created['preference_id']}", headers={"X-Device-Id": registered_device}
    )
    assert resp.status_code == 204
