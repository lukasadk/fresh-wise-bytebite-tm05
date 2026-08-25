"""Regression tests for defects found in review on 2026-08-25.

Each test here corresponds to a bug that existed and was fixed. They're kept
separate from the feature tests so it's obvious what they're defending.
"""
import asyncio
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from app.db import engine

# No module-level `pytest.mark.asyncio`: pytest.ini sets asyncio_mode = auto, so
# async tests are detected automatically and the sync matcher tests below stay
# sync (an explicit mark warns when applied to a non-async function).


async def _add_item(client: AsyncClient, device: str, **kw) -> dict:
    body = {
        "name": "Milk", "category": "Dairy", "canonical_food_name": "milk",
        "quantity": 1, "unit": "carton",
        "purchase_date": "2026-08-20", "expiry_date": "2026-08-27",
    }
    body.update(kw)
    r = await client.post("/v1/pantry", json=body, headers={"X-Device-Id": device})
    assert r.status_code == 201, r.text
    return r.json()


# --------------------------------------------------------------------------
# BUG 1: PATCH /v1/pantry/{id} accepted status='wasted'/'consumed', so an item
# could be marked wasted with NO consumption_waste_log row -- the waste would
# then be invisible to the Epic 2 dashboard.
# --------------------------------------------------------------------------


@pytest.mark.parametrize("bad_status", ["wasted", "consumed"])
async def test_patch_cannot_set_terminal_status(client: AsyncClient, registered_device: str, bad_status):
    item = await _add_item(client, registered_device)
    r = await client.patch(
        f"/v1/pantry/{item['item_id']}",
        json={"status": bad_status},
        headers={"X-Device-Id": registered_device},
    )
    assert r.status_code == 422, "terminal statuses must go through POST /v1/logs"

    # and the item is untouched
    r = await client.get(f"/v1/pantry/{item['item_id']}", headers={"X-Device-Id": registered_device})
    assert r.json()["status"] == "active"


async def test_patch_still_allows_non_terminal_status(client: AsyncClient, registered_device: str):
    item = await _add_item(client, registered_device, quantity=5)
    r = await client.patch(
        f"/v1/pantry/{item['item_id']}",
        json={"status": "partially_used"},
        headers={"X-Device-Id": registered_device},
    )
    assert r.status_code == 200
    assert r.json()["status"] == "partially_used"


async def test_every_terminal_item_has_a_log(client: AsyncClient, registered_device: str):
    """The invariant the dashboard depends on: nothing reaches consumed/wasted
    without a corresponding log row."""
    item = await _add_item(client, registered_device)
    await client.post(
        "/v1/logs",
        json={"item_id": item["item_id"], "status": "wasted", "quantity": 1, "waste_reason": "spoiled"},
        headers={"X-Device-Id": registered_device},
    )
    async with engine.begin() as conn:
        orphans = (
            await conn.execute(
                text(
                    """
                    SELECT count(*) FROM food_item fi
                    WHERE fi.status IN ('consumed','wasted')
                      AND NOT EXISTS (SELECT 1 FROM consumption_waste_log l WHERE l.item_id = fi.item_id)
                    """
                )
            )
        ).scalar()
    assert orphans == 0


# --------------------------------------------------------------------------
# BUG 2: record_outcome was a read-modify-write with no row lock, so two
# concurrent logs against one item could each read the old quantity, each pass
# the "enough remaining" check, and both commit -- logging more than the
# household ever had.
#
# NOTE ON WHAT THESE PROVE. An earlier version of this file fired concurrent
# requests through ASGITransport and asserted only one won. That test passed
# with AND without the lock -- in-process ASGI requests serialise well enough
# that the race never opens -- so it proved nothing. It was replaced by two
# tests that do discriminate: one asserts the lock is still in the query the
# router issues, the other proves FOR UPDATE actually serialises competing
# transactions against this table.
# --------------------------------------------------------------------------


async def test_record_outcome_locks_the_row():
    """The router's SELECT must carry FOR UPDATE.

    Structural rather than behavioural, deliberately: it fails the moment
    someone removes `.with_for_update()`, which is the regression that matters.
    """
    import inspect

    from app.routers import logs as logs_router

    src = inspect.getsource(logs_router.record_outcome)
    assert "with_for_update()" in src, (
        "record_outcome does a read-modify-write on food_item.quantity; without "
        "FOR UPDATE two concurrent logs can both over-commit."
    )


async def test_for_update_actually_serialises_competing_writers(client: AsyncClient, registered_device: str):
    """Prove the mechanism the fix relies on, at the database level.

    Two transactions both try to claim the same row. The second must block
    until the first commits, and must then observe the first's decrement --
    which is exactly what stops the double-spend in record_outcome.
    """
    item = await _add_item(client, registered_device, quantity=1)
    item_id = item["item_id"]

    first_holds = asyncio.Event()
    second_saw = {}

    async def txn_one():
        async with engine.connect() as conn:
            await conn.begin()
            qty = (
                await conn.execute(
                    text("SELECT quantity FROM food_item WHERE item_id = :i FOR UPDATE"), {"i": item_id}
                )
            ).scalar()
            first_holds.set()
            await asyncio.sleep(0.3)          # hold the lock while txn_two tries
            await conn.execute(
                text("UPDATE food_item SET quantity = :q WHERE item_id = :i"),
                {"q": float(qty) - 1, "i": item_id},
            )
            await conn.commit()

    async def txn_two():
        await first_holds.wait()
        async with engine.connect() as conn:
            await conn.begin()
            qty = (
                await conn.execute(
                    text("SELECT quantity FROM food_item WHERE item_id = :i FOR UPDATE"), {"i": item_id}
                )
            ).scalar()
            second_saw["qty"] = float(qty)     # must be post-decrement, not the stale 1.0
            await conn.commit()

    await asyncio.gather(txn_one(), txn_two())

    assert second_saw["qty"] == 0.0, (
        f"second transaction read {second_saw['qty']} -- it saw a stale quantity, "
        "so FOR UPDATE is not serialising and the double-spend is possible"
    )


# --------------------------------------------------------------------------
# BUG 3: quantity is NUMERIC(10,2); an amount with more precision left the API
# and the database disagreeing about what remained.
# --------------------------------------------------------------------------


async def test_sub_precision_quantity_is_rejected(client: AsyncClient, registered_device: str):
    item = await _add_item(client, registered_device, quantity=1)
    r = await client.post(
        "/v1/logs",
        json={"item_id": item["item_id"], "status": "consumed", "quantity": 0.001},
        headers={"X-Device-Id": registered_device},
    )
    assert r.status_code == 422, "an amount that rounds to 0 at 2dp must not silently no-op"


async def test_quantity_arithmetic_matches_stored_value(client: AsyncClient, registered_device: str):
    item = await _add_item(client, registered_device, quantity=1)
    r = await client.post(
        "/v1/logs",
        json={"item_id": item["item_id"], "status": "consumed", "quantity": 0.335},
        headers={"X-Device-Id": registered_device},
    )
    assert r.status_code == 201
    api_qty = (
        await client.get(f"/v1/pantry/{item['item_id']}", headers={"X-Device-Id": registered_device})
    ).json()["quantity"]

    async with engine.begin() as conn:
        db_qty = (
            await conn.execute(
                text("SELECT quantity FROM food_item WHERE item_id = :i"), {"i": item["item_id"]}
            )
        ).scalar()
    assert float(db_qty) == pytest.approx(api_qty), "API and DB must agree on what's left"


# --------------------------------------------------------------------------
# BUG 4: recipe candidates were pulled with LIMIT and no ORDER BY, so Postgres
# returned an arbitrary slice -- a recipe using five pantry items could be
# dropped while one using a single item survived, and the same pantry gave
# different answers on different calls.
# --------------------------------------------------------------------------


async def test_candidate_pool_is_ordered():
    """The candidate query must rank before truncating, or LIMIT is a coin flip."""
    import inspect

    from app.routers import recipes as r

    src = inspect.getsource(r.recommend_recipes)
    assert "ORDER BY" in src, "LIMIT without ORDER BY returns an arbitrary slice of matches"
    assert src.index("ORDER BY") < src.index("LIMIT :pool_size"), "ORDER BY must precede LIMIT"


# --------------------------------------------------------------------------
# BUG 5: ingredient matching used raw substring containment, so "butter"
# matched "buttermilk", "buttery crackers" and "butter-flavored spray",
# inflating coverage and surfacing recipes the household cannot make.
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    "pantry,token,expected",
    [
        # real matches -- the word is genuinely present
        ("butter", "unsalted butter", True),
        ("butter", "melted butter", True),
        ("chicken breast", "boneless chicken breast", True),
        ("chicken breast", "chicken breasts", True),   # plural folding
        ("onion", "onions", True),
        ("garlic", "garlic powder", True),
        # different ingredients that merely share a prefix
        ("butter", "buttermilk", False),
        ("butter", "buttery crackers", False),
        ("butter", "buttermilk biscuits", False),
        ("egg", "eggplant", False),
        # imitations are not the real thing
        ("butter", "butter - flavored cooking spray", False),
        ("sugar", "sugar substitute", False),
    ],
)
def test_ingredient_matching_is_word_boundary(pantry, token, expected):
    from app.routers.recipes import _tokens_match

    assert _tokens_match(pantry, token) is expected
