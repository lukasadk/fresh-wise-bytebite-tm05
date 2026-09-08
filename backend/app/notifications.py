"""Daily reminder job for items approaching expiry (not yet past it).

Complements auto_waste.py, not overlapping with it: this covers the Amber/Red
band (0-3 days left, matching the same threshold the app's own colour bands
use -- see getExpiryInfo() on the frontend), while auto_waste.py only acts on
items strictly PAST their expiry date. An item at day 0 (expiring today)
shows up here, not in auto-waste, matching auto-waste's own one-day grace
period.

This job only sends a notification -- it never changes any FoodItem or
creates a log row, unlike auto_waste.py. Purely informational.
"""
import logging
from datetime import date, timedelta

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import FoodItem, UserProfile

logger = logging.getLogger(__name__)

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"
REMINDER_COLOR = "#C68A2E"  # Amber Gold -- matches the "expiring soon" band elsewhere
REMINDER_WINDOW_DAYS = 3  # 0-3 days left, same boundary as the Amber/Red UI thresholds


async def run_daily_expiry_check(db: AsyncSession) -> int:
    """Returns the number of push notifications actually sent (one per user
    with at least one qualifying item and a registered push token)."""
    today = date.today()
    cutoff = today + timedelta(days=REMINDER_WINDOW_DAYS)

    result = await db.execute(
        select(FoodItem, UserProfile)
        .join(UserProfile, FoodItem.user_id == UserProfile.user_id)
        .where(
            FoodItem.status.in_(["active", "partially_used"]),
            FoodItem.expiry_date.is_not(None),
            FoodItem.expiry_date >= today,
            FoodItem.expiry_date <= cutoff,
        )
    )
    rows = result.all()

    by_user: dict[str, list[str]] = {}
    tokens: dict[str, str | None] = {}
    for item, user in rows:
        user_id = str(user.user_id)
        by_user.setdefault(user_id, []).append(item.name)
        tokens[user_id] = user.push_token

    sent = 0
    async with httpx.AsyncClient(timeout=10) as client:
        for user_id, names in by_user.items():
            token = tokens.get(user_id)
            if not token:
                continue  # no registered device for this user -- nothing to push to
            title = f"{len(names)} item{'s' if len(names) != 1 else ''} need attention soon"
            body = ", ".join(names[:3]) + (f", +{len(names) - 3} more" if len(names) > 3 else "")
            try:
                response = await client.post(
                    EXPO_PUSH_URL,
                    json={"to": token, "title": title, "body": body, "color": REMINDER_COLOR, "sound": "default"},
                )
                response.raise_for_status()
                sent += 1
            except httpx.HTTPError:
                logger.warning("Expiry-reminder push failed for user %s", user_id, exc_info=True)

    return sent