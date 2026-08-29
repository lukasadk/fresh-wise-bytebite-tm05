"""consumption_waste_log -- Epic 1: "record whether purchased food was
consumed or wasted and why". Backs MarkConsumedScreen, MarkWastedScreen,
RecordOutcomeScreen, WasteRecordedScreen.

Writing a log is the ONLY way a food_item reaches 'consumed' or 'wasted'.
`FoodItemUpdate.status` is typed to `FoodItemPatchableStatus`, which excludes
both, so PATCH /v1/pantry/{id} cannot mark an item wasted behind the
dashboard's back -- this router owns that transition because it's the one
that also decrements `quantity` and captures `waste_reason`.
"""
from datetime import datetime
from decimal import ROUND_HALF_UP, Decimal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.deps import get_current_user
from app.models import ConsumptionWasteLog, FoodItem, UserProfile
from app.schemas import ConsumptionWasteLogCreate, ConsumptionWasteLogOut, LogStatus

router = APIRouter(prefix="/v1/logs", tags=["logs"])

# food_item.quantity is NUMERIC(10,2). Quantising the logged amount to the same
# scale keeps the arithmetic below consistent with what Postgres actually
# stores -- otherwise logging e.g. 0.005 against 1.00 leaves the API thinking
# 0.995 remains while the column rounds back to 1.00.
QTY_SCALE = Decimal("0.01")


@router.post("", response_model=ConsumptionWasteLogOut, status_code=status.HTTP_201_CREATED)
async def record_outcome(
    body: ConsumptionWasteLogCreate,
    user: UserProfile = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    # SELECT ... FOR UPDATE: this is a read-modify-write on item.quantity, and
    # two concurrent logs against the same item would otherwise both read the
    # old quantity, both pass the "enough remaining" check, and both commit --
    # logging more than the household ever had. The row lock serialises them so
    # the second request sees the first one's decrement.
    result = await db.execute(
        select(FoodItem).where(FoodItem.item_id == body.item_id).with_for_update()
    )
    item = result.scalar_one_or_none()
    if item is None or item.user_id != user.user_id:
        # Same 404 either way -- never confirm another device's item IDs exist.
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Food item not found")
    if item.status in ("consumed", "wasted"):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Food item is already fully '{item.status}' -- nothing left to log against it.",
        )

    logged_qty = Decimal(str(body.quantity)).quantize(QTY_SCALE, rounding=ROUND_HALF_UP)
    if logged_qty <= 0:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Quantity rounds to 0 at the stored precision (2 decimal places).",
        )
    if logged_qty > item.quantity:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Cannot log {logged_qty} {item.unit or ''} -- only {item.quantity} remaining on this item.",
        )

    log = ConsumptionWasteLog(
        item_id=item.item_id,
        status=body.status,
        quantity=logged_qty,
        waste_reason=body.waste_reason,
        notes=body.notes,
    )
    db.add(log)

    remaining = item.quantity - logged_qty
    if remaining <= 0:
        item.quantity = Decimal("0")
        item.status = body.status  # fully consumed or fully wasted
    else:
        item.quantity = remaining
        item.status = "partially_used"

    await db.commit()
    await db.refresh(log)
    return log


@router.get("", response_model=list[ConsumptionWasteLogOut])
async def list_logs(
    item_id: UUID | None = None,
    status_filter: LogStatus | None = Query(default=None, alias="status"),
    since: datetime | None = None,
    until: datetime | None = None,
    user: UserProfile = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    # Selects FoodItem.name/unit alongside the log row -- ConsumptionWasteLog
    # only stores item_id, and a history list showing a raw UUID instead of
    # "Milk" would be useless. The join already existed here (for the
    # user_id ownership check); this just also pulls two more columns off it.
    query = (
        select(ConsumptionWasteLog, FoodItem.name, FoodItem.unit)
        .join(FoodItem, FoodItem.item_id == ConsumptionWasteLog.item_id)
        .where(FoodItem.user_id == user.user_id)
    )
    if item_id is not None:
        query = query.where(ConsumptionWasteLog.item_id == item_id)
    if status_filter is not None:
        query = query.where(ConsumptionWasteLog.status == status_filter)
    if since is not None:
        query = query.where(ConsumptionWasteLog.logged_at >= since)
    if until is not None:
        query = query.where(ConsumptionWasteLog.logged_at <= until)
    query = query.order_by(ConsumptionWasteLog.logged_at.desc())

    result = await db.execute(query)
    return [
        ConsumptionWasteLogOut(
            log_id=log.log_id,
            item_id=log.item_id,
            status=log.status,
            quantity=log.quantity,
            waste_reason=log.waste_reason,
            notes=log.notes,
            logged_at=log.logged_at,
            item_name=name,
            item_unit=unit,
        )
        for log, name, unit in result.all()
    ]