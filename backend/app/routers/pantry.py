"""food_item CRUD -- backs PantryScreen, AddFoodScreen, FoodDetailScreen, UseFirstScreen."""
from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.deps import get_current_user
from app.food_value import apply_estimate, item_value, money
from app.models import FoodItem, UserProfile
from app.schemas import FoodItemCreate, FoodItemOut, FoodItemStatus, FoodItemUpdate
from app.shopping import clear_dismissals_for, tick_shopping_list

router = APIRouter(prefix="/v1/pantry", tags=["pantry"])


def _canonical(name: str | None) -> str | None:
    """The reference-lookup key derived from the display name.

    `canonical_food_name` is what /v1/reference/foodkeeper and recipe matching
    join on. It has never been anything BUT a normalised copy of `name` -- there
    is no curation UI and nothing else writes it -- so it is derived here rather
    than trusted from the client. That matters on PATCH: it used to be settable
    only at creation, so a user who typed "Chiken breast", got no storage
    guidance, and edited the name to fix the typo still got no guidance, with
    nothing on screen explaining why. Deriving it server-side means the key can
    never drift from the name the user can see and correct.
    """
    if name is None:
        return None
    cleaned = name.strip().lower()
    return cleaned or None


def _user_chose_key(item: FoodItem) -> bool:
    """Whether this item's lookup key was picked deliberately, not derived.

    The key is normally just `name` normalised, so a rename should re-point it.
    But the storage-guidance picker lets a user say "this is actually FoodKeeper's
    `lean fish cod flounder haddock ...`" for an item they called "Ikan" -- and a
    later rename must not silently throw that away.

    Rather than carry a `canonical_is_user_choice` column (a schema change, and a
    migration against the NAS), the state is inferred: if the stored key differs
    from what `name` would produce, only the picker can have set it, because
    nothing else ever writes the field. The one ambiguous case is a user picking
    the product whose name already equals what they typed -- and there the pick
    and the derivation agree, so re-deriving on rename changes nothing.
    """
    return (
        item.canonical_food_name is not None
        and item.canonical_food_name != _canonical(item.name)
    )


def _to_out(item: FoodItem) -> FoodItemOut:
    out = FoodItemOut.model_validate(item)
    if item.expiry_date is not None:
        out.days_to_expiry = (item.expiry_date - date.today()).days
    # Epic 9: what's left of the item is worth unit value x current quantity.
    out.est_value_rm = money(item_value(item.est_unit_value_rm, item.quantity))
    return out


def _estimate_value(item: FoodItem) -> None:
    """Epic 9 (AC 9.1.1 / 9.1.2): store the PriceCatcher-based estimate.

    Never allowed to break a save -- if the snapshot file is missing or
    unreadable the item is simply saved without a value, exactly like an
    item with no PriceCatcher match.
    """
    try:
        apply_estimate(item)
    except Exception as exc:  # noqa: BLE001 -- valuation is optional by design
        print(f"[pantry] value estimate skipped: {exc.__class__.__name__}: {exc}")


async def _get_owned_item(item_id: UUID, user: UserProfile, db: AsyncSession) -> FoodItem:
    result = await db.execute(select(FoodItem).where(FoodItem.item_id == item_id))
    item = result.scalar_one_or_none()
    if item is None or item.user_id != user.user_id:
        # Same 404 whether it doesn't exist or belongs to someone else --
        # never confirm another device's item IDs exist.
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Food item not found")
    return item


async def _shopping_list_hooks(db: AsyncSession, item: FoodItem) -> bool:
    """Epic 8 side effects of saving a pantry item. Never allowed to break the save.

    Runs inside a SAVEPOINT: if the shopping tables don't exist yet (backend
    deployed before db/003_shopping_list.sql was run) or anything else in
    Epic 8 fails, only the savepoint is rolled back -- the pantry item itself
    is still saved, exactly as it was before Epic 8 existed.
    """
    try:
        async with db.begin_nested():
            ticked = await tick_shopping_list(db, item)
            await clear_dismissals_for(db, item)
        return ticked
    except SQLAlchemyError as exc:
        print(f"[pantry] shopping-list hooks skipped: {exc.__class__.__name__}: {str(exc).splitlines()[0]}")
        return False


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
    fields = body.model_dump(exclude_unset=True)
    # The client sends this too, identically; deriving it here as well means a
    # client that omits it still gets working guidance rather than silently none.
    if not fields.get("canonical_food_name"):
        fields["canonical_food_name"] = _canonical(fields.get("name"))
    item = FoodItem(user_id=user.user_id, **fields)
    _estimate_value(item)
    db.add(item)
    await db.flush()
    # Epic 8: every save path (Add Food, Photo Review, old photo screen) comes
    # through here, so auto-tick (AC 8.3.1-8.3.3) and "suggest it again after a
    # new pantry entry" (AC 8.1.6) happen in the same transaction as the insert.
    ticked = await _shopping_list_hooks(db, item)
    await db.commit()
    await db.refresh(item)
    out = _to_out(item)
    out.shopping_ticked = ticked
    return out


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
    fields = body.model_dump(exclude_unset=True)
    chosen_before = _user_chose_key(item)
    for field, value in fields.items():
        setattr(item, field, value)

    if fields.get("canonical_food_name"):
        # An explicit pick from the guidance picker. Normalise it so it matches
        # the reference table the same way a derived key does, then leave it be.
        item.canonical_food_name = _canonical(fields["canonical_food_name"])
    elif "name" in fields and not chosen_before:
        # Renaming re-points the lookup, so Edit is the repair path for an item
        # that matched nothing or matched the wrong food -- but only while the
        # key is still auto-derived. Once the user has chosen a food explicitly,
        # their choice outranks whatever the new name would derive to.
        item.canonical_food_name = _canonical(fields["name"])
    if "name" in fields or "unit" in fields:
        # A rename or unit fix is how a user repairs a missed estimate too.
        _estimate_value(item)
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
