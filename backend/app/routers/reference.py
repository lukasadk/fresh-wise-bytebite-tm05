"""Read-only lookups against the public reference datasets.

Rebuilt 2026-08-25 from official primary sources (see core_data/DATA_AUDIT.md):
FoodKeeper from the USDA JSON, PriceCatcher re-aggregated from 5.16M raw
records with percentile trimming, Open Food Facts from the full Malaysian
bulk export (6,885 products, up from 88).

No user data is involved, so these endpoints don't require the device-id header.
"""
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import case, func, literal_column, or_, select
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

    An exact pass, then -- only if it finds nothing -- one ranked fuzzy pass:

    1. EXACT on the full canonical name (which includes the product subtitle,
       so "ham canned" and "ham fully cooked" stay distinct) or on the
       name-only base form.
    2. FUZZY, which is a substring match and an all-tokens match evaluated
       together. Substring handles plural-vs-singular ("Egg" -> "Eggs",
       "Tomato" -> "Tomatoes"). All-tokens handles the fact that FoodKeeper's
       names are catalogue-shaped, not shopping-list-shaped: "chicken breast"
       substring-matches only "stuffed raw chicken breasts" -- a stuffed
       convenience product -- while the row actually wanted, "chicken parts
       breast halves boneless", never contains that literal phrase.

    Ranking the fuzzy pass matters as much as the matching, because the client
    shows the best row it can use:

    * A row whose base name STARTS with the user's first token outranks one
      that merely contains it, so "chicken ..." beats "stuffed raw chicken ...".
      The head noun of what someone typed should be the head noun of the match.
    * Rows carrying actual storage data outrank empty ones -- 'canned chicken'
      has no durations at all and would otherwise win on brevity.
    * Then shortest name, so general entries beat long specific variants.
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

    # Any duration in EITHER family, or any tip, counts as "this row can
    # actually answer the question". dop_* is included deliberately: fresh meat,
    # poultry and fish populate only those, so scoring on the plain columns
    # alone ranks every fresh product as empty.
    has_data = or_(
        RefFoodkeeperStorage.pantry_min.isnot(None),
        RefFoodkeeperStorage.refrigerate_min.isnot(None),
        RefFoodkeeperStorage.freeze_min.isnot(None),
        RefFoodkeeperStorage.dop_pantry_min.isnot(None),
        RefFoodkeeperStorage.dop_refrigerate_min.isnot(None),
        RefFoodkeeperStorage.dop_freeze_min.isnot(None),
        RefFoodkeeperStorage.pantry_tips.isnot(None),
        RefFoodkeeperStorage.refrigerate_tips.isnot(None),
        RefFoodkeeperStorage.freeze_tips.isnot(None),
    )

    tokens = [t for t in key.split() if len(t) > 2]
    # The HEAD NOUN is the last word, not the first: English noun phrases are
    # head-final, so "fresh milk" is a milk and "low fat milk" is a milk. Taking
    # the first token instead sent "fresh milk" to `fresh pasta`, because
    # "fresh" also begins `fresh lobster tails`, `fresh clams ...` and, being
    # the shortest of them, `fresh pasta` won the length tiebreak. The food the
    # user means is almost never the adjective they opened with.
    head = tokens[-1] if tokens else key

    def matches(token: str):
        return or_(
            RefFoodkeeperStorage.canonical_name_base.ilike(f"%{token}%"),
            RefFoodkeeperStorage.canonical_food_name.ilike(f"%{token}%"),
            RefFoodkeeperStorage.keywords.ilike(f"%{token}%"),
        )

    # One ranked query rather than a cascade of passes. Run in sequence, a
    # whole-phrase pass would return "stuffed raw chicken breasts" for "chicken
    # breast" and short-circuit, so the pass that finds the right row would
    # never execute -- and an all-tokens pass would return nothing at all for
    # "fish fillet", because no FoodKeeper row says "fillet".
    #
    # So: match broadly (the whole phrase, OR anything sharing the head noun),
    # then let the ordering decide. Ranking, in order:
    #   1. how many of the user's words the row matched -- "chicken parts breast
    #      halves" matches both words of "chicken breast", "chicken whole" one
    #   2. whether the row's name STARTS with the head noun, so "chicken ..."
    #      beats "stuffed raw chicken ..."; the head noun of what someone typed
    #      should be the head noun of the match
    #   3. whether the row carries any storage data at all -- "canned chicken"
    #      has no durations and would otherwise win on brevity
    #   4. shortest name, so general entries beat long specific variants
    pattern = f"%{key}%"
    tokens_matched = sum(
        (case((matches(t), 1), else_=0) for t in tokens),
        literal_column("0"),
    )

    # WHERE casts wide, ORDER BY decides: match the whole phrase OR any single
    # word the user typed, then let the ranking sort it out. Searching only the
    # head noun made "fish fillet" return nothing at all, since no FoodKeeper row
    # says "fillet" -- recall belongs here, precision belongs in the ordering.
    fuzzy = await db.execute(
        select(RefFoodkeeperStorage)
        .where(or_(matches(key), *[matches(t) for t in tokens]) if tokens else matches(key))
        .order_by(
            tokens_matched.desc(),
            # Named by the head noun -- "milk plain or flavored" for "fresh milk".
            case((RefFoodkeeperStorage.canonical_name_base.ilike(f"{head}%"), 0), else_=1),
            # Failing that, named by ANY word the user typed. This is what
            # separates "chicken parts breast halves" from "stuffed raw chicken
            # breasts": both contain both words, but only one is *about* a word
            # the user typed. It also covers head-initial phrasing, which the
            # head-final rule above gets wrong.
            case((or_(*[RefFoodkeeperStorage.canonical_name_base.ilike(f"{t}%") for t in tokens]), 0), else_=1)
            if tokens
            else case((has_data, 0), else_=1),
            case((has_data, 0), else_=1),
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
