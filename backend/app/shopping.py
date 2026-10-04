"""Shopping-list logic shared by the shopping router and the pantry router.

Kept out of routers/ because routers/pantry.py needs it too (auto-tick,
AC 8.3.1-8.3.3), and one router importing another is how circular imports start.
"""
from datetime import datetime, timezone
from difflib import SequenceMatcher

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import DismissedSuggestion, FoodItem, ShoppingListItem

# AC 8.2.1 / 8.3.1: "at least 85% similar (ignoring case)".
SIMILARITY_THRESHOLD = 0.85


def name_key(name: str | None) -> str:
    return (name or "").strip().lower()


def names_match(a: str | None, b: str | None) -> bool:
    """True when two item names are >= 85% similar, ignoring case and outer spaces.

    difflib (standard library) rather than a fuzzy-matching package, so this
    adds nothing to requirements.txt.
    """
    ka, kb = name_key(a), name_key(b)
    if not ka or not kb:
        return False
    if ka == kb:
        return True
    return SequenceMatcher(None, ka, kb).ratio() >= SIMILARITY_THRESHOLD


def categories_match(a: str | None, b: str | None) -> bool:
    # AC 8.3.1: "the category is the same". Case-insensitive, and an item
    # with no category only matches another with no category.
    return name_key(a) == name_key(b)


async def tick_shopping_list(db: AsyncSession, item: FoodItem) -> bool:
    """Match a just-saved pantry item against the "To Buy" rows (AC 8.3.1).

    Full match  (saved qty >= remaining) -> row moves to "Bought" (AC 8.3.2).
    Partial     (saved qty <  remaining) -> remaining_qty goes down (AC 8.3.3).

    Only one row is ticked per saved item (the oldest match), so saving "Milk"
    once can't tick off two separate Milk rows. Returns True only for a FULL
    match -- that's what the "N items ticked off" toast counts (AC 8.3.4).

    Does NOT commit; the caller commits with the pantry insert.
    """
    result = await db.execute(
        select(ShoppingListItem)
        .where(ShoppingListItem.user_id == item.user_id, ShoppingListItem.status == "to_buy")
        .order_by(ShoppingListItem.created_at.asc())
    )
    for row in result.scalars():
        if not (names_match(row.name, item.name) and categories_match(row.category, item.category)):
            continue
        saved_qty = float(item.quantity)
        remaining = float(row.remaining_qty)
        if saved_qty >= remaining:
            row.remaining_qty = 0
            row.status = "bought"
            row.bought_at = datetime.now(timezone.utc)
            return True
        row.remaining_qty = remaining - saved_qty
        return False
    return False


async def clear_dismissals_for(db: AsyncSession, item: FoodItem) -> None:
    """AC 8.1.6: a removed suggestion may come back once a new pantry entry
    for that item is saved. Does NOT commit."""
    result = await db.execute(select(DismissedSuggestion).where(DismissedSuggestion.user_id == item.user_id))
    stale = [d.name_key for d in result.scalars() if names_match(d.name_key, item.name)]
    if stale:
        await db.execute(
            delete(DismissedSuggestion).where(
                DismissedSuggestion.user_id == item.user_id, DismissedSuggestion.name_key.in_(stale)
            )
        )
