"""Smart Shopping List (Epic 8) -- backs ShoppingListScreen and AddShoppingItemScreen."""
import traceback
from datetime import date, datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import JSONResponse
from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app import purchase_recommendations as recs_contract
from app.db import get_db
from app.deps import get_current_user
from app.models import DismissedSuggestion, FoodItem, ShoppingListItem, UserProfile
from app.schemas import (
    DuplicateStockOut,
    NameSuggestionOut,
    ShoppingItemCreate,
    ShoppingItemOut,
    ShoppingItemUpdate,
    ShoppingListOut,
    SkippedItemOut,
)
from app.shopping import name_key, names_match

router = APIRouter(prefix="/v1/shopping-list", tags=["shopping-list"])


async def _load_recommendations(db: AsyncSession, user: UserProfile):
    """Epic 7's output, or None when Epic 7 isn't there (or broke).

    A crash inside Epic 7 is logged but doesn't take the shopping list down
    with it -- manual items, the duplicate warning and auto-tick don't depend on it.
    """
    try:
        return await recs_contract.get_purchase_recommendations(db, user)
    except Exception:  # noqa: BLE001 -- deliberately broad, see docstring
        print("[shopping-list] purchase recommendations failed:")
        traceback.print_exc()
        return None


async def _sync_suggestions(db: AsyncSession, user: UserProfile, recs) -> None:
    """Bring the 'suggested' rows in line with Epic 7's current recommendations.

    * New BUY_MORE / KEEP_SAME / BUY_LESS item with qty > 0  -> add a row (AC 8.1.2),
      unless the user removed it earlier (AC 8.1.6) or it's already on the list.
    * Still recommended                                       -> refresh its state/qty,
      but only if nothing has been ticked off it yet.
    * No longer recommended                                   -> drop the row, again
      only if untouched, so a half-bought item never vanishes mid-trip.
    """
    buy_recs = {
        name_key(r.name): r
        for r in recs
        if r.state in recs_contract.BUY_STATES and r.recommended_qty > 0
    }

    dismissed_result = await db.execute(
        select(DismissedSuggestion.name_key).where(DismissedSuggestion.user_id == user.user_id)
    )
    dismissed = set(dismissed_result.scalars())

    rows_result = await db.execute(select(ShoppingListItem).where(ShoppingListItem.user_id == user.user_id))
    rows = list(rows_result.scalars())
    keys_on_list = {name_key(r.name) for r in rows}

    for row in rows:
        if row.source != "suggested" or row.status != "to_buy":
            continue
        untouched = float(row.remaining_qty) == float(row.quantity)
        rec = buy_recs.get(name_key(row.name))
        if rec is None:
            if untouched:
                await db.delete(row)
            continue
        row.rec_state = rec.state
        if untouched:
            row.quantity = rec.recommended_qty
            row.remaining_qty = rec.recommended_qty

    for key, rec in buy_recs.items():
        if key in dismissed or key in keys_on_list:
            continue
        db.add(
            ShoppingListItem(
                user_id=user.user_id,
                name=rec.name,
                category=rec.category,
                unit=rec.unit,
                quantity=rec.recommended_qty,
                remaining_qty=rec.recommended_qty,
                source="suggested",
                rec_state=rec.state,
            )
        )

    await db.commit()


async def _get_owned_row(list_item_id: UUID, user: UserProfile, db: AsyncSession) -> ShoppingListItem:
    row = await db.get(ShoppingListItem, list_item_id)
    if row is None or row.user_id != user.user_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shopping list item not found")
    return row


async def _past_category(db: AsyncSession, user: UserProfile, name: str) -> str:
    """Category for an item added without one: whatever the user last saved a
    matching pantry item under, else 'Other'.

    Auto-tick (AC 8.3.1) needs the categories to agree, so guessing from the
    user's own history beats a blank that could never match anything.
    """
    result = await db.execute(
        select(FoodItem.name, FoodItem.category)
        .where(FoodItem.user_id == user.user_id, FoodItem.category.is_not(None))
        .order_by(FoodItem.created_at.desc())
    )
    for past_name, past_category in result.all():
        if names_match(past_name, name):
            return past_category
    return "Other"


