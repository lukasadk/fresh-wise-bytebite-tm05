"""Waste Insights Dashboard -- Epic 2: "what I waste, how much, why, and
how it changes over time." Reads from the `weekly_waste_summary` VIEW
defined in erd-schema.sql (raw SQL here since it's a plain read-only view
with a composite grouping key, not worth mapping as an ORM entity) plus
a rolled-up summary computed directly off consumption_waste_log.
"""
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.deps import get_current_user
from app.models import UserProfile
from app.schemas import DashboardSummary, WeeklyWasteRow

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
