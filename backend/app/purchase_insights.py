"""Auditable next-purchase recommendations from real household history.

The policy intentionally uses only ``FoodItem`` purchase rows and their
consumption/waste logs. It never asks an LLM to invent quantities and requires
no locally trained model: the mobile app calls this API rule engine directly.

Epic 8 imports :func:`compute_purchase_recommendations` dynamically. Keep the
module/function names, the four state strings, and the original response keys
stable. The additional fields make the recommendation explainable and match
the purchase-recommendation technical design.
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Iterable, Mapping
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from math import ceil
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.deps import get_current_user
from app.models import ConsumptionWasteLog, FoodItem, UserProfile
from app.schemas import PurchaseRecommendationOut, PurchaseRecommendationRequest


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

# Metrics use the latest eight weeks. A recommendation is now available from
# the first purchase, even before an outcome is logged. Three distinct
# purchase dates plus an outcome still mark the point where the estimate is
# considered reliable enough for over-purchase detection.
INSIGHT_WINDOW_DAYS = 56
RELIABLE_PURCHASE_TRIPS = 3
DEFAULT_PURCHASE_INTERVAL_DAYS = 7.0
OVER_PURCHASE_WASTE_RATE = 0.30

router = APIRouter(prefix="/v1/purchase-insights", tags=["purchase insights"])
shopping_router = APIRouter(prefix="/api/shopping", tags=["purchase insights"])


def _number(value: Any) -> float:
    """Convert Postgres Numeric/NULL values into safe app numbers."""

    if value is None:
        return 0.0
    if isinstance(value, Decimal):
        return float(value)
    return float(value)


def _quantity(value: float) -> float | int:
    """Return compact non-negative quantities without float noise."""

    rounded = round(max(0.0, value) + 1e-9, 2)
    if rounded.is_integer():
        return int(rounded)
    return rounded


def _quantity_with_unit(value: float, unit: str | None) -> str:
    return f"{_quantity(value)} {unit or 'units'}"


def _ratio(value: float) -> float:
    return round(max(0.0, min(1.0, value)), 4)


def _as_date(value: Any) -> date | None:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if isinstance(value, str):
        try:
            return date.fromisoformat(value[:10])
        except ValueError:
            return None
    return None


def _row_date(row: Mapping[str, Any]) -> date | None:
    return _as_date(row.get("purchase_date")) or _as_date(row.get("created_at"))


def _normalise_category(category: str | None, name: str) -> str:
    """Map free-text pantry categories onto Epic 8's exact labels."""

    raw = f"{category or ''} {name}".casefold()
    if "frozen" in raw:
        return "Frozen"
    # Check drinks before fruit so names such as "Orange Juice" are not
    # misclassified as Fruit merely because they contain a fruit name.
    if any(word in raw for word in ("beverage", "drink", "juice", "coffee", "tea", "soda", "water")):
        return "Beverages"
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
            "tomato",
            "zucchini",
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
            "salmon",
            "tilapia",
            "turkey",
            "tofu",
            "tempeh",
        )
    ):
        return "Protein"
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


# Quantities are converted only when the relationship is exact. Packages such
# as cartons, boxes and bags are deliberately separate dimensions: one carton
# cannot safely be assumed to equal one box.
_UNIT_ALIASES = {
    "gram": "g",
    "grams": "g",
    "kilogram": "kg",
    "kilograms": "kg",
    "milliliter": "ml",
    "milliliters": "ml",
    "millilitre": "ml",
    "millilitres": "ml",
    "liter": "l",
    "liters": "l",
    "litre": "l",
    "litres": "l",
    "pc": "piece",
    "pcs": "piece",
    "pieces": "piece",
    "units": "piece",
}
_UNIT_SCALE = {
    "g": ("mass", 1.0),
    "kg": ("mass", 1000.0),
    "ml": ("volume", 1.0),
    "l": ("volume", 1000.0),
}

def _unit_definition(unit: str | None) -> tuple[str, str, float]:
    raw = str(unit or "unknown").strip().casefold() or "unknown"
    canonical = _UNIT_ALIASES.get(raw, raw)
    if canonical in _UNIT_SCALE:
        dimension, scale = _UNIT_SCALE[canonical]
        return canonical, dimension, scale
    return canonical, f"count:{canonical}", 1.0


def _convert_quantity(value: Any, from_unit: str | None, to_unit: str | None) -> float | None:
    _, from_dimension, from_scale = _unit_definition(from_unit)
    _, to_dimension, to_scale = _unit_definition(to_unit)
    if from_dimension != to_dimension:
        return None
    return _number(value) * from_scale / to_scale


