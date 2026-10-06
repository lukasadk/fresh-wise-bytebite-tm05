"""Epic 7 <-> Epic 8 contract: purchase recommendations.

Epic 8 (Smart Shopping List) is built BEFORE Epic 7 (Item Purchase Insight).
Instead of hardcoding recommendations, Epic 8 asks for them through
`get_purchase_recommendations()` below, which looks for Epic 7's code at
runtime:

    * Epic 7 not written yet  -> returns None. The shopping list still works
      (manual items, duplicate warning, auto-tick) and simply has no
      "Suggested" rows and no "Skip This Time" section.
    * Epic 7 written          -> its recommendations flow straight into the
      shopping list. Nothing in Epic 8 needs to change.

WHAT EPIC 7 NEEDS TO PROVIDE
----------------------------
Create `backend/app/purchase_insights.py` containing:

    async def compute_purchase_recommendations(db: AsyncSession, user: UserProfile):
        '''Return one entry per item the user has bought before.'''
        return [
            {
                "name": "Milk",                 # display name
                "category": "Dairy",            # one of the 8 app categories
                "unit": "carton",               # optional
                "state": "BUY_MORE",            # BUY_MORE | KEEP_SAME | BUY_LESS | DO_NOT_BUY_YET
                "recommended_qty": 2,           # 0 for DO_NOT_BUY_YET
                "reason": "You finished 3 cartons last week",  # AC 7.3.1 text
            },
            ...
        ]

Entries may be dicts or `PurchaseRecommendation` instances. If Epic 7 also
wants its own endpoint (e.g. GET /v1/purchase-recommendations) it should
call `get_purchase_recommendations()` too, so both epics always agree.
"""
from __future__ import annotations

import importlib
from typing import TYPE_CHECKING, Literal

from pydantic import BaseModel, Field, field_validator

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

    from app.models import UserProfile

# The module Epic 7 creates. Change this one string if Epic 7 ends up
# putting the function somewhere else.
PROVIDER_MODULE = "app.purchase_insights"
PROVIDER_FUNCTION = "compute_purchase_recommendations"

PurchaseState = Literal["BUY_MORE", "KEEP_SAME", "BUY_LESS", "DO_NOT_BUY_YET"]

# States that put an item under "To Buy" (AC 8.1.2) -- everything else is skipped (AC 8.1.3).
BUY_STATES: frozenset[str] = frozenset({"BUY_MORE", "KEEP_SAME", "BUY_LESS"})
SKIP_STATE = "DO_NOT_BUY_YET"


class PurchaseRecommendation(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    category: str | None = None
    unit: str | None = None
    state: PurchaseState
    recommended_qty: float = Field(default=0, ge=0)
    reason: str | None = None
    summary: str | None = None

    @field_validator("state", mode="before")
    @classmethod
    def _normalise_state(cls, v):
        # Accept "buy_more" / "Buy More" as well -- one less thing to get wrong.
        return v.strip().upper().replace(" ", "_") if isinstance(v, str) else v

    @field_validator("name")
    @classmethod
    def _strip_name(cls, v: str) -> str:
        return v.strip()


async def get_purchase_recommendations(
    db: "AsyncSession", user: "UserProfile"
) -> list[PurchaseRecommendation] | None:
    """Epic 7's recommendations for this user, or None if Epic 7 isn't there yet."""
    try:
        module = importlib.import_module(PROVIDER_MODULE)
    except ModuleNotFoundError as exc:
        # Only "the Epic 7 file doesn't exist" means "not built yet". A missing
        # import INSIDE Epic 7's file is a real bug and must surface, not be hidden.
        if exc.name == PROVIDER_MODULE:
            return None
        raise

    provider = getattr(module, PROVIDER_FUNCTION, None)
    if provider is None:
        return None

    raw = await provider(db, user)
    return [PurchaseRecommendation.model_validate(r) for r in (raw or [])]
