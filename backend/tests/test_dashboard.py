"""GET /v1/dashboard/waste-patterns -- the Patterns tab's backend.

Covers: top-5+Other bucketing for categories and reasons, the
most-wasted-item repeat flag (and its >=2 floor), case-insensitive item-name
dedupe, and that everything is scoped to the calling device only.
"""
import pytest
from httpx import AsyncClient

pytestmark = pytest.mark.asyncio


async def _add_item(client: AsyncClient, device: str, **overrides) -> dict:
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
    resp = await client.post("/v1/pantry", json=body, headers={"X-Device-Id": device})
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _waste(client: AsyncClient, device: str, item: dict, reason: str, quantity: float | None = None):
    resp = await client.post(
        "/v1/logs",
        json={
            "item_id": item["item_id"],
            "status": "wasted",
            "quantity": quantity if quantity is not None else item["quantity"],
            "waste_reason": reason,
        },
        headers={"X-Device-Id": device},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


async def test_empty_history_returns_zeroed_response(client: AsyncClient, registered_device: str):
    resp = await client.get("/v1/dashboard/waste-patterns", headers={"X-Device-Id": registered_device})
    assert resp.status_code == 200
    body = resp.json()
    assert body["total_waste_events"] == 0
    assert body["top_waste_categories"] == []
    assert body["top_waste_reasons"] == []
    assert body["most_wasted_item"] is None


async def test_categories_and_reasons_are_counted_from_wasted_logs_only(
    client: AsyncClient, registered_device: str
):
    dairy = await _add_item(client, registered_device, name="Yoghurt", category="Dairy")
    veg = await _add_item(client, registered_device, name="Carrot", category="Vegetables", quantity=2)

    await _waste(client, registered_device, dairy, "expired")
    # Consumed, not wasted -- must NOT show up in either bucket.
    await client.post(
        "/v1/logs",
        json={"item_id": veg["item_id"], "status": "consumed", "quantity": 1},
        headers={"X-Device-Id": registered_device},
    )

    resp = await client.get("/v1/dashboard/waste-patterns", headers={"X-Device-Id": registered_device})
    body = resp.json()
    assert body["total_waste_events"] == 1
    assert body["top_waste_categories"] == [{"label": "Dairy", "count": 1}]
    assert body["top_waste_reasons"] == [{"label": "expired", "count": 1}]


async def test_more_than_five_categories_roll_into_other(client: AsyncClient, registered_device: str):
    # 6 distinct categories, each wasted a distinguishable number of times so
    # the ordering is deterministic, then check the 6th collapses into "Other".
    categories = ["Dairy", "Fruit", "Vegetables", "Bakery", "Protein", "Snacks"]
    for i, cat in enumerate(categories):
        times = 6 - i  # Dairy=6, Fruit=5, ..., Snacks=1
        for _ in range(times):
            item = await _add_item(client, registered_device, name=f"{cat} item", category=cat)
            await _waste(client, registered_device, item, "spoiled")

    resp = await client.get("/v1/dashboard/waste-patterns", headers={"X-Device-Id": registered_device})
    buckets = resp.json()["top_waste_categories"]
    assert len(buckets) == 6  # top 5 + Other
    assert [b["label"] for b in buckets[:5]] == ["Dairy", "Fruit", "Vegetables", "Bakery", "Protein"]
    assert buckets[5] == {"label": "Other", "count": 1}  # Snacks, the 6th, rolled up


async def test_most_wasted_item_requires_at_least_two_repeats(client: AsyncClient, registered_device: str):
    # A single wasted item anywhere is not a "pattern" -- must not be flagged.
    solo = await _add_item(client, registered_device, name="Bread", category="Bakery")
    await _waste(client, registered_device, solo, "expired")

    resp = await client.get("/v1/dashboard/waste-patterns", headers={"X-Device-Id": registered_device})
    assert resp.json()["most_wasted_item"] is None

    # Now waste "Milk" twice (across two separate item rows, e.g. two cartons
    # bought and wasted on different days) -- it should now be flagged.
    milk1 = await _add_item(client, registered_device, name="Milk", category="Dairy")
    milk2 = await _add_item(client, registered_device, name="Milk", category="Dairy")
    await _waste(client, registered_device, milk1, "expired")
    await _waste(client, registered_device, milk2, "forgot_about_it")

    resp = await client.get("/v1/dashboard/waste-patterns", headers={"X-Device-Id": registered_device})
    top = resp.json()["most_wasted_item"]
    assert top == {"name": "Milk", "times_wasted": 2}


async def test_most_wasted_item_name_matching_is_case_insensitive(client: AsyncClient, registered_device: str):
    lower = await _add_item(client, registered_device, name="milk", category="Dairy")
    upper = await _add_item(client, registered_device, name="Milk", category="Dairy")
    await _waste(client, registered_device, lower, "expired")
    await _waste(client, registered_device, upper, "spoiled")

    resp = await client.get("/v1/dashboard/waste-patterns", headers={"X-Device-Id": registered_device})
    top = resp.json()["most_wasted_item"]
    # "milk" and "Milk" must count as ONE item, not two separate ones -- which
    # casing MIN(fi.name) happens to pick is a Postgres-locale detail this
    # test deliberately doesn't pin down.
    assert top is not None
    assert top["name"].lower() == "milk"
    assert top["times_wasted"] == 2


async def test_other_category_in_top5_does_not_duplicate_rollup_bucket(
    client: AsyncClient, registered_device: str
):
    # A genuine "Other" category (either typed literally, or left blank and
    # COALESCE'd server-side) ranks in the top 5 by count, AND there's a 6th+
    # category to roll up -- naively this used to produce TWO buckets both
    # labelled "Other" in the same response, which crashed the frontend's
    # keyed list rendering. The counts must fold into one bucket instead.
    categories = ["Other", "Fruit", "Vegetables", "Bakery", "Protein", "Snacks"]
    for i, cat in enumerate(categories):
        times = 6 - i  # Other=6, Fruit=5, ..., Snacks=1
        for _ in range(times):
            item = await _add_item(client, registered_device, name=f"{cat} item", category=cat)
            await _waste(client, registered_device, item, "spoiled")

    resp = await client.get("/v1/dashboard/waste-patterns", headers={"X-Device-Id": registered_device})
    buckets = resp.json()["top_waste_categories"]

    labels = [b["label"] for b in buckets]
    assert labels.count("Other") == 1, f"expected exactly one 'Other' bucket, got {buckets}"
    # Other's own 6 + Snacks' 1 (the rolled-up 6th place) = 7.
    other_bucket = next(b for b in buckets if b["label"] == "Other")
    assert other_bucket["count"] == 7


async def test_other_waste_reason_in_top5_does_not_duplicate_rollup_bucket(
    client: AsyncClient, registered_device: str
):
    # Same bug, other side: the waste_reason enum's own lowercase "other"
    # value ranks in the top 5, colliding with the rollup's "Other" bucket
    # once the frontend capitalises it for display.
    reasons = ["other", "expired", "spoiled", "forgot_about_it", "bought_too_much", "changed_plans"]
    for i, reason in enumerate(reasons):
        times = 6 - i
        for _ in range(times):
            item = await _add_item(client, registered_device, name=f"item for {reason}")
            await _waste(client, registered_device, item, reason)

    resp = await client.get("/v1/dashboard/waste-patterns", headers={"X-Device-Id": registered_device})
    buckets = resp.json()["top_waste_reasons"]

    labels = [b["label"] for b in buckets]
    assert labels.count("Other") == 1, f"expected exactly one 'Other' bucket, got {buckets}"
    other_bucket = next(b for b in buckets if b["label"] == "Other")
    assert other_bucket["count"] == 7  # other's own 6 + changed_plans' rolled-up 1


async def test_waste_patterns_isolated_between_devices(client: AsyncClient, registered_device: str):
    item = await _add_item(client, registered_device, name="Milk", category="Dairy")
    await _waste(client, registered_device, item, "expired")

    import uuid

    other_device = str(uuid.uuid4())
    await client.post("/v1/users", json={"user_id": other_device, "household_size": 1})

    resp = await client.get("/v1/dashboard/waste-patterns", headers={"X-Device-Id": other_device})
    body = resp.json()
    assert body["total_waste_events"] == 0
    assert body["most_wasted_item"] is None
