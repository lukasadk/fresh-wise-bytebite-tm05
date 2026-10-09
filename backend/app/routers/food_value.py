"""Epic 9 -- Estimated Food Value Insights.

GET /v1/food-value/meta     price-data label + snapshot month (AC 9.1.4)
GET /v1/food-value/wasted   value wasted in a month, by category, top 3 (AC 9.3.x, 9.4.x)

Value at Risk (US 9.2) has no endpoint of its own: the Use First page already
holds every active item, and each FoodItemOut now carries est_unit_value_rm, so
the banner total is computed on the device and drops the moment an item is
consumed (AC 9.2.4) without another round trip.

All figures come from app/food_value.py -- see its docstring for the matching
and unit rules.
"""
from __future__ import annotations

import re
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.deps import get_current_user
from app.food_value import WastedRow, get_snapshot, money, summarise_wasted
from app.models import ConsumptionWasteLog, FoodItem, UserProfile
from app.schemas import FoodValueMetaOut, FoodValueWastedOut

router = APIRouter(prefix="/v1/food-value", tags=["food value"])

DEFAULT_TZ = "Asia/Kuala_Lumpur"
PRICECATCHER_URL = "https://data.gov.my/data-catalogue/pricecatcher"


def _tz(name: str | None):
    try:
        return ZoneInfo(name or DEFAULT_TZ)
    except Exception:
        # Slim images can lack tzdata; Malaysia is a fixed UTC+8 all year.
        return timezone(timedelta(hours=8))


def _month_start(year: int, month: int) -> date:
    return date(year, month, 1)


def _shift_month(d: date, delta: int) -> date:
    index = d.year * 12 + (d.month - 1) + delta
    return date(index // 12, index % 12 + 1, 1)


def _bounds(first: date, tz) -> tuple[datetime, datetime]:
    nxt = _shift_month(first, 1)
    start = datetime(first.year, first.month, 1, tzinfo=tz).astimezone(timezone.utc)
    end = datetime(nxt.year, nxt.month, 1, tzinfo=tz).astimezone(timezone.utc)
    return start, end


def _about(value: float) -> str:
    """'About RM 18' -- whole ringgit; these are estimates, not receipts."""
    whole = round(value)
    return "less than RM 1" if 0 < value < 0.5 else f"RM {whole:,}"


def _headline(total: float | None, change: float | None, sufficient: bool) -> str | None:
    if not sufficient or total is None:
        return None
    text = f"About {_about(total)} of food wasted this month"
    if change is None:
        return text
    if round(change) == 0:
        return f"{text}, about the same as last month"
    direction = "less" if change < 0 else "more"
    return f"{text}, about {_about(abs(change))} {direction} than last month"


async def _wasted_rows(db: AsyncSession, user: UserProfile, start: datetime, end: datetime) -> list[WastedRow]:
    result = await db.execute(
        select(
            ConsumptionWasteLog.quantity,
            FoodItem.name,
            FoodItem.category,
            FoodItem.unit,
            FoodItem.est_unit_value_rm,
        )
        .join(FoodItem, FoodItem.item_id == ConsumptionWasteLog.item_id)
        .where(
            FoodItem.user_id == user.user_id,
            ConsumptionWasteLog.status == "wasted",
            ConsumptionWasteLog.logged_at >= start,
            ConsumptionWasteLog.logged_at < end,
        )
    )
    return [
        WastedRow(
            name=name,
            category=category,
            unit=unit,
            quantity=Decimal(str(qty)),
            unit_value_rm=None if uv is None else Decimal(str(uv)),
        )
        for qty, name, category, unit, uv in result.all()
    ]


async def _has_any_log(db: AsyncSession, user: UserProfile, start: datetime, end: datetime) -> bool:
    count = await db.scalar(
        select(func.count(ConsumptionWasteLog.log_id))
        .join(FoodItem, FoodItem.item_id == ConsumptionWasteLog.item_id)
        .where(
            FoodItem.user_id == user.user_id,
            ConsumptionWasteLog.logged_at >= start,
            ConsumptionWasteLog.logged_at < end,
        )
    )
    return bool(count)


@router.get("/meta", response_model=FoodValueMetaOut)
async def food_value_meta():
    snap = get_snapshot()
    return FoodValueMetaOut(
        snapshot_month=snap.month,
        label=snap.label,
        item_count=len(snap.items),
        source="PriceCatcher -- Ministry of Domestic Trade and Cost of Living & Department of Statistics Malaysia",
        source_url=PRICECATCHER_URL,
        license="CC BY 4.0",
    )


@router.get("/wasted", response_model=FoodValueWastedOut)
async def food_value_wasted(
    month: str | None = Query(default=None, description="YYYY-MM; defaults to the current month"),
    tz: str | None = Query(default=None, description=f"IANA time zone for month boundaries, default {DEFAULT_TZ}"),
    user: UserProfile = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    zone = _tz(tz)
    today = datetime.now(zone).date()
    current = _month_start(today.year, today.month)
    if month:
        m = re.fullmatch(r"(\d{4})-(\d{2})", month.strip())
        if not m or not 1 <= int(m.group(2)) <= 12:
            raise HTTPException(status_code=422, detail="month must look like 2026-10")
        first = _month_start(int(m.group(1)), int(m.group(2)))
    else:
        first = current
    if first > current:
        raise HTTPException(status_code=422, detail="month cannot be in the future")

    previous = _shift_month(first, -1)
    this_summary = summarise_wasted(await _wasted_rows(db, user, *_bounds(first, zone)))
    prev_bounds = _bounds(previous, zone)
    prev_summary = summarise_wasted(await _wasted_rows(db, user, *prev_bounds))

    total = this_summary["total_rm"] if this_summary["sufficient"] else None
    prev_total = prev_summary["total_rm"]
    change = None
    if total is not None and await _has_any_log(db, user, *prev_bounds):
        change = money(Decimal(str(total)) - Decimal(str(prev_total or 0)))

    return FoodValueWastedOut(
        month=f"{first.year:04d}-{first.month:02d}",
        is_current_month=first == current,
        label=get_snapshot().label,
        wasted_count=this_summary["wasted_count"],
        valued_count=this_summary["valued_count"],
        unvalued_count=this_summary["unvalued_count"],
        coverage=this_summary["coverage"],
        sufficient=this_summary["sufficient"],
        total_rm=total,
        previous_month=f"{previous.year:04d}-{previous.month:02d}",
        previous_total_rm=prev_total,
        change_rm=change,
        headline=_headline(total, change, this_summary["sufficient"]),
        by_category=this_summary["by_category"] if this_summary["sufficient"] else [],
        top_items=this_summary["top_items"],
        all_items=this_summary["all_items"],
        unpriced_items=this_summary["unpriced_items"],
    )


async def backfill_food_values(db: AsyncSession) -> int:
    """Estimate every item not yet estimated against the current snapshot.

    Covers items saved before Epic 9 existed, and re-values everything if the
    snapshot is ever rebuilt for a newer month. Items that were tried and had
    no match carry est_price_month too, so they aren't re-tried every boot.
    Returns how many rows were (re)estimated.
    """
    from app.food_value import apply_estimate

    snap = get_snapshot()
    result = await db.execute(
        select(FoodItem).where(
            (FoodItem.est_price_month.is_(None)) | (FoodItem.est_price_month != snap.month)
        )
    )
    items = list(result.scalars().all())
    for item in items:
        apply_estimate(item, snap)
    if items:
        await db.commit()
    return len(items)
