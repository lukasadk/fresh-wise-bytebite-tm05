"""Read-only lookups against the public reference datasets.

Rebuilt 2026-08-25 from official primary sources (see core_data/DATA_AUDIT.md):
FoodKeeper from the USDA JSON, PriceCatcher re-aggregated from 5.16M raw
records with percentile trimming, Open Food Facts from the full Malaysian
bulk export (6,885 products, up from 88).

No user data is involved, so these endpoints don't require the device-id header.
"""
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.models import (
    RefFoodkeeperStorage,
    RefOpenFoodFactsProduct,
    RefPriceReference,
    RefPriceReferenceState,
)
from app.schemas import (
    FoodkeeperStorageOut,
    OpenFoodFactsProductOut,
    PriceReferenceOut,
    PriceReferenceStateOut,
)

router = APIRouter(prefix="/v1/reference", tags=["reference"])


@router.get("/foodkeeper", response_model=list[FoodkeeperStorageOut])
async def lookup_foodkeeper(
    canonical_food_name: str = Query(min_length=1),
    db: AsyncSession = Depends(get_db),
):
    """Storage guidance for a food.

    Matches the full canonical name (which includes the product subtitle, so
    "ham canned" and "ham fully cooked" are distinct) and falls back to the
    name-only form, which is broader but may return several variants.
    """
    key = canonical_food_name.lower().strip()
    if not key:
        return []

    exact = (
        await db.execute(
            select(RefFoodkeeperStorage)
            .where(
                or_(
                    RefFoodkeeperStorage.canonical_food_name == key,
                    RefFoodkeeperStorage.canonical_name_base == key,
                )
            )
            .order_by(RefFoodkeeperStorage.foodkeeper_id)
        )
    ).scalars().all()
    if exact:
        return list(exact)

    # Nothing exact. Users type free text, and FoodKeeper's names are fixed and
    # often plural -- "Egg", "Tomato" and "Banana" all miss while "Eggs",
    # "Tomatoes" and "Bananas" hit, which reads as the feature being broken.
    # Fall back to a substring match on the name and on `keywords` (populated on
    # 660 of 661 rows and built for exactly this). Ordered so shorter, more
    # general names win over long specific variants, and capped because a short
    # query like "oil" legitimately matches dozens.
    pattern = f"%{key}%"
    fuzzy = await db.execute(
        select(RefFoodkeeperStorage)
        .where(
            or_(
                RefFoodkeeperStorage.canonical_name_base.ilike(pattern),
                RefFoodkeeperStorage.canonical_food_name.ilike(pattern),
                RefFoodkeeperStorage.keywords.ilike(pattern),
            )
        )
        .order_by(
            func.length(RefFoodkeeperStorage.canonical_name_base),
            RefFoodkeeperStorage.foodkeeper_id,
        )
        .limit(10)
    )
    return list(fuzzy.scalars().all())


@router.get("/price", response_model=list[PriceReferenceOut])
async def lookup_price(
    canonical_food_name: str = Query(min_length=1),
    month: date | None = Query(default=None, description="First-of-month, e.g. 2026-08-01"),
    db: AsyncSession = Depends(get_db),
):
    """National price reference. Returns the p05..p95 band, never raw min/max."""
    query = select(RefPriceReference).where(
        RefPriceReference.canonical_food_name == canonical_food_name.lower().strip()
    )
    if month is not None:
        query = query.where(RefPriceReference.month == month.replace(day=1))
    query = query.order_by(RefPriceReference.month.desc())
    result = await db.execute(query)
    return list(result.scalars().all())


@router.get("/price/by-state", response_model=list[PriceReferenceStateOut])
async def lookup_price_by_state(
    canonical_food_name: str = Query(min_length=1),
    state: str | None = Query(default=None, description="e.g. 'Selangor'; omit for all states"),
    month: date | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
):
    """Price for a specific Malaysian state.

    This is what makes `user_profile.location` useful -- a household in Sabah
    sees Sabah prices rather than a national average. Item/state/month
    combinations with fewer than 20 observations are not published at all,
    rather than being served as a misleadingly precise figure.
    """
    query = select(RefPriceReferenceState).where(
        RefPriceReferenceState.canonical_food_name == canonical_food_name.lower().strip()
    )
    if state:
        query = query.where(RefPriceReferenceState.state == state.strip())
    if month is not None:
        query = query.where(RefPriceReferenceState.month == month.replace(day=1))
    query = query.order_by(
        RefPriceReferenceState.month.desc(), RefPriceReferenceState.state
    )
    result = await db.execute(query)
    return list(result.scalars().all())


@router.get("/product/{barcode}", response_model=OpenFoodFactsProductOut)
async def lookup_product(barcode: str, db: AsyncSession = Depends(get_db)):
    """Barcode lookup.

    Product identity is well covered (89% have a name). Nutrients are NOT --
    only ~6% of Malaysian products carry any (NOVA and Nutri-Score are equally
    sparse). A null nutrient means UNKNOWN and must never be rendered as 0;
    check `nutrition_source` to see whether a figure came from the product
    label or from Open Food Facts' own estimate.
    """
    result = await db.execute(
        select(RefOpenFoodFactsProduct).where(RefOpenFoodFactsProduct.barcode == barcode.strip())
    )
    product = result.scalar_one_or_none()
    if product is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No product for this barcode")
    return product


@router.get("/product", response_model=list[OpenFoodFactsProductOut])
async def search_products(
    q: str = Query(min_length=2, description="Substring of product name or brand"),
    max_nova_group: int | None = Query(
        default=None, ge=1, le=4,
        description="Filter to NOVA group <= this (1=unprocessed .. 4=ultra-processed). "
                    "WARNING: only ~6% of Malaysian products have a NOVA group, so this "
                    "filter excludes the other ~94% rather than ranking them.",
    ),
    limit: int = Query(default=25, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    """Search products by name/brand, optionally excluding ultra-processed items.

    Name/brand search is the reliable path here (89% of products are named).
    `max_nova_group` is offered because processing level is at least a
    *categorical* judgement rather than a number needing a full nutrient panel
    -- but its coverage is only ~6%, so it filters down to a small subset
    rather than ranking the catalogue. No macro filter ("high protein") is
    offered at all: at 6% nutrient coverage it would silently hide most of the
    catalogue. See DATA_AUDIT.md.
    """
    pattern = f"%{q.strip().lower()}%"
    query = select(RefOpenFoodFactsProduct).where(
        or_(
            RefOpenFoodFactsProduct.product_name.ilike(pattern),
            RefOpenFoodFactsProduct.brands.ilike(pattern),
        )
    )
    if max_nova_group is not None:
        # nova_group is stored as text; compare numerically and skip blanks
        query = query.where(
            RefOpenFoodFactsProduct.nova_group_num.isnot(None),
            RefOpenFoodFactsProduct.nova_group_num <= max_nova_group,
        )
    query = query.limit(limit)
    result = await db.execute(query)
    return list(result.scalars().all())
