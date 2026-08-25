"""AI Expiry-Aware Recipe Recommendation & Diet Filtering epic.

Implements the matching approach documented in
freshwise-docs/core_data/core_data/DATA_RELATIONSHIPS.md section 3.3:

    recipe_score = ingredient_coverage + expiring_ingredient_weight + available_quantity_weight

against `ref_recipe_index` (built from the free Food.com dataset, per
the "fastest path to a working demo" recommendation in
epic-references-recipe-recommendation-diet-filtering.md). Swapping in
Spoonacular/Edamam later only changes where candidate recipes come from,
not this router's request/response shape.

Matching approach and its remaining limits
------------------------------------------
`canonical_food_name` on a pantry item and `ingredient_tokens` on a recipe
are both free-ish text ("chicken breast" vs "boneless skinless chicken
breast, cubed") -- see CORE_README.md: "canonical_food_name 是初步标准化名称，
不是完美的语义匹配."

Two passes: a GIN-indexed exact-overlap filter in SQL to build a ranked
candidate pool cheaply over 488K rows, then word-set matching in Python
over just that pool to catch near-misses (see `_tokens_match`).

KNOWN LIMIT, not yet solved: word-set containment can't tell a modifier
from a compound noun. "unsalted butter" IS butter, but "butter sauce" and
"butter phyllo" are not -- all three contain the word, so all three match.
Separating those needs real semantics, so recipes may still list an
ingredient the household doesn't literally have. A curated synonym /
ingredient-hierarchy table is the documented next step; blunt string
tricks would trade this error for worse ones.
"""
import re
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.deps import get_current_user
from app.models import FoodItem, RefRecipeDetail, RefRecipeIndex, UserProfile
from app.schemas import RecipeDetailOut, RecipeRecommendationOut

router = APIRouter(prefix="/v1/recipes", tags=["recipes"])

CANDIDATE_POOL_SIZE = 300  # rows pulled from the DB before Python-side scoring/refinement


_WORD_RE = re.compile(r"[a-z0-9]+")

# Words that mark a product as an imitation of the ingredient it names:
# "butter-flavored cooking spray" is emphatically not butter, and crediting a
# household's butter against it would surface a recipe they can't actually make.
# Only blocks when the pantry item itself isn't described the same way.
_IMITATION_MARKERS = frozenset({"flavored", "flavoured", "substitute", "imitation", "artificial"})


def _words(s: str) -> frozenset[str]:
    """Word set with light plural folding ('onions' and 'onion' are the same
    ingredient; 'gas'/'ga' style over-stemming is avoided by only folding a
    trailing 's' on words longer than three characters)."""
    out = set()
    for w in _WORD_RE.findall((s or "").lower()):
        if len(w) > 3 and w.endswith("s") and not w.endswith("ss"):
            w = w[:-1]
        out.add(w)
    return frozenset(out)


def _tokens_match(pantry_name: str, token: str) -> bool:
    """Does a pantry item satisfy a recipe's ingredient token?

    Matches on WORD sets, not raw substrings. A plain substring test looks
    reasonable and is badly wrong here: "butter" is a substring of
    "buttermilk", "buttery crackers" and "buttermilk biscuits", so a household
    with butter would be credited with all three -- inflating both the coverage
    score and the expiring-ingredient weight, and surfacing recipes it cannot
    actually make. ("Moody Pikelets" scored a perfect 2/2 on butter alone.)

    One word set must contain the other, so:
        "butter"         vs "unsalted butter"    -> match   (butter is present)
        "butter"         vs "buttermilk"         -> NO match (different word)
        "chicken breast" vs "boneless chicken breast" -> match
    """
    p, t = _words(pantry_name), _words(token)
    if not p or not t:
        return False
    # "butter" must not satisfy "butter-flavored shortening".
    if (t & _IMITATION_MARKERS) and not (p & _IMITATION_MARKERS):
        return False
    return p <= t or t <= p


