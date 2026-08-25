"""diet_preference -- "someone wants more protein, others don't" (per-user
saved filter). Religion-linked tags (halal/kosher/...) are rejected here
AND at the DB level (CHECK constraint) -- see database-schema-no-pii.md
for why. Ad hoc religion-linked filtering still works by querying
recipe.diet_tags directly per search (see routers/recipes.py), it's just
never *saved* against a user_id.
"""
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.deps import get_current_user
from app.models import DietPreference, UserProfile
from app.schemas import DietPreferenceCreate, DietPreferenceOut

router = APIRouter(prefix="/v1/diet-preferences", tags=["diet"])


@router.get("", response_model=list[DietPreferenceOut])
async def list_diet_preferences(
    user: UserProfile = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    result = await db.execute(select(DietPreference).where(DietPreference.user_id == user.user_id))
    return list(result.scalars().all())


@router.post("", response_model=DietPreferenceOut, status_code=status.HTTP_201_CREATED)
async def add_diet_preference(
    body: DietPreferenceCreate,
    user: UserProfile = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    pref = DietPreference(user_id=user.user_id, tag=body.tag, target_value=body.target_value)
    db.add(pref)
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Preference tag '{body.tag}' already saved for this user.",
        ) from exc
    await db.refresh(pref)
    return pref


@router.delete("/{preference_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_diet_preference(
    preference_id: UUID,
    user: UserProfile = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(DietPreference).where(DietPreference.preference_id == preference_id))
    pref = result.scalar_one_or_none()
    if pref is None or pref.user_id != user.user_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Preference not found")
    await db.delete(pref)
    await db.commit()
