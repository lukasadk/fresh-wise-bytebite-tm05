"""Waste Insights Dashboard -- Epic 2: "what I waste, how much, why, and
how it changes over time." `weekly_waste` reads from the `weekly_waste_summary`
VIEW defined in erd-schema.sql (raw SQL here since it's a plain read-only view
with a composite grouping key, not worth mapping as an ORM entity). The rest
compute directly off consumption_waste_log, since each needs a filter (a
rolling window; all-time; one specific calendar month) the view doesn't expose.
"""
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.deps import get_current_user
from app.models import UserProfile
from app.schemas import (
    DashboardSummary,
    MonthlyReportMonth,
    MonthlyReportOut,
    WastePatternBucket,
    WastePatternItem,
    WastePatternsOut,
    WeeklyWasteRow,
)

router = APIRouter(prefix="/v1/dashboard", tags=["dashboard"])


def _validate_tz(tz: str) -> str:
    """Rejects anything that isn't a real IANA zone name (e.g. a typo'd
    'Asia/KualaLumpur' instead of 'Asia/Kuala_Lumpur') with a clear 422
    instead of letting Postgres fail the query with an opaque error deeper
    in the stack."""
    try:
        ZoneInfo(tz)
    except (ZoneInfoNotFoundError, ValueError, KeyError):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Unknown timezone '{tz}' -- expected an IANA name like 'Asia/Kuala_Lumpur'.",
        )
    return tz


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


def _top5_plus_other(rows: list[tuple[str, int]]) -> list[WastePatternBucket]:
    """rows must already be ordered by count DESC. Anything past the 5th
    place collapses into one trailing 'Other' bucket, dropped entirely if
    there's nothing left to roll up (e.g. exactly 5 or fewer distinct labels
    -- an empty 'Other: 0' row would be misleading, not just redundant)."""
    top5, rest = rows[:5], rows[5:]
    buckets = [WastePatternBucket(label=label, count=count) for label, count in top5]
    if rest:
        buckets.append(WastePatternBucket(label="Other", count=sum(count for _, count in rest)))
    return buckets


@router.get("/waste-patterns", response_model=WastePatternsOut)
async def waste_patterns(
    user: UserProfile = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Patterns tab: 'frequently wasted categories', 'common waste reasons',
    and the single most repetitively wasted item -- all computed over the
    household's entire logged history (no `days`/`weeks` param, unlike
    /summary and /weekly-waste above), since the point is "what's wasted
    most often so far", not a rolling window.
    """
    category_rows = (
        await db.execute(
            text(
                """
                SELECT COALESCE(fi.category, 'Other') AS label, COUNT(*) AS cnt
                FROM consumption_waste_log cwl
                JOIN food_item fi ON fi.item_id = cwl.item_id
                WHERE fi.user_id = :user_id AND cwl.status = 'wasted'
                GROUP BY COALESCE(fi.category, 'Other')
                ORDER BY cnt DESC
                """
            ),
            {"user_id": str(user.user_id)},
        )
    ).all()

    # waste_reason is NOT NULL whenever status = 'wasted' (enforced by
    # ConsumptionWasteLogCreate's validator at write time), so no COALESCE
    # needed here the way there is for category above.
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

    total_events = sum(int(r.cnt) for r in category_rows)

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
        total_waste_events=total_events,
        top_waste_categories=_top5_plus_other([(r.label, int(r.cnt)) for r in category_rows]),
        top_waste_reasons=_top5_plus_other([(r.label, int(r.cnt)) for r in reason_rows]),
        most_wasted_item=(
            WastePatternItem(name=top_item_row.display_name, times_wasted=int(top_item_row.cnt))
            if top_item_row
            else None
        ),
    )


async def _month_summary(
    db: AsyncSession, user_id, start_local: datetime, end_local: datetime
) -> MonthlyReportMonth:
    """`start_local`/`end_local` are the [inclusive, exclusive) calendar-month
    boundaries in the CALLER's own timezone -- converted to UTC instants here,
    right before querying, since that's the only form Postgres should compare
    logged_at against."""
    start_utc = start_local.astimezone(timezone.utc)
    end_utc = end_local.astimezone(timezone.utc)
    params = {"user_id": str(user_id), "start": start_utc, "end": end_utc}

    totals = (
        await db.execute(
            text(
                """
                SELECT cwl.status, COUNT(*) AS events, SUM(cwl.quantity) AS quantity
                FROM consumption_waste_log cwl
                JOIN food_item fi ON fi.item_id = cwl.item_id
                WHERE fi.user_id = :user_id AND cwl.logged_at >= :start AND cwl.logged_at < :end
                GROUP BY cwl.status
                """
            ),
            params,
        )
    ).all()

    wasted_events = consumed_events = 0
    wasted_qty = consumed_qty = 0.0
    for row in totals:
        if row.status == "wasted":
            wasted_events, wasted_qty = int(row.events), float(row.quantity or 0)
        elif row.status == "consumed":
            consumed_events, consumed_qty = int(row.events), float(row.quantity or 0)

    denom = wasted_qty + consumed_qty
    utilisation_rate = (consumed_qty / denom) if denom > 0 else None

    category_rows = (
        await db.execute(
            text(
                """
                SELECT COALESCE(fi.category, 'Other') AS label, COUNT(*) AS cnt
                FROM consumption_waste_log cwl
                JOIN food_item fi ON fi.item_id = cwl.item_id
                WHERE fi.user_id = :user_id AND cwl.status = 'wasted'
                  AND cwl.logged_at >= :start AND cwl.logged_at < :end
                GROUP BY COALESCE(fi.category, 'Other')
                ORDER BY cnt DESC
                """
            ),
            params,
        )
    ).all()

    reason_rows = (
        await db.execute(
            text(
                """
                SELECT cwl.waste_reason AS label, COUNT(*) AS cnt
                FROM consumption_waste_log cwl
                JOIN food_item fi ON fi.item_id = cwl.item_id
                WHERE fi.user_id = :user_id AND cwl.status = 'wasted'
                  AND cwl.logged_at >= :start AND cwl.logged_at < :end
                GROUP BY cwl.waste_reason
                ORDER BY cnt DESC
                """
            ),
            params,
        )
    ).all()

    return MonthlyReportMonth(
        year=start_local.year,
        month=start_local.month,
        label=start_local.strftime("%B %Y"),
        wasted_events=wasted_events,
        wasted_quantity=wasted_qty,
        consumed_events=consumed_events,
        consumed_quantity=consumed_qty,
        utilisation_rate=utilisation_rate,
        top_waste_categories=_top5_plus_other([(r.label, int(r.cnt)) for r in category_rows]),
        top_waste_reasons=_top5_plus_other([(r.label, int(r.cnt)) for r in reason_rows]),
    )


@router.get("/monthly-report", response_model=MonthlyReportOut)
async def monthly_report(
    tz: str = Query(default="UTC", description="IANA timezone, e.g. 'Asia/Kuala_Lumpur'"),
    months_back: int = Query(
        default=0,
        ge=0,
        le=120,
        description="0 = the household's most recently logged month (default). "
        "1 = the month before that, 2 = two months before, etc. Powers the "
        "Report tab's ‹/› month navigator -- the 'anchor' (what months_back=0 "
        "means) never moves, so paging backward and then forward always lands "
        "back on the same starting point rather than drifting with time.",
    ),
    user: UserProfile = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Report tab: a specific calendar month (identified by months_back,
    counting backward from the household's most recently logged month),
    compared against the month immediately before it.

    "months_back=0" is deliberately NOT always "today's calendar month" --
    it's whichever month contains the household's MOST RECENT log entry. A
    household that last logged something in August and hasn't opened the app
    yet in September should see its August report as "months_back=0" on
    September 1st, not an empty one just because the calendar rolled over.
    Paging further back with months_back=1, 2, ... always counts from that
    same anchor month, not from "today" -- so the anchor doesn't shift under
    the user's feet while they're browsing older months in one sitting. If
    the household has never logged anything at all, there's no data to
    anchor to, so the anchor falls back to today's month (all zeros -- the
    Report tab's empty state is a client-side concern from there).

    Both months' boundaries are computed in the CALLER's own timezone (see
    _validate_tz/_month_summary) rather than the server's, for the same
    reason weekly_waste's view-bypass exists: a log written at 11pm local
    time can already be "tomorrow" in UTC, which would put it in the wrong
    month for a household anywhere east of Greenwich.
    """
    _validate_tz(tz)
    zone = ZoneInfo(tz)

    latest = (
        await db.execute(
            text(
                """
                SELECT MAX(cwl.logged_at) AS latest_logged_at
                FROM consumption_waste_log cwl
                JOIN food_item fi ON fi.item_id = cwl.item_id
                WHERE fi.user_id = :user_id
                """
            ),
            {"user_id": str(user.user_id)},
        )
    ).first()

    anchor_utc = latest.latest_logged_at if latest and latest.latest_logged_at else datetime.now(timezone.utc)
    anchor_local = anchor_utc.astimezone(zone)

    # Shift the anchor's month backward by months_back using integer
    # arithmetic on a 0-indexed "months since year 0" count, rather than
    # looping months_back times with the 32-day jump-then-truncate trick --
    # months_back can be up to 120, and this is exact either way, just
    # clearer at the call site.
    total_months = anchor_local.year * 12 + (anchor_local.month - 1) - months_back
    target_year, target_month0 = divmod(total_months, 12)
    current_start = datetime(target_year, target_month0 + 1, 1, tzinfo=zone)

    # First of the month AFTER current -- a 32-day jump-then-truncate rather
    # than an if/else on month == 12, since it's the same operation either way.
    next_start = (current_start + timedelta(days=32)).replace(day=1)
    # First of the month BEFORE current -- same trick, jumping backward from
    # a day that's always inside the previous month.
    previous_start = (current_start - timedelta(days=1)).replace(day=1)

    current = await _month_summary(db, user.user_id, current_start, next_start)
    previous = await _month_summary(db, user.user_id, previous_start, current_start)
    return MonthlyReportOut(current=current, previous=previous)