@router.get("/recommendations", response_model=list[RecipeRecommendationOut])
async def recommend_recipes(
    diet_tags: str | None = Query(default=None, description="Comma-separated, e.g. 'vegetarian,high-protein'"),
    limit: int = Query(default=20, ge=1, le=100),
    user: UserProfile = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    pantry_result = await db.execute(
        select(FoodItem).where(
            FoodItem.user_id == user.user_id,
            FoodItem.status.in_(["active", "partially_used"]),
            FoodItem.canonical_food_name.isnot(None),
        )
    )
    pantry_items = list(pantry_result.scalars().all())
    if not pantry_items:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="No pantry items with a canonical_food_name yet -- nothing to match recipes against.",
        )

    pantry_names = sorted({i.canonical_food_name.lower().strip() for i in pantry_items})
    today = date.today()
    expiring_names = {
        i.canonical_food_name.lower().strip()
        for i in pantry_items
        if i.expiry_date is not None and (i.expiry_date - today).days <= 3
    }

    # Cheap, indexed candidate filter: exact overlap between pantry names and
    # ingredient_tokens (the GIN index on ingredient_tokens makes this fast even
    # over 488K rows). Widened with a diet_tags overlap filter when given.
    #
    # The ORDER BY matters and is not cosmetic. `LIMIT` without it returns an
    # ARBITRARY slice of the matches -- whichever rows the index scan reached
    # first -- so a recipe using five pantry items could be dropped while one
    # using a single item survived, and the same pantry could yield different
    # recommendations on each call. Ranking by overlap size first (then by
    # fewest total ingredients, i.e. fewest extra things to buy) makes the
    # truncation keep the candidates actually worth scoring, and makes results
    # reproducible.
    sql = """
        SELECT recipe_id, recipe_name, ingredient_tokens, tags, servings, serving_size,
               cardinality(ARRAY(SELECT unnest(ingredient_tokens)
                                 INTERSECT
                                 SELECT unnest(CAST(:pantry_names AS text[])))) AS overlap
        FROM ref_recipe_index
        WHERE ingredient_tokens && CAST(:pantry_names AS text[])
    """
    params: dict = {"pantry_names": pantry_names}
    if diet_tags:
        requested_tags = [t.strip().lower() for t in diet_tags.split(",") if t.strip()]
        sql += " AND tags && CAST(:diet_tags AS text[])"
        params["diet_tags"] = requested_tags
    sql += """
        ORDER BY overlap DESC, cardinality(ingredient_tokens) ASC, recipe_id
        LIMIT :pool_size
    """
    params["pool_size"] = CANDIDATE_POOL_SIZE

    candidates = (await db.execute(text(sql), params)).all()

    scored: list[RecipeRecommendationOut] = []
    for row in candidates:
        # Dedupe first: a few Food.com recipes list the same ingredient twice,
        # which would otherwise inflate the denominator and understate coverage.
        tokens = sorted(set(row.ingredient_tokens or []))
        matched = sorted({t for t in tokens for p in pantry_names if _tokens_match(p, t)})
        missing = sorted(set(tokens) - set(matched))
        expiring_matched = sorted({t for t in matched if any(_tokens_match(e, t) for e in expiring_names)})

        coverage_score = len(matched) / len(tokens) if tokens else 0.0
        expiry_weight_score = len(expiring_matched) * 0.5  # near-expiry ingredients count extra
        # "available quantity weight": approximated as one point per matched
        # ingredient that's actually in stock right now (all of `matched` are,
        # by construction) -- a real quantity-sufficiency check needs
        # unit-aware comparison between pantry quantity/unit and recipe
        # quantities, which the Food.com dataset doesn't expose structurally
        # (only free-text ingredient lines) -- left as future work per
        # CORE_README.md's own caveat about canonical_food_name being a
        # preliminary, not perfect, mapping.
        available_qty_weight = len(matched) * 0.1

        scored.append(
            RecipeRecommendationOut(
                recipe_id=row.recipe_id,
                recipe_name=row.recipe_name,
                ingredient_tokens=tokens,
                tags=row.tags,
                servings=row.servings,
                serving_size=row.serving_size,
                matched_ingredients=matched,
                missing_ingredients=missing,
                expiring_ingredients_matched=expiring_matched,
                coverage_score=round(coverage_score, 4),
                expiry_weight_score=round(expiry_weight_score, 4),
                total_score=round(coverage_score + expiry_weight_score + available_qty_weight, 4),
            )
        )

    scored.sort(key=lambda r: r.total_score, reverse=True)
    return scored[:limit]


@router.get("/{recipe_id}", response_model=RecipeDetailOut)
async def get_recipe_detail(recipe_id: str, db: AsyncSession = Depends(get_db)):
    index_result = await db.execute(select(RefRecipeIndex).where(RefRecipeIndex.recipe_id == recipe_id))
    index_row = index_result.scalar_one_or_none()
    if index_row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Recipe not found")

    detail_result = await db.execute(select(RefRecipeDetail).where(RefRecipeDetail.recipe_id == recipe_id))
    detail_row = detail_result.scalar_one_or_none()

    return RecipeDetailOut(
        recipe_id=index_row.recipe_id,
        recipe_name=index_row.recipe_name,
        ingredients=detail_row.ingredients if detail_row else None,
        ingredients_raw=detail_row.ingredients_raw if detail_row else None,
        steps=detail_row.steps if detail_row else None,
        servings=index_row.servings,
        serving_size=index_row.serving_size,
    )
