"""Purchase recommendations derived from a household's pantry history.

Epic 8 imports :func:`compute_purchase_recommendations` dynamically.  Keep the
module name, function name, state strings, and output keys stable: they are the
cross-epic contract documented in ``EPIC7_EPIC8_HANDOFF.md``.

The data model does not store a separate purchase event.  A ``FoodItem`` row
is the purchase record, while its current quantity is reduced as consumption
and waste logs are written.  Therefore the original amount bought is rebuilt
as ``remaining + consumed + wasted`` for each row.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.deps import get_current_user
from app.models import ConsumptionWasteLog, FoodItem, UserProfile


PURCHASE_STATES = {"BUY_MORE", "KEEP_SAME", "BUY_LESS", "DO_NOT_BUY_YET"}
PURCHASE_CATEGORIES = {
    "Dairy",
    "Protein",
    "Vegetables",
    "Fruit",
    "Pantry",
    "Frozen",
    "Beverages",
    "Other",
}

router = APIRouter(prefix="/v1/purchase-insights", tags=["purchase insights"])


def _number(value: Any) -> float:
    """Convert Postgres Numeric/NULL values into safe finite app numbers."""

    if value is None:
        return 0.0
    if isinstance(value, Decimal):
        return float(value)
    return float(value)


def _quantity(value: float) -> float | int:
    """Return compact, stable JSON quantities without floating-point noise."""

    rounded = round(max(0.0, value) + 1e-9, 2)
    if rounded.is_integer():
        return int(rounded)
    return rounded


def _normalise_category(category: str | None, name: str) -> str:
    """Map free-text pantry categories onto Epic 8's eight exact labels."""

    raw = f"{category or ''} {name}".casefold()
    if "frozen" in raw:
        return "Frozen"
    if any(word in raw for word in ("fruit", "apple", "banana", "orange", "mango", "berry")):
        return "Fruit"
    if any(
        word in raw
        for word in (
            "vegetable",
            "vegetables",
            "veggie",
            "leafy",
            "spinach",
            "carrot",
            "potato",
            "onion",
            "cabbage",
        )
    ):
        return "Vegetables"
    if any(word in raw for word in ("dairy", "milk", "cheese", "yogurt", "yoghurt", "butter", "cream")):
        return "Dairy"
    if any(
        word in raw
        for word in (
            "protein",
            "meat",
            "poultry",
            "seafood",
            "fish",
            "egg",
            "chicken",
            "beef",
            "lamb",
            "tofu",
            "tempeh",
        )
    ):
        return "Protein"
    if any(word in raw for word in ("beverage", "drink", "juice", "coffee", "tea", "soda", "water")):
        return "Beverages"
    if any(
        word in raw
        for word in (
            "pantry",
            "grain",
            "rice",
            "pasta",
            "noodle",
            "bread",
            "bakery",
            "snack",
            "condiment",
            "sauce",
            "cereal",
            "flour",
        )
    ):
        return "Pantry"
    return "Other"


def _build_recommendations(rows: Iterable[Mapping[str, Any]]) -> list[dict[str, Any]]:
    """Pure recommendation policy, separated from the SQL for unit testing."""

    grouped: dict[str, dict[str, Any]] = {}
    # Epic 9 (AC 9.4.3 -> AC 7.1.4): purchases in the last 8 weeks, so the
    # Item Purchase Insight page can show "Not enough history" below 3.
    history_cutoff = datetime.now(timezone.utc) - timedelta(weeks=8)
    for row in rows:
        display_name = str(row["name"]).strip()
        if not display_name:
            continue
        key = display_name.casefold()
        created_at = row.get("created_at")
        group = grouped.setdefault(
            key,
            {
                "name": display_name,
                "category": row.get("category"),
                "unit": row.get("unit"),
                "latest_at": created_at,
                "purchase_count": 0,
                "purchase_count_8w": 0,
                "original_qty": 0.0,
                "on_hand": 0.0,
                "consumed": 0.0,
                "wasted": 0.0,
                "recent_consumed": 0.0,
                "prior_consumed": 0.0,
            },
        )

        # Prefer the newest spelling/category/unit so the name stays identical
        # to the most recent row the user saw in My Pantry.
        if group["latest_at"] is None or (created_at is not None and created_at > group["latest_at"]):
            group.update(
                name=display_name,
                category=row.get("category"),
                unit=row.get("unit"),
                latest_at=created_at,
            )

        remaining = _number(row.get("quantity"))
        consumed = _number(row.get("consumed_qty"))
        wasted = _number(row.get("wasted_qty"))
        group["purchase_count"] += 1
        if created_at is not None and created_at >= history_cutoff:
            group["purchase_count_8w"] += 1
        group["original_qty"] += remaining + consumed + wasted
        if row.get("status") in {"active", "partially_used"}:
            group["on_hand"] += remaining
        group["consumed"] += consumed
        group["wasted"] += wasted
        group["recent_consumed"] += _number(row.get("recent_consumed_qty"))
        group["prior_consumed"] += _number(row.get("prior_consumed_qty"))

    recommendations: list[dict[str, Any]] = []
    for group in grouped.values():
        purchase_count = max(1, int(group["purchase_count"]))
        average_purchase = group["original_qty"] / purchase_count
        if average_purchase <= 0:
            # A zero-history row cannot produce a useful quantity. It is still
            # a previously purchased item, so keep the safe skip recommendation.
            state = "DO_NOT_BUY_YET"
            recommended_qty: float | int = 0
            reason = "There is not enough purchase history to suggest a quantity yet."
        else:
            on_hand = group["on_hand"]
            outcome_total = group["consumed"] + group["wasted"]
            waste_ratio = group["wasted"] / outcome_total if outcome_total > 0 else 0.0

            # Remaining stock takes precedence over trend/waste signals: the
            # shopping list must never ask the user to buy more while a useful
            # portion of their normal purchase is still available.
            if on_hand >= average_purchase * 0.5:
                state = "DO_NOT_BUY_YET"
                recommended_qty = 0
                reason = f"You still have {_quantity(on_hand)} {group['unit'] or 'units'} available."
            elif waste_ratio >= 0.25 and group["wasted"] > 0:
                state = "BUY_LESS"
                target = average_purchase * 0.75
                recommended_qty = _quantity(max(0.01, target - on_hand))
                reason = (
                    f"About {round(waste_ratio * 100)}% of the recorded amount was wasted, "
                    "so a smaller purchase should be enough."
                )
            elif (
                purchase_count >= 2
                and group["recent_consumed"] > 0
                and group["recent_consumed"] >= max(
                    average_purchase * 0.75,
                    group["prior_consumed"] * 1.2,
                )
            ):
                state = "BUY_MORE"
                target = max(average_purchase * 1.25, group["recent_consumed"])
                recommended_qty = _quantity(max(0.01, target - on_hand))
                reason = "You used more of this item in the last 7 days than in the previous week."
            else:
                state = "KEEP_SAME"
                recommended_qty = _quantity(max(0.01, average_purchase - on_hand))
                reason = "Your recorded use is steady, so your usual purchase amount should be suitable."

        category = _normalise_category(group["category"], group["name"])
        recommendation = {
            "name": group["name"],
            "category": category,
            "unit": group["unit"],
            "state": state,
            "recommended_qty": recommended_qty,
            "reason": reason,
            # Additive (Epic 9): Epic 8's PurchaseRecommendation ignores it.
            "purchase_count_8w": group["purchase_count_8w"],
        }
        # Guard the dynamic Epic 8 boundary even if this policy is edited later.
        assert recommendation["state"] in PURCHASE_STATES
        assert recommendation["category"] in PURCHASE_CATEGORIES
        recommendations.append(recommendation)

    return sorted(recommendations, key=lambda item: item["name"].casefold())


