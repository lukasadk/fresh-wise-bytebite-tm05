"""Planned recipes ("Plan to cook") -- recipes the household plans to cook later.

Planning a recipe does two things in one request:
  1. saves the recipe to the Planned tab (once per recipe_key), and
  2. puts its missing ingredients on the shopping list (Epic 8), skipping any
     name that is already on the list to buy or already in stock at home.

The plan remembers which shopping list rows it added or relies on, so
cancelling a plan can also remove those rows if they are still "to buy". Rows
the user already bought, and rows another plan also needs, are left alone.

The table is created on first use with CREATE TABLE IF NOT EXISTS, so a deploy
works on an existing database without running db/006_planned_recipe.sql by
hand. Running that file as well is harmless.
"""
from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import delete, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.deps import get_current_user
from app.models import FoodItem, PlannedRecipe, ShoppingListItem, UserProfile
from app.routers.shopping import _past_category
from app.schemas import PlannedRecipeCreate, PlannedRecipeOut, PlanRecipeResult
from app.shopping import name_key, names_match

router = APIRouter(prefix="/v1/planned-recipes", tags=["planned-recipes"])

MAX_PLANNED_PER_USER = 50

_CREATE_TABLE_SQL = [
    """
    CREATE TABLE IF NOT EXISTS planned_recipe (
        planned_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id            UUID NOT NULL REFERENCES user_profile(user_id) ON DELETE CASCADE,
        recipe_key         VARCHAR(160) NOT NULL,
        title              VARCHAR(160) NOT NULL,
        recipe             JSONB NOT NULL DEFAULT '{}'::jsonb,
        shopping_item_ids  JSONB NOT NULL DEFAULT '[]'::jsonb,
        planned_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT planned_recipe_user_key_unique UNIQUE (user_id, recipe_key)
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_planned_recipe_user ON planned_recipe(user_id)",
]

_table_ready = False


async def _ensure_table(db: AsyncSession) -> None:
    """Create planned_recipe once per server process if it isn't there yet."""
    global _table_ready
    if _table_ready:
        return
    for statement in _CREATE_TABLE_SQL:
        await db.execute(text(statement))
    await db.commit()
    _table_ready = True


async def _get_owned(db: AsyncSession, planned_id: UUID, user: UserProfile) -> PlannedRecipe:
    plan = await db.get(PlannedRecipe, planned_id)
    # Someone else's plan is reported exactly like a missing one.
    if plan is None or plan.user_id != user.user_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Planned recipe not found")
    return plan


@router.get("", response_model=list[PlannedRecipeOut])
async def list_planned_recipes(user: UserProfile = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await _ensure_table(db)
    result = await db.execute(
        select(PlannedRecipe).where(PlannedRecipe.user_id == user.user_id).order_by(PlannedRecipe.planned_at.desc())
    )
    return list(result.scalars().all())


@router.post("", response_model=PlanRecipeResult, status_code=status.HTTP_201_CREATED)
async def plan_recipe(
    body: PlannedRecipeCreate, user: UserProfile = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    await _ensure_table(db)

    plan = await db.scalar(
        select(PlannedRecipe).where(PlannedRecipe.user_id == user.user_id, PlannedRecipe.recipe_key == body.recipe_key)
    )
    already_planned = plan is not None
    if plan is None:
        count = await db.scalar(
            select(func.count()).select_from(PlannedRecipe).where(PlannedRecipe.user_id == user.user_id)
        )
        if (count or 0) >= MAX_PLANNED_PER_USER:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"You can plan up to {MAX_PLANNED_PER_USER} recipes. Remove one to plan another.",
            )
        plan = PlannedRecipe(user_id=user.user_id, recipe_key=body.recipe_key, title=body.title, recipe=body.recipe)
        db.add(plan)

    # What is already on the list to buy, and what is in stock and unexpired
    # (the same "at home" rule as the duplicate warning, AC 8.2.1 / 8.2.4).
    on_list = [
        (str(item_id), name)
        for item_id, name in (
            await db.execute(
                select(ShoppingListItem.list_item_id, ShoppingListItem.name).where(
                    ShoppingListItem.user_id == user.user_id, ShoppingListItem.status == "to_buy"
                )
            )
        ).all()
    ]
    today = date.today()
    in_stock = (
        await db.execute(
            select(FoodItem.name).where(
                FoodItem.user_id == user.user_id,
                FoodItem.status.in_(["active", "partially_used"]),
                (FoodItem.expiry_date.is_(None)) | (FoodItem.expiry_date >= today),
            )
        )
    ).scalars().all()

    added: list[str] = []
    already_on_list: list[str] = []
    already_at_home: list[str] = []
    new_ids: list[str] = list(plan.shopping_item_ids or [])
    seen: set[str] = set()
    for name in body.ingredients:
        key = name_key(name)
        if key in seen:
            continue
        seen.add(key)
        listed = next((item_id for item_id, existing in on_list if names_match(existing, name)), None)
        if listed is not None:
            already_on_list.append(name)
            # Remember the row too, so cancelling another plan that also
            # needs it doesn't take it off the list.
            if listed not in new_ids:
                new_ids.append(listed)
            continue
        if any(names_match(stock, name) for stock in in_stock):
            already_at_home.append(name)
            continue
        row = ShoppingListItem(
            user_id=user.user_id,
            name=name[:100],
            category=await _past_category(db, user, name),
            quantity=1,
            remaining_qty=1,
            source="manual",
        )
        db.add(row)
        await db.flush()
        new_ids.append(str(row.list_item_id))
        added.append(name)
        on_list.append((str(row.list_item_id), name))

    plan.shopping_item_ids = new_ids
    await db.commit()
    await db.refresh(plan)
    return PlanRecipeResult(
        plan=PlannedRecipeOut.model_validate(plan),
        already_planned=already_planned,
        added=added,
        already_on_list=already_on_list,
        already_at_home=already_at_home,
    )


@router.delete("/{planned_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_planned_recipe(
    planned_id: UUID,
    remove_items: bool = Query(
        default=False,
        description="Also remove the shopping list rows this plan added, if they are still to buy "
        "and no other plan needs them. Leave false after the recipe was cooked.",
    ),
    user: UserProfile = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _ensure_table(db)
    plan = await _get_owned(db, planned_id, user)

    if remove_items and plan.shopping_item_ids:
        others = (
            await db.execute(
                select(PlannedRecipe.shopping_item_ids).where(
                    PlannedRecipe.user_id == user.user_id, PlannedRecipe.planned_id != plan.planned_id
                )
            )
        ).scalars().all()
        shared = {item_id for ids in others for item_id in (ids or [])}
        removable = [UUID(i) for i in plan.shopping_item_ids if i not in shared]
        if removable:
            await db.execute(
                delete(ShoppingListItem).where(
                    ShoppingListItem.user_id == user.user_id,
                    ShoppingListItem.list_item_id.in_(removable),
                    ShoppingListItem.status == "to_buy",
                )
            )

    await db.delete(plan)
    await db.commit()
