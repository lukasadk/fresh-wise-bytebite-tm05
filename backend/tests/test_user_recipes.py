"""Homemade recipes ("My recipes") -- /v1/my-recipes."""
import uuid

from httpx import AsyncClient

MILO_CAKE = {
    "title": "  Mum's Milo cake ",
    "servings": 6,
    "prep_minutes": 15,
    "cook_minutes": 40,
    "ingredients": [
        {"name": "Eggs", "amount": "3"},
        {"name": " Milk ", "amount": " 250 ml "},
        {"name": "Milo", "amount": ""},
    ],
    "steps": ["Mix everything", "  ", "Bake at 180C"],
    "notes": "Best the next day",
}


def _h(device_id: str) -> dict:
    return {"X-Device-Id": device_id}


async def _create(client: AsyncClient, device_id: str, body: dict | None = None) -> dict:
    resp = await client.post("/v1/my-recipes", json=body or MILO_CAKE, headers=_h(device_id))
    assert resp.status_code == 201, resp.text
    return resp.json()


async def test_create_and_list(client: AsyncClient, registered_device: str):
    created = await _create(client, registered_device)
    # Text is trimmed, blank steps dropped, empty amount stored as null.
    assert created["title"] == "Mum's Milo cake"
    assert created["ingredients"] == [
        {"name": "Eggs", "amount": "3"},
        {"name": "Milk", "amount": "250 ml"},
        {"name": "Milo", "amount": None},
    ]
    assert created["steps"] == ["Mix everything", "Bake at 180C"]
    assert created["servings"] == 6

    resp = await client.get("/v1/my-recipes", headers=_h(registered_device))
    assert resp.status_code == 200
    assert [r["recipe_id"] for r in resp.json()] == [created["recipe_id"]]

    resp = await client.get(f"/v1/my-recipes/{created['recipe_id']}", headers=_h(registered_device))
    assert resp.status_code == 200
    assert resp.json()["notes"] == "Best the next day"


async def test_validation(client: AsyncClient, registered_device: str):
    for bad in (
        {**MILO_CAKE, "title": "   "},
        {**MILO_CAKE, "ingredients": []},
        {**MILO_CAKE, "ingredients": [{"name": " "}]},
        {**MILO_CAKE, "servings": 0},
        {**MILO_CAKE, "cook_minutes": 5000},
    ):
        resp = await client.post("/v1/my-recipes", json=bad, headers=_h(registered_device))
        assert resp.status_code == 422, bad


async def test_update_only_changes_sent_fields(client: AsyncClient, registered_device: str):
    created = await _create(client, registered_device)
    resp = await client.patch(
        f"/v1/my-recipes/{created['recipe_id']}",
        json={"title": "Milo cake v2", "steps": ["Mix", "Bake"]},
        headers=_h(registered_device),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["title"] == "Milo cake v2"
    assert body["steps"] == ["Mix", "Bake"]
    assert body["ingredients"] == created["ingredients"]
    assert body["servings"] == 6

    resp = await client.patch(
        f"/v1/my-recipes/{created['recipe_id']}", json={"title": None}, headers=_h(registered_device)
    )
    assert resp.status_code == 422


async def test_delete(client: AsyncClient, registered_device: str):
    created = await _create(client, registered_device)
    resp = await client.delete(f"/v1/my-recipes/{created['recipe_id']}", headers=_h(registered_device))
    assert resp.status_code == 204
    resp = await client.get(f"/v1/my-recipes/{created['recipe_id']}", headers=_h(registered_device))
    assert resp.status_code == 404


async def test_other_households_cannot_see_or_change(client: AsyncClient, registered_device: str):
    created = await _create(client, registered_device)
    other = str(uuid.uuid4())
    resp = await client.post("/v1/users", json={"user_id": other, "household_size": 1})
    assert resp.status_code == 200

    resp = await client.get("/v1/my-recipes", headers=_h(other))
    assert resp.json() == []
    rid = created["recipe_id"]
    assert (await client.get(f"/v1/my-recipes/{rid}", headers=_h(other))).status_code == 404
    assert (await client.patch(f"/v1/my-recipes/{rid}", json={"title": "x"}, headers=_h(other))).status_code == 404
    assert (await client.delete(f"/v1/my-recipes/{rid}", headers=_h(other))).status_code == 404
    # Still there for the owner.
    assert (await client.get(f"/v1/my-recipes/{rid}", headers=_h(registered_device))).status_code == 200


async def test_deleting_profile_deletes_recipes(client: AsyncClient, registered_device: str):
    await _create(client, registered_device)
    resp = await client.delete("/v1/users/me", headers=_h(registered_device))
    assert resp.status_code == 204
    resp = await client.post("/v1/users", json={"user_id": registered_device, "household_size": 1})
    assert resp.status_code == 200
    resp = await client.get("/v1/my-recipes", headers=_h(registered_device))
    assert resp.json() == []