"""Shared FastAPI dependencies.

There is no login/session anywhere in this app (see
database-schema-no-pii.md). Identity is just the UUID the client device
generated on first launch and sends on every request in the
`X-Device-Id` header (header name configurable via DEVICE_ID_HEADER).
The server never issues, checks, or stores a credential of any kind.
"""
from uuid import UUID

from fastapi import Depends, Header, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db import get_db
from app.models import UserProfile

settings = get_settings()


async def get_device_id(
    x_device_id: str | None = Header(default=None, alias=settings.device_id_header),
) -> UUID:
    if not x_device_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Missing '{settings.device_id_header}' header. The app must send the "
            "client-generated device UUID on every request.",
        )
    try:
        return UUID(x_device_id)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"'{settings.device_id_header}' must be a valid UUID.",
        ) from exc


async def get_current_user(
    device_id: UUID = Depends(get_device_id),
    db: AsyncSession = Depends(get_db),
) -> UserProfile:
    result = await db.execute(select(UserProfile).where(UserProfile.user_id == device_id))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No profile for this device UUID yet. Call POST /v1/users first.",
        )
    return user
