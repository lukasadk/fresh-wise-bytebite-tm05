"""Homemade recipes ("My recipes") -- recipes the household wrote themselves.

Backs the My recipes tab and the Add / Edit recipe form. The app also mixes
these into the Recommended list when they use pantry food that expires soon
(that ranking happens on the phone, like the rest of the recipe ranking).

The table is created on first use with CREATE TABLE IF NOT EXISTS, so a
deploy works on an existing database without running db/005_user_recipe.sql
by hand. Running that file as well is harmless.
"""
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.deps import get_current_user
from app.models import UserProfile, UserRecipe
from app.schemas import UserRecipeCreate, UserRecipeOut, UserRecipeUpdate

router = APIRouter(prefix="/v1/my-recipes", tags=["my-recipes"])

MAX_RECIPES_PER_USER = 200

_CREATE_TABLE_SQL = [
    """
    CREATE TABLE IF NOT EXISTS user_recipe (
        recipe_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id       UUID NOT NULL REFERENCES user_profile(user_id) ON DELETE CASCADE,
        title         VARCHAR(120) NOT NULL,
        servings      SMALLINT,
        prep_minutes  SMALLINT,
        cook_minutes  SMALLINT,
        ingredients   JSONB NOT NULL DEFAULT '[]'::jsonb,
        steps         JSONB NOT NULL DEFAULT '[]'::jsonb,
        notes         VARCHAR(500),
        created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT user_recipe_servings_check CHECK (servings IS NULL OR servings BETWEEN 1 AND 50),
        CONSTRAINT user_recipe_minutes_check CHECK (
            (prep_minutes IS NULL OR prep_minutes BETWEEN 0 AND 1440)
            AND (cook_minutes IS NULL OR cook_minutes BETWEEN 0 AND 1440)
        )
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_user_recipe_user ON user_recipe(user_id)",
]

_table_ready = False


async def _ensure_table(db: AsyncSession) -> None:
    """Create user_recipe once per server process if it isn't there yet."""
    global _table_ready
    if _table_ready:
        return
    for statement in _CREATE_TABLE_SQL:
        await db.execute(text(statement))
    await db.commit()
    _table_ready = True


async def _get_owned(db: AsyncSession, recipe_id: UUID, user: UserProfile) -> UserRecipe:
    recipe = await db.get(UserRecipe, recipe_id)
    # Someone else's recipe is reported exactly like a missing one.
    if recipe is None or recipe.user_id != user.user_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Recipe not found")
    return recipe


@router.get("", response_model=list[UserRecipeOut])
async def list_my_recipes(user: UserProfile = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await _ensure_table(db)
    result = await db.execute(
        select(UserRecipe).where(UserRecipe.user_id == user.user_id).order_by(UserRecipe.updated_at.desc())
    )
    return list(result.scalars().all())


@router.get("/{recipe_id}", response_model=UserRecipeOut)
async def get_my_recipe(
    recipe_id: UUID, user: UserProfile = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    await _ensure_table(db)
    return await _get_owned(db, recipe_id, user)


@router.post("", response_model=UserRecipeOut, status_code=status.HTTP_201_CREATED)
async def create_my_recipe(
    body: UserRecipeCreate, user: UserProfile = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    await _ensure_table(db)
    count = await db.scalar(select(func.count()).select_from(UserRecipe).where(UserRecipe.user_id == user.user_id))
    if (count or 0) >= MAX_RECIPES_PER_USER:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"You can save up to {MAX_RECIPES_PER_USER} recipes. Delete one to add another.",
        )
    data = body.model_dump()
    recipe = UserRecipe(user_id=user.user_id, **data)
    db.add(recipe)
    await db.commit()
    await db.refresh(recipe)
    return recipe


@router.patch("/{recipe_id}", response_model=UserRecipeOut)
async def update_my_recipe(
    recipe_id: UUID,
    body: UserRecipeUpdate,
    user: UserProfile = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _ensure_table(db)
    recipe = await _get_owned(db, recipe_id, user)
    changes = body.model_dump(exclude_unset=True)
    for required in ("title", "ingredients"):
        if required in changes and changes[required] is None:
            raise HTTPException(status_code=422, detail=f"{required} can't be empty")
    for field, value in changes.items():
        setattr(recipe, field, value)
    recipe.updated_at = func.now()
    await db.commit()
    await db.refresh(recipe)
    return recipe


@router.delete("/{recipe_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_my_recipe(
    recipe_id: UUID, user: UserProfile = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    await _ensure_table(db)
    recipe = await _get_owned(db, recipe_id, user)
    await db.delete(recipe)
    await db.commit()