"""Daily auto-waste job for genuinely expired items.

Deliberate product decision (explicitly confirmed, not a default): items past
their expiry_date are automatically logged as fully wasted, WITHOUT the user
manually confirming a quantity or reason via Mark Wasted. This is a real
change in what a waste log row "means" elsewhere in this app -- every other
row only exists because a user explicitly confirmed it via record_outcome().
Auto-waste rows are tagged in `notes` so they can be told apart later if that
distinction ever matters (e.g. for Activity, or for letting a user undo one).

Threshold: only items with expiry_date STRICTLY BEFORE today (days_to_expiry
< 0) are auto-wasted -- an item due TODAY is not yet auto-wasted, it only
shows up in the existing reminder notification (app/notifications.py). This
gives a one-day grace period rather than auto-wasting the moment the calendar
flips to the expiry date itself.

There is no screen for a background job to "navigate" the user to -- the
notification below is what actually reaches them, telling them what changed
and why, since silently rewriting their pantry with no notice would be
confusing even though the AC calls for no confirmation step.
"""
import logging
from datetime import date
from decimal import Decimal

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import ConsumptionWasteLog, FoodItem, UserProfile

logger = logging.getLogger(__name__)

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"
AUTO_WASTE_COLOR = "#D9603B"  # Coral Red -- matches the expired/urgent band elsewhere


async def run_daily_auto_waste_expired(db: AsyncSession) -> int:
    """Returns the number of items auto-wasted (for logging / the manual
    trigger endpoint's response, never surfaced to end users directly)."""
    # Row-locked for the same reason record_outcome() locks FoodItem: this is
    # a read-modify-write on quantity/status, and without the lock a
    # concurrent manual Mark Wasted against the same item could race this job.
    result = await db.execute(
        select(FoodItem, UserProfile)
        .join(UserProfile, FoodItem.user_id == UserProfile.user_id)
        .where(
            FoodItem.status.in_(["active", "partially_used"]),
            FoodItem.expiry_date.is_not(None),
        )
        .with_for_update(of=FoodItem)
    )
    rows = result.all()

    today = date.today()
    by_user: dict[str, list[str]] = {}
    tokens: dict[str, str | None] = {}
    wasted_count = 0

    for item, user in rows:
        if item.expiry_date >= today:
            continue  # not yet past expiry -- the reminder notification covers this case

        log = ConsumptionWasteLog(
            item_id=item.item_id,
            status="wasted",
            quantity=item.quantity,
            waste_reason="expired",
            notes="Auto-recorded: item passed its expiry date without being logged.",
        )
        db.add(log)
        item.quantity = Decimal("0")
        item.status = "wasted"
        wasted_count += 1

        user_id = str(user.user_id)
        by_user.setdefault(user_id, []).append(item.name)
        tokens[user_id] = user.push_token

    await db.commit()

    sent = 0
    async with httpx.AsyncClient(timeout=10) as client:
        for user_id, names in by_user.items():
            token = tokens.get(user_id)
            if not token:
                continue  # still auto-wasted -- just can't reach this user with a notice
            title = f"{len(names)} item{'s' if len(names) != 1 else ''} auto-recorded as wasted"
            body = ", ".join(names[:3]) + (f", +{len(names) - 3} more" if len(names) > 3 else "")
            try:
                response = await client.post(
                    EXPO_PUSH_URL,
                    json={"to": token, "title": title, "body": body, "color": AUTO_WASTE_COLOR, "sound": "default"},
                )
                response.raise_for_status()
                sent += 1
            except httpx.HTTPError:
                logger.warning("Auto-waste push failed for user %s", user_id, exc_info=True)

    return wasted_count