"""food_item CRUD -- backs PantryScreen, AddFoodScreen, FoodDetailScreen, UseFirstScreen."""
from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.deps import get_current_user
from app.models import FoodItem, UserProfile
from app.schemas import FoodItemCreate, FoodItemOut, FoodItemStatus, FoodItemUpdate

router = APIRouter(prefix="/v1/pantry", tags=["pantry"])


def _to_out(item: FoodItem) -> FoodItemOut:
    out = FoodItemOut.model_validate(item)
    if item.expiry_date is not None:
        out.days_to_expiry = (item.expiry_date - date.today()).days
    return out


async def _get_owned_item(item_id: UUID, user: UserProfile, db: AsyncSession) -> FoodItem:
    result = await db.execute(select(FoodItem).where(FoodItem.item_id == item_id))
    item = result.scalar_one_or_none()
    if item is None or item.user_id != user.user_id:
        # Same 404 whether it doesn't exist or belongs to someone else --
        # never confirm another device's item IDs exist.
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Food item not found")
    return item


@router.get("", response_model=list[FoodItemOut])
async def list_pantry_items(
    status_filter: FoodItemStatus | None = Query(default=None, alias="status"),
    expiring_within_days: int | None = Query(default=None, ge=0),
    user: UserProfile = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    query = select(FoodItem).where(FoodItem.user_id == user.user_id)
    if status_filter is not None:
        query = query.where(FoodItem.status == status_filter)
    else:
        # Default view: what's actually in the pantry, not the whole history.
        query = query.where(FoodItem.status.in_(["active", "partially_used"]))
    query = query.order_by(FoodItem.expiry_date.asc().nulls_last())

    result = await db.execute(query)
    items = list(result.scalars().all())

    if expiring_within_days is not None:
        cutoff = date.today()
        items = [
            i for i in items if i.expiry_date is not None and (i.expiry_date - cutoff).days <= expiring_within_days
        ]

    return [_to_out(i) for i in items]


@router.post("", response_model=FoodItemOut, status_code=status.HTTP_201_CREATED)
async def create_pantry_item(
    body: FoodItemCreate,
    user: UserProfile = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    item = FoodItem(user_id=user.user_id, **body.model_dump(exclude_unset=True))
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return _to_out(item)


@router.get("/{item_id}", response_model=FoodItemOut)
async def get_pantry_item(
    item_id: UUID, user: UserProfile = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    item = await _get_owned_item(item_id, user, db)
    return _to_out(item)


@router.patch("/{item_id}", response_model=FoodItemOut)
async def update_pantry_item(
    item_id: UUID,
    body: FoodItemUpdate,
    user: UserProfile = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    item = await _get_owned_item(item_id, user, db)
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(item, field, value)
    await db.commit()
    await db.refresh(item)
    return _to_out(item)


@router.delete("/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_pantry_item(
    item_id: UUID, user: UserProfile = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    item = await _get_owned_item(item_id, user, db)
    await db.delete(item)
    await db.commit()