async def compute_purchase_recommendations(db: AsyncSession, user: UserProfile) -> list[dict[str, Any]]:
    """Return one recommendation per item name the user has bought before.

    The query is deliberately a single grouped read because Epic 8 refreshes
    this provider whenever the Shop tab opens.
    """

    now = datetime.now(timezone.utc)
    recent_cutoff = now - timedelta(days=7)
    prior_cutoff = now - timedelta(days=14)

    consumed_qty = func.coalesce(
        func.sum(case((ConsumptionWasteLog.status == "consumed", ConsumptionWasteLog.quantity), else_=0)),
        0,
    ).label("consumed_qty")
    wasted_qty = func.coalesce(
        func.sum(case((ConsumptionWasteLog.status == "wasted", ConsumptionWasteLog.quantity), else_=0)),
        0,
    ).label("wasted_qty")
    recent_consumed_qty = func.coalesce(
        func.sum(
            case(
                (
                    (ConsumptionWasteLog.status == "consumed")
                    & (ConsumptionWasteLog.logged_at >= recent_cutoff),
                    ConsumptionWasteLog.quantity,
                ),
                else_=0,
            )
        ),
        0,
    ).label("recent_consumed_qty")
    prior_consumed_qty = func.coalesce(
        func.sum(
            case(
                (
                    (ConsumptionWasteLog.status == "consumed")
                    & (ConsumptionWasteLog.logged_at >= prior_cutoff)
                    & (ConsumptionWasteLog.logged_at < recent_cutoff),
                    ConsumptionWasteLog.quantity,
                ),
                else_=0,
            )
        ),
        0,
    ).label("prior_consumed_qty")

    columns = (
        FoodItem.item_id,
        FoodItem.name,
        FoodItem.category,
        FoodItem.unit,
        FoodItem.quantity,
        FoodItem.status,
        FoodItem.created_at,
    )
    statement = (
        select(*columns, consumed_qty, wasted_qty, recent_consumed_qty, prior_consumed_qty)
        .outerjoin(ConsumptionWasteLog, ConsumptionWasteLog.item_id == FoodItem.item_id)
        .where(FoodItem.user_id == user.user_id)
        .group_by(*columns)
    )
    result = await db.execute(statement)
    return _build_recommendations(result.mappings().all())


@router.get("")
async def list_purchase_insights(
    db: AsyncSession = Depends(get_db),
    user: UserProfile = Depends(get_current_user),
):
    """Read-only screen endpoint; Epic 8 may call the provider directly."""

    return await compute_purchase_recommendations(db, user)


@router.get("/{item_name}")
async def get_purchase_insight(
    item_name: str,
    db: AsyncSession = Depends(get_db),
    user: UserProfile = Depends(get_current_user),
):
    wanted = item_name.strip().casefold()
    recommendations = await compute_purchase_recommendations(db, user)
    recommendation = next((item for item in recommendations if item["name"].casefold() == wanted), None)
    if recommendation is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No purchase insight exists for this item yet.",
        )
    return recommendation