def _normalise_name(value: Any) -> str:
    """Ignore case and repeated/leading/trailing whitespace (AC 7.1.1)."""

    return " ".join(str(value or "").split()).casefold()


def _group_key(row: Mapping[str, Any]) -> str:
    return _normalise_name(row.get("name"))


def _latest_row(rows: list[Mapping[str, Any]]) -> Mapping[str, Any]:
    def sort_key(row: Mapping[str, Any]) -> tuple[date, datetime]:
        purchased = _row_date(row) or date.min
        created = row.get("created_at")
        if not isinstance(created, datetime):
            created = datetime.min.replace(tzinfo=timezone.utc)
        elif created.tzinfo is None:
            created = created.replace(tzinfo=timezone.utc)
        return purchased, created

    return max(rows, key=sort_key)


def _preferred_display_unit(rows: list[Mapping[str, Any]]) -> Any:
    """Choose the unit family represented by the most records.

    Exact aliases (for example ``litre``/``l``) are grouped, and compatible
    units (for example ``ml``/``l``) vote for the same dimension. Ties use the
    newest matching record, preserving the old behaviour only when there is no
    clear majority. The returned spelling comes from the newest record in the
    winning canonical unit so existing API display conventions remain stable.
    """

    if not rows:
        return None

    unit_rows = [
        (
            row,
            *_unit_definition(row.get("unit"))[:2],
        )
        for row in rows
    ]
    dimension_counts = Counter(dimension for _, _, dimension in unit_rows)
    max_dimension_count = max(dimension_counts.values())
    candidate_dimensions = {
        dimension
        for dimension, count in dimension_counts.items()
        if count == max_dimension_count
    }
    newest_dimension_row = _latest_row(
        [row for row, _, dimension in unit_rows if dimension in candidate_dimensions]
    )
    preferred_dimension = _unit_definition(newest_dimension_row.get("unit"))[1]

    compatible_rows = [
        (row, canonical)
        for row, canonical, dimension in unit_rows
        if dimension == preferred_dimension
    ]
    canonical_counts = Counter(canonical for _, canonical in compatible_rows)
    max_canonical_count = max(canonical_counts.values())
    candidate_canonicals = {
        canonical
        for canonical, count in canonical_counts.items()
        if count == max_canonical_count
    }
    newest_unit_row = _latest_row(
        [row for row, canonical in compatible_rows if canonical in candidate_canonicals]
    )
    return newest_unit_row.get("unit")


def _purchase_interval_days(cycle_dates: list[date]) -> float | None:
    unique_dates = sorted(set(cycle_dates))
    if len(unique_dates) < 2:
        return None
    intervals = [(current - previous).days for previous, current in zip(unique_dates, unique_dates[1:])]
    return round(sum(intervals) / len(intervals), 1)


def _recommendation_summary(
    *,
    name: str,
    state: str,
    recommended: float,
    usual_purchase: float,
    current_inventory: float,
    unit: str | None,
    purchase_count: int,
    has_outcomes: bool,
    over_purchase: bool,
    waste_rate: float | None,
) -> str:
    """Build a short, factual summary from the same auditable rule inputs."""

    amount = _quantity_with_unit(recommended, unit)
    if state == "DO_NOT_BUY_YET":
        decision = f"No new {name} purchase is recommended yet."
    elif state == "BUY_LESS":
        decision = f"Plan to buy {amount} of {name}, less than your usual amount."
    elif state == "BUY_MORE":
        decision = f"Plan to buy {amount} of {name}, more than your usual amount."
    else:
        decision = f"Keep your next {name} purchase close to {amount}."

    trip_word = "trip" if purchase_count == 1 else "trips"
    evidence = (
        f"This uses {purchase_count} purchase {trip_word} from the last 8 weeks; "
        f"you usually buy {_quantity_with_unit(usual_purchase, unit)} and currently have "
        f"{_quantity_with_unit(current_inventory, unit)}."
    )

    if purchase_count < RELIABLE_PURCHASE_TRIPS:
        trips_needed = RELIABLE_PURCHASE_TRIPS - purchase_count
        needed_word = "trip" if trips_needed == 1 else "trips"
        confidence = (
            f"Record {trips_needed} more purchase {needed_word} before treating the waste-rate "
            "assessment as reliable."
        )
    elif not has_outcomes:
        confidence = "Log consumption or waste outcomes before a waste-rate assessment is shown."
    elif over_purchase and waste_rate is not None:
        confidence = (
            f"Recorded outcomes show a {round(_ratio(waste_rate) * 100)}% waste rate, so this item "
            "needs attention."
        )
    else:
        confidence = "Recorded consumption and waste outcomes indicate this item is on track."

    return " ".join((decision, evidence, confidence))


def _build_recommendations(
    rows: Iterable[Mapping[str, Any]],
    *,
    today: date | None = None,
) -> list[dict[str, Any]]:
    """Apply the 15 LeanKit Epic 7 acceptance criteria without an ML model."""

    today = today or datetime.now(timezone.utc).date()
    history_cutoff = today - timedelta(days=INSIGHT_WINDOW_DAYS)
    raw_groups: dict[str, list[Mapping[str, Any]]] = {}
    for row in rows:
        display_name = " ".join(str(row.get("name") or "").split())
        if display_name:
            raw_groups.setdefault(_group_key(row), []).append(row)

    recommendations: list[dict[str, Any]] = []
    for key, source_rows in raw_groups.items():
        latest = _latest_row(source_rows)
        display_name = " ".join(str(latest["name"]).split())
        recent_rows = [
            row
            for row in source_rows
            if (row_date := _row_date(row)) is not None and row_date >= history_cutoff
        ]
        display_unit = _preferred_display_unit(recent_rows or source_rows)
        category = _normalise_category(latest.get("category"), display_name)
        aliases = {key, *(_normalise_name(row.get("name")) for row in source_rows)}

        cycles: dict[date, dict[str, float]] = {}
        current_inventory = 0.0
        incompatible_count = 0

        for row in source_rows:
            remaining = _convert_quantity(row.get("quantity"), row.get("unit"), display_unit)
            consumed = _convert_quantity(row.get("consumed_qty"), row.get("unit"), display_unit)
            wasted = _convert_quantity(row.get("wasted_qty"), row.get("unit"), display_unit)
            if None in (remaining, consumed, wasted):
                incompatible_count += 1
                continue

            expiry_date = _as_date(row.get("expiry_date"))
            if (
                row.get("status") in {"active", "partially_used"}
                and (expiry_date is None or expiry_date >= today)
            ):
                current_inventory += remaining

            cycle_date = _row_date(row)
            if cycle_date is None or cycle_date < history_cutoff:
                continue
            cycle = cycles.setdefault(
                cycle_date,
                {"original": 0.0, "remaining": 0.0, "consumed": 0.0, "wasted": 0.0},
            )
            cycle["remaining"] += remaining
            cycle["consumed"] += consumed
            cycle["wasted"] += wasted
            cycle["original"] += remaining + consumed + wasted

        # Buying Habits is an eight-week view. Old stock still contributes to
        # current inventory above, but a name with no purchase in the window is
        # not presented as a recent buying habit.
        if not cycles:
            continue

        ordered_cycles = sorted(cycles.items(), key=lambda pair: pair[0])
        purchase_dates = [cycle_date for cycle_date, _ in ordered_cycles]
        purchase_count = len(purchase_dates)
        total_purchased = sum(cycle["original"] for _, cycle in ordered_cycles)
        total_consumed = sum(cycle["consumed"] for _, cycle in ordered_cycles)
        total_wasted = sum(cycle["wasted"] for _, cycle in ordered_cycles)
        outcome_total = total_consumed + total_wasted
        has_outcomes = outcome_total > 0

        usual_purchase = total_purchased / purchase_count
        average_consumption = total_consumed / purchase_count
        average_wasted = total_wasted / purchase_count
        waste_rate = total_wasted / outcome_total if has_outcomes else None
        purchase_waste_rate = total_wasted / total_purchased if total_purchased > 0 else None
        average_weekly_consumption = total_consumed / (INSIGHT_WINDOW_DAYS / 7)

        average_interval = _purchase_interval_days(purchase_dates)
        days_until_next_shop = average_interval or DEFAULT_PURCHASE_INTERVAL_DAYS
        has_reliable_history = purchase_count >= RELIABLE_PURCHASE_TRIPS and has_outcomes
        recommendation_available = purchase_count >= 1

        # Cold-start estimates must remain useful without pretending that an
        # unobserved outcome is consumption. Before reliable history exists,
        # use recorded consumption when available; otherwise use the user's
        # own usual purchase quantity as the conservative baseline.
        if has_reliable_history:
            predicted_demand = average_weekly_consumption * days_until_next_shop / 7
        elif has_outcomes:
            predicted_demand = average_consumption
        else:
            predicted_demand = usual_purchase
        recommended = ceil(max(0.0, predicted_demand - current_inventory))

        over_purchase = (
            purchase_count >= RELIABLE_PURCHASE_TRIPS
            and waste_rate is not None
            and waste_rate >= OVER_PURCHASE_WASTE_RATE
        )
        if not has_reliable_history:
            habit_status = "still_learning"
            status_label = "Not enough history"
        elif over_purchase:
            habit_status = "possible_over_purchase"
            status_label = "Possible Over-Purchase"
        else:
            habit_status = "on_track"
            status_label = "On Track"

        if recommended == 0:
            state = "DO_NOT_BUY_YET"
        elif recommended < usual_purchase * 0.80:
            state = "BUY_LESS"
        elif recommended > usual_purchase * 1.20:
            state = "BUY_MORE"
        else:
            state = "KEEP_SAME"

        if not has_reliable_history:
            if recommended == 0:
                reason = (
                    f"Early estimate: you still have "
                    f"{_quantity_with_unit(current_inventory, display_unit)} at home, so no new "
                    "purchase is suggested yet. More history will improve this estimate."
                )
            elif has_outcomes:
                reason = (
                    f"Early estimate from {purchase_count} recent purchase"
                    f"{'s' if purchase_count != 1 else ''} and recorded outcomes. Try "
                    f"{_quantity_with_unit(recommended, display_unit)}; more history will improve it."
                )
            else:
                reason = (
                    f"Early estimate based on your usual purchase of "
                    f"{_quantity_with_unit(usual_purchase, display_unit)}. Log consumption or waste "
                    "to improve it."
                )
        elif recommended == 0:
            reason = (
                f"You still have {_quantity_with_unit(current_inventory, display_unit)} at home — "
                "enough until your next shop."
            )
        elif recommended < usual_purchase * 0.80:
            reason = (
                f"You usually buy {_quantity_with_unit(usual_purchase, display_unit)}, use about "
                f"{_quantity_with_unit(average_consumption, display_unit)} and waste about "
                f"{_quantity_with_unit(average_wasted, display_unit)}. "
                f"Try {_quantity_with_unit(recommended, display_unit)}."
            )
        elif recommended > usual_purchase * 1.20:
            reason = (
                f"You usually use all {_quantity_with_unit(usual_purchase, display_unit)} and run out "
                "before your next shop."
            )
        else:
            reason = "Your usual amount matches what you use."

        summary = _recommendation_summary(
            name=display_name,
            state=state,
            recommended=recommended,
            usual_purchase=usual_purchase,
            current_inventory=current_inventory,
            unit=display_unit,
            purchase_count=purchase_count,
            has_outcomes=has_outcomes,
            over_purchase=over_purchase,
            waste_rate=waste_rate,
        )

        if not has_outcomes:
            waste_risk = "unknown"
            data_quality = "no_outcomes"
        elif over_purchase:
            waste_risk = "high"
            data_quality = "sufficient"
        elif waste_rate is not None and waste_rate >= 0.20:
            waste_risk = "medium"
            data_quality = "sufficient" if has_reliable_history else "limited"
        else:
            waste_risk = "low"
            data_quality = "sufficient" if has_reliable_history else "limited"

        warnings: list[str] = []
        if purchase_count < RELIABLE_PURCHASE_TRIPS:
            warnings.append(
                "Early estimate only: log 3 different purchase dates for a more reliable recommendation."
            )
        if not has_outcomes:
            warnings.append(
                "Early estimate uses purchase quantity because no consumption or waste outcome has "
                "been recorded in the last 8 weeks."
            )
        if incompatible_count:
            warnings.append(
                f"Excluded {incompatible_count} historical record(s) with units incompatible with "
                f"{display_unit or 'unknown'}."
            )

        completed_cycles = sum(1 for _, cycle in ordered_cycles if cycle["remaining"] <= 1e-9)
        latest_purchase = max(purchase_dates)
        recommendation = {
            "name": display_name,
            "food_name": display_name,
            "category": category,
            "unit": display_unit,
            "state": state,
            "recommendation": state,
            "recommended_qty": _quantity(recommended),
            "reason": reason,
            "summary": summary,
            # Additive Epic 9 audit field. A recommendation remains available
            # below three purchases, while AC 7.1.4 hides the waste-rate metric.
            "purchase_count_8w": purchase_count,
            "usual_purchase": _quantity(usual_purchase),
            "predicted_demand": _quantity(predicted_demand),
            "current_inventory": _quantity(current_inventory),
            "average_consumption": _quantity(average_consumption),
            "average_wasted": _quantity(average_wasted),
            "average_weekly_consumption": _quantity(average_weekly_consumption),
            "average_waste_rate": (
                _ratio(waste_rate) if has_reliable_history and waste_rate is not None else None
            ),
            "purchase_waste_rate": (
                _ratio(purchase_waste_rate)
                if has_reliable_history and purchase_waste_rate is not None
                else None
            ),
            "waste_risk": waste_risk,
            "over_purchase_detected": over_purchase,
            "habit_status": habit_status,
            "status_label": status_label,
            "recommendation_available": recommendation_available,
            "has_outcomes": has_outcomes,
            "purchase_count": purchase_count,
            "completed_cycles": completed_cycles,
            "average_purchase_interval_days": average_interval,
            "days_until_next_shop": _quantity(days_until_next_shop),
            "days_since_last_purchase": max(0, (today - latest_purchase).days),
            "is_cold_start": not has_reliable_history,
            "evidence_window_days": INSIGHT_WINDOW_DAYS,
            "method": "rule_baseline_v2_early_estimate",
            "data_quality": data_quality,
            "warnings": warnings,
            "_aliases": aliases,
        }
        assert recommendation["state"] in PURCHASE_STATES
        assert recommendation["category"] in PURCHASE_CATEGORIES
        recommendations.append(recommendation)

    return sorted(recommendations, key=lambda item: item["name"].casefold())