@router.get("", response_model=ShoppingListOut)
async def get_shopping_list(user: UserProfile = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    recs = await _load_recommendations(db, user)
    if recs is not None:
        await _sync_suggestions(db, user, recs)

    result = await db.execute(
        select(ShoppingListItem)
        .where(ShoppingListItem.user_id == user.user_id)
        .order_by(ShoppingListItem.created_at.asc())
    )
    rows = list(result.scalars())
    to_buy = [ShoppingItemOut.model_validate(r) for r in rows if r.status == "to_buy"]
    bought = sorted(
        (ShoppingItemOut.model_validate(r) for r in rows if r.status == "bought"),
        key=lambda r: r.bought_at or r.created_at,
        reverse=True,
    )
    skipped = [
        SkippedItemOut(name=r.name, category=r.category, reason=r.reason)
        for r in (recs or [])
        if r.state == recs_contract.SKIP_STATE
    ]
    return ShoppingListOut(
        to_buy=to_buy, bought=bought, skipped=skipped, recommendations_available=recs is not None
    )


@router.get("/name-suggestions", response_model=list[NameSuggestionOut])
async def name_suggestions(
    q: str = Query(min_length=1, max_length=100),
    user: UserProfile = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Past pantry item names for the Add Item autocomplete (AC 8.1.5).

    Every status, not just what's in the pantry now -- "past pantry items"
    includes things already eaten or thrown away. Each name comes with the
    category it was last saved under, so picking a suggestion can fill in the
    category too -- auto-tick (AC 8.3.1) only matches when categories agree.
    """
    lowered = func.lower(FoodItem.name)
    result = await db.execute(
        select(FoodItem.name, FoodItem.category)
        .where(FoodItem.user_id == user.user_id, FoodItem.name.icontains(q.strip(), autoescape=True))
        .distinct(lowered)
        .order_by(lowered, FoodItem.created_at.desc())
        .limit(8)
    )
    return [NameSuggestionOut(name=name, category=category) for name, category in result.all()]


@router.post(
    "/items",
    response_model=ShoppingItemOut,
    status_code=status.HTTP_201_CREATED,
    responses={409: {"model": DuplicateStockOut, "description": "Unexpired stock already at home (AC 8.2.1)"}},
)
async def add_shopping_item(
    body: ShoppingItemCreate, user: UserProfile = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    # AC 8.2.1 / 8.2.4: only UNEXPIRED stock counts. No expiry date = not expired.
    today = date.today()
    stock_result = await db.execute(
        select(FoodItem).where(
            FoodItem.user_id == user.user_id,
            FoodItem.status.in_(["active", "partially_used"]),
            (FoodItem.expiry_date.is_(None)) | (FoodItem.expiry_date >= today),
        )
    )
    matches = [i for i in stock_result.scalars() if names_match(i.name, body.name)]
    # Earliest expiry first; items with no expiry date last.
    matches.sort(key=lambda i: (i.expiry_date is None, i.expiry_date or date.max))
    qty_at_home = sum(float(i.quantity) for i in matches)

    if matches and not body.force:
        first = matches[0]
        warning = DuplicateStockOut(
            pantry_item_id=first.item_id,
            pantry_name=first.name,
            qty_at_home=qty_at_home,
            unit=first.unit,
            earliest_expiry=first.expiry_date,
        )
        return JSONResponse(status_code=status.HTTP_409_CONFLICT, content=warning.model_dump(mode="json"))

    category = body.category or await _past_category(db, user, body.name)
    row = ShoppingListItem(
        user_id=user.user_id,
        name=body.name,
        category=category,
        unit=body.unit,
        quantity=body.quantity,
        remaining_qty=body.quantity,
        source="manual",
        have_at_home_qty=qty_at_home if matches else None,  # "Have 2 at home" tag (AC 8.2.2)
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return ShoppingItemOut.model_validate(row)


@router.patch("/items/{list_item_id}", response_model=ShoppingItemOut)
async def update_shopping_item(
    list_item_id: UUID,
    body: ShoppingItemUpdate,
    user: UserProfile = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Manual tick / untick (AC 8.3.5)."""
    row = await _get_owned_row(list_item_id, user, db)
    row.status = body.status
    row.bought_at = datetime.now(timezone.utc) if body.status == "bought" else None
    await db.commit()
    await db.refresh(row)
    return ShoppingItemOut.model_validate(row)


@router.delete("/items/{list_item_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_shopping_item(
    list_item_id: UUID, user: UserProfile = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    """Swipe -> Remove (AC 8.1.6). The app only calls this once the 5-second
    Undo window has passed, so there's no restore endpoint."""
    row = await _get_owned_row(list_item_id, user, db)
    if row.source == "suggested":
        # Don't suggest it again until a new pantry entry for it is saved.
        stmt = pg_insert(DismissedSuggestion).values(user_id=user.user_id, name_key=name_key(row.name))
        await db.execute(
            stmt.on_conflict_do_update(
                index_elements=["user_id", "name_key"], set_={"dismissed_at": stmt.excluded.dismissed_at}
            )
        )
    await db.delete(row)
    await db.commit()


@router.delete("/bought", status_code=status.HTTP_204_NO_CONTENT)
async def clear_bought(user: UserProfile = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """"Clear Bought" (AC 8.3.6)."""
    await db.execute(
        delete(ShoppingListItem).where(
            ShoppingListItem.user_id == user.user_id, ShoppingListItem.status == "bought"
        )
    )
    await db.commit()
