"""Device-identity handshake. No login, no credentials -- see deps.py."""
from fastapi import APIRouter, Depends, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.deps import get_current_user
from app.models import UserProfile
from app.schemas import UserProfileCreate, UserProfileOut, UserProfileUpdate

router = APIRouter(prefix="/v1/users", tags=["users"])


@router.post("", response_model=UserProfileOut, status_code=status.HTTP_200_OK)
async def register_or_get_device(body: UserProfileCreate, db: AsyncSession = Depends(get_db)):
    """Get-or-create semantics, keyed on the client-generated UUID.

    Called once on first app launch. If this UUID already has a profile
    (e.g. the app re-sent the handshake), the existing row is returned
    unchanged -- use PATCH /v1/users/me to change household_size/location
    later, this endpoint never overwrites an existing profile.
    """
    existing = await db.execute(select(UserProfile).where(UserProfile.user_id == body.user_id))
    user = existing.scalar_one_or_none()
    if user is not None:
        return user

    user = UserProfile(user_id=body.user_id, household_size=body.household_size, location=body.location)
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


@router.get("/me", response_model=UserProfileOut)
async def get_me(user: UserProfile = Depends(get_current_user)):
    return user


@router.patch("/me", response_model=UserProfileOut)
async def update_me(
    body: UserProfileUpdate,
    user: UserProfile = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if body.household_size is not None:
        user.household_size = body.household_size
    if body.location is not None:
        user.location = body.location
    await db.commit()
    await db.refresh(user)
    return user


@router.delete("/me", status_code=status.HTTP_204_NO_CONTENT)
async def delete_me(user: UserProfile = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Deletes the profile and (via ON DELETE CASCADE) every food_item,
    consumption_waste_log, and diet_preference row tied to it -- the
    closest thing this app has to 'delete my data', matching the
    device-only identity model (no recovery once this is gone)."""
    await db.delete(user)
    await db.commit()