async def compute_purchase_recommendations(
    db: AsyncSession,
    user: UserProfile,
) -> list[dict[str, Any]]:
    """Return one eight-week recommendation per normalized display name."""

    now = datetime.now(timezone.utc)
    history_cutoff = now - timedelta(days=INSIGHT_WINDOW_DAYS)

    consumed_qty = func.coalesce(
        func.sum(
            case(
                (
                    (ConsumptionWasteLog.status == "consumed")
                    & (ConsumptionWasteLog.logged_at >= history_cutoff),
                    ConsumptionWasteLog.quantity,
                ),
                else_=0,
            )
        ),
        0,
    ).label("consumed_qty")
    wasted_qty = func.coalesce(
        func.sum(
            case(
                (
                    (ConsumptionWasteLog.status == "wasted")
                    & (ConsumptionWasteLog.logged_at >= history_cutoff),
                    ConsumptionWasteLog.quantity,
                ),
                else_=0,
            )
        ),
        0,
    ).label("wasted_qty")

    columns = (
        FoodItem.item_id,
        FoodItem.name,
        FoodItem.canonical_food_name,
        FoodItem.category,
        FoodItem.unit,
        FoodItem.quantity,
        FoodItem.status,
        FoodItem.purchase_date,
        FoodItem.expiry_date,
        FoodItem.created_at,
    )
    statement = (
        select(*columns, consumed_qty, wasted_qty)
        .outerjoin(ConsumptionWasteLog, ConsumptionWasteLog.item_id == FoodItem.item_id)
        .where(FoodItem.user_id == user.user_id)
        .group_by(*columns)
    )
    result = await db.execute(statement)
    return _build_recommendations(result.mappings().all())


