"""Waste Insights Dashboard -- Epic 2: "what I waste, how much, why, and
how it changes over time." `weekly_waste` reads from the `weekly_waste_summary`
VIEW defined in erd-schema.sql (raw SQL here since it's a plain read-only view
with a composite grouping key, not worth mapping as an ORM entity). The rest
compute directly off consumption_waste_log, since each needs a filter (a
rolling window; all-time) the view doesn't expose.
"""
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.deps import get_current_user
from app.models import UserProfile
from app.schemas import (
    DashboardSummary,
    RankedReasonBucket,
    WastePatternItem,
    WastePatternsOut,
    WeightedCategoryBucket,
    WeeklyWasteRow,
)

router = APIRouter(prefix="/v1/dashboard", tags=["dashboard"])


@router.get("/weekly-waste", response_model=list[WeeklyWasteRow])
async def weekly_waste(
    weeks: int = Query(default=12, ge=1, le=104),
    user: UserProfile = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    cutoff = datetime.now(timezone.utc) - timedelta(weeks=weeks)
    result = await db.execute(
        text(
            """
            SELECT week_start, waste_reason, waste_events, total_quantity_wasted
            FROM weekly_waste_summary
            WHERE user_id = :user_id AND week_start >= :cutoff
            ORDER BY week_start DESC
            """
        ),
        {"user_id": str(user.user_id), "cutoff": cutoff},
    )
    return [
        WeeklyWasteRow(
            week_start=row.week_start,
            waste_reason=row.waste_reason,
            waste_events=row.waste_events,
            total_quantity_wasted=float(row.total_quantity_wasted or 0),
        )
        for row in result
    ]


@router.get("/summary", response_model=DashboardSummary)
async def dashboard_summary(
    days: int = Query(default=30, ge=1, le=365),
    user: UserProfile = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)

    totals = (
        await db.execute(
            text(
                """
                SELECT
                    cwl.status,
                    COUNT(*) AS events,
                    SUM(cwl.quantity) AS quantity
                FROM consumption_waste_log cwl
                JOIN food_item fi ON fi.item_id = cwl.item_id
                WHERE fi.user_id = :user_id AND cwl.logged_at >= :cutoff
                GROUP BY cwl.status
                """
            ),
            {"user_id": str(user.user_id), "cutoff": cutoff},
        )
    ).all()

    wasted_events = wasted_qty = consumed_events = consumed_qty = 0.0
    for row in totals:
        if row.status == "wasted":
            wasted_events, wasted_qty = int(row.events), float(row.quantity or 0)
        elif row.status == "consumed":
            consumed_events, consumed_qty = int(row.events), float(row.quantity or 0)

    denom = wasted_qty + consumed_qty
    waste_rate = (wasted_qty / denom) if denom > 0 else None

    reasons = (
        await db.execute(
            text(
                """
                SELECT cwl.waste_reason, COUNT(*) AS cnt, SUM(cwl.quantity) AS qty
                FROM consumption_waste_log cwl
                JOIN food_item fi ON fi.item_id = cwl.item_id
                WHERE fi.user_id = :user_id AND cwl.logged_at >= :cutoff AND cwl.status = 'wasted'
                GROUP BY cwl.waste_reason
                ORDER BY cnt DESC
                """
            ),
            {"user_id": str(user.user_id), "cutoff": cutoff},
        )
    ).all()

    return DashboardSummary(
        range_days=days,
        total_wasted_events=wasted_events,
        total_wasted_quantity=wasted_qty,
        total_consumed_events=consumed_events,
        total_consumed_quantity=consumed_qty,
        waste_rate=waste_rate,
        top_waste_reasons=[
            {"waste_reason": r.waste_reason, "count": int(r.cnt), "quantity": float(r.qty or 0)} for r in reasons
        ],
    )


@router.get("/waste-patterns", response_model=WastePatternsOut)
async def waste_patterns(
    user: UserProfile = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Patterns tab: top 5 wasted categories BY WEIGHT (kg), top 5 waste
    reasons BY COUNT, and the single most repetitively wasted item -- all
    computed over the household's entire logged history (no `days`/`weeks`
    param, unlike /summary and /weekly-waste above), since the point is
    "what's wasted most often so far", not a rolling window.

    Deliberately simpler than a Top-5-plus-Other rollup (see the OLD version
    of _top5_plus_other() that used to live here): that pattern let two rows
    both display as "Other" whenever the real waste_reason value 'other'
    ranked inside the top 5 AND there was overflow left to roll up. Here,
    categories are a plain top-5-by-weight (nothing past #5 shown at all --
    matches the redesigned UI's plain "Top 5 by weight", no catch-all row),
    and 'other' is reported as its own dedicated count rather than a
    synthetic bucket that could ever collide with a real label.
    """
    total_wasted_events = (
        await db.execute(
            text(
                """
                SELECT COUNT(*) AS cnt
                FROM consumption_waste_log cwl
                JOIN food_item fi ON fi.item_id = cwl.item_id
                WHERE fi.user_id = :user_id AND cwl.status = 'wasted'
                """
            ),
            {"user_id": str(user.user_id)},
        )
    ).scalar_one()

    category_rows = (
        await db.execute(
            text(
                """
                SELECT COALESCE(fi.category, 'Other') AS label, SUM(cwl.quantity) AS qty
                FROM consumption_waste_log cwl
                JOIN food_item fi ON fi.item_id = cwl.item_id
                WHERE fi.user_id = :user_id AND cwl.status = 'wasted'
                GROUP BY COALESCE(fi.category, 'Other')
                ORDER BY qty DESC
                LIMIT 5
                """
            ),
            {"user_id": str(user.user_id)},
        )
    ).all()

    # waste_reason is NOT NULL whenever status = 'wasted' (enforced by
    # ConsumptionWasteLogCreate's validator at write time), so no COALESCE
    # needed here the way there is for category above. Not LIMIT-ed in SQL --
    # the 'other' row needs to be pulled out in Python first (see below)
    # before the remaining rows are truncated to 5.
    reason_rows = (
        await db.execute(
            text(
                """
                SELECT cwl.waste_reason AS label, COUNT(*) AS cnt
                FROM consumption_waste_log cwl
                JOIN food_item fi ON fi.item_id = cwl.item_id
                WHERE fi.user_id = :user_id AND cwl.status = 'wasted'
                GROUP BY cwl.waste_reason
                ORDER BY cnt DESC
                """
            ),
            {"user_id": str(user.user_id)},
        )
    ).all()

    other_reason_count = sum(int(r.cnt) for r in reason_rows if r.label == "other")
    ranked_reasons = [
        RankedReasonBucket(label=r.label, count=int(r.cnt)) for r in reason_rows if r.label != "other"
    ][:5]

    # Case-insensitive dedupe ("Milk" and "milk" are the same item) via
    # LOWER(TRIM(...)) as the grouping key. MIN(fi.name) picks a stable
    # display casing (alphabetically first of whatever's been logged) rather
    # than showing the raw grouping key.
    top_item_row = (
        await db.execute(
            text(
                """
                SELECT MIN(fi.name) AS display_name, COUNT(*) AS cnt
                FROM consumption_waste_log cwl
                JOIN food_item fi ON fi.item_id = cwl.item_id
                WHERE fi.user_id = :user_id AND cwl.status = 'wasted'
                GROUP BY LOWER(TRIM(fi.name))
                HAVING COUNT(*) >= 2
                ORDER BY cnt DESC, display_name ASC
                LIMIT 1
                """
            ),
            {"user_id": str(user.user_id)},
        )
    ).first()

    return WastePatternsOut(
        total_waste_events=int(total_wasted_events or 0),
        top_waste_categories=[
            WeightedCategoryBucket(label=r.label, quantity=float(r.qty or 0)) for r in category_rows
        ],
        top_waste_reasons=ranked_reasons,
        other_reason_count=other_reason_count,
        most_wasted_item=(
            WastePatternItem(name=top_item_row.display_name, times_wasted=int(top_item_row.cnt))
            if top_item_row
            else None
        ),
    )