def _find_recommendation(
    recommendations: list[dict[str, Any]],
    food_name: str,
) -> dict[str, Any] | None:
    wanted = _normalise_name(food_name)
    return next(
        (
            item
            for item in recommendations
            if wanted == _normalise_name(item["name"]) or wanted in item.get("_aliases", set())
        ),
        None,
    )


async def _recommend_one(
    food_name: str,
    db: AsyncSession,
    user: UserProfile,
) -> dict[str, Any]:
    recommendation = _find_recommendation(
        await compute_purchase_recommendations(db, user),
        food_name,
    )
    if recommendation is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No purchase insight exists for this item yet.",
        )
    return recommendation


@router.get("", response_model=list[PurchaseRecommendationOut])
async def list_purchase_insights(
    db: AsyncSession = Depends(get_db),
    user: UserProfile = Depends(get_current_user),
):
    """List the household's next-purchase recommendations."""

    return await compute_purchase_recommendations(db, user)


@router.post("/recommend", response_model=PurchaseRecommendationOut)
async def recommend_purchase(
    body: PurchaseRecommendationRequest,
    db: AsyncSession = Depends(get_db),
    user: UserProfile = Depends(get_current_user),
):
    return await _recommend_one(body.food_name, db, user)


@shopping_router.post("/recommend", response_model=PurchaseRecommendationOut)
async def recommend_purchase_documented_alias(
    body: PurchaseRecommendationRequest,
    db: AsyncSession = Depends(get_db),
    user: UserProfile = Depends(get_current_user),
):
    """Compatibility alias for the technical document's suggested API path."""

    return await _recommend_one(body.food_name, db, user)


@router.get("/{item_name}", response_model=PurchaseRecommendationOut)
async def get_purchase_insight(
    item_name: str,
    db: AsyncSession = Depends(get_db),
    user: UserProfile = Depends(get_current_user),
):
    return await _recommend_one(item_name, db, user)
