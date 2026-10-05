"""Pydantic request/response models.

Kept separate from app/models.py (the SQLAlchemy ORM layer) on purpose --
these are the API's public contract and shouldn't accidentally change
just because a DB column changes, or leak internal-only fields.
"""
from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.models import RELIGION_LINKED_DIET_TAGS

# --- Users -------------------------------------------------------------

RiskLevel = Literal["low", "med", "high"]


class UserProfileOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    user_id: UUID
    household_size: int
    location: str | None
    risk_score: RiskLevel
    created_at: datetime
    # Included so the client can confirm whether a token is already
    # registered without needing a separate endpoint -- never surfaced in the
    # UI itself.
    push_token: str | None = None


class UserProfileCreate(BaseModel):
    """Body for the device-identity handshake.

    `user_id` is the UUID the client generated itself on first launch
    (see database-schema-no-pii.md). The server never invents one on a
    user's behalf except as a DB-level safety net.
    """

    user_id: UUID
    household_size: int = Field(gt=0, default=1)
    location: str | None = Field(default=None, max_length=50)


class UserProfileUpdate(BaseModel):
    household_size: int | None = Field(gt=0, default=None)
    location: str | None = Field(default=None, max_length=50)
    # Set by the client once it has permission + a real Expo push token.
    # Passing an empty string clears it (e.g. user disables notifications) --
    # None (the default, field omitted) leaves the stored value untouched.
    push_token: str | None = Field(default=None, max_length=200)


# --- Pantry / food_item --------------------------------------------------

FoodItemStatus = Literal["active", "consumed", "wasted", "partially_used"]
FoodItemSource = Literal["manual", "barcode", "photo"]
# Where the household keeps the item (their choice), NOT the FoodKeeper
# recommendation -- that is reference data, served from /v1/reference/foodkeeper.
FoodItemStorage = Literal["refrigerated", "frozen", "room_temp"]

# Statuses a client may set directly via PATCH /v1/pantry/{id}.
# 'consumed' and 'wasted' are deliberately EXCLUDED: reaching either of those
# also has to write a consumption_waste_log row (and decrement quantity, and
# capture waste_reason), which only POST /v1/logs does. Allowing them here
# would let an item be marked wasted with no log entry, so the waste would
# never appear in the Epic 2 dashboard -- silently under-reporting.
FoodItemPatchableStatus = Literal["active", "partially_used"]


class FoodItemCreate(BaseModel):
    name: str = Field(max_length=100)
    category: str | None = Field(default=None, max_length=50)
    canonical_food_name: str | None = None
    barcode: str | None = None
    quantity: float = Field(default=1, gt=0)
    unit: str | None = Field(default=None, max_length=20)
    purchase_date: date | None = None
    expiry_date: date | None = None
    source: FoodItemSource = "manual"
    storage: FoodItemStorage | None = None


class FoodItemUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=100)
    category: str | None = Field(default=None, max_length=50)
    # Set by the "not this food?" picker on the storage-guidance card, where the
    # user chooses which FoodKeeper product their item actually is. This is the
    # ONE case where the key is a real decision rather than a normalised copy of
    # `name` -- see _canonical()/_user_chose_key() in routers/pantry.py.
    canonical_food_name: str | None = Field(default=None, max_length=200)
    quantity: float | None = Field(default=None, gt=0)
    unit: str | None = Field(default=None, max_length=20)
    expiry_date: date | None = None
    status: FoodItemPatchableStatus | None = None
    storage: FoodItemStorage | None = None


class FoodItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    item_id: UUID
    user_id: UUID
    name: str
    category: str | None
    canonical_food_name: str | None
    barcode: str | None
    quantity: float
    unit: str | None
    purchase_date: date
    expiry_date: date | None
    source: FoodItemSource
    status: FoodItemStatus
    storage: FoodItemStorage | None
    created_at: datetime
    # Derived, not stored -- the pantry router fills this in from expiry_date.
    days_to_expiry: int | None = None
    # Epic 8 (AC 8.3.1-8.3.4): only set on the POST /v1/pantry response.
    # True when saving this item fully ticked off a "To Buy" row on the
    # shopping list; the client adds these up for the "N items ticked off" toast.
    shopping_ticked: bool = False
    # Epic 9 (AC 9.1.1-9.1.3): estimated RM per one of this item's units, from
    # the PriceCatcher snapshot -- never what the user paid. None = no estimate.
    est_unit_value_rm: float | None = None
    # Derived: est_unit_value_rm x current quantity, rounded to sen.
    est_value_rm: float | None = None
    est_price_month: date | None = None


# --- Consumption / waste log ---------------------------------------------

LogStatus = Literal["consumed", "wasted"]
WasteReason = Literal[
    "expired",
    "spoiled",
    "cooked_too_much",
    "forgot_about_it",
    "didnt_like_taste",
    "changed_plans",
    "bought_too_much",
    "other",
]


class ConsumptionWasteLogCreate(BaseModel):
    item_id: UUID
    status: LogStatus
    quantity: float = Field(gt=0)
    waste_reason: WasteReason | None = None
    notes: str | None = Field(default=None, max_length=100)

    @model_validator(mode="after")
    def _reason_only_with_wasted(self):
        # A plain @field_validator on `waste_reason` would NOT run here when
        # the field is omitted from the request body (Pydantic v2 skips
        # validators for fields that fall back to their default, unless
        # validate_default=True) -- a model-level validator always runs
        # regardless, which is what this cross-field check needs.
        if self.status == "wasted" and self.waste_reason is None:
            raise ValueError("waste_reason is required when status is 'wasted'")
        if self.status == "consumed" and self.waste_reason is not None:
            raise ValueError("waste_reason must be omitted when status is 'consumed'")
        return self


class ConsumptionWasteLogOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    log_id: UUID
    item_id: UUID
    status: LogStatus
    quantity: float
    waste_reason: WasteReason | None
    notes: str | None
    logged_at: datetime
    # Denormalised from FoodItem for the Activity history list -- the log
    # itself only stores item_id, and showing a raw UUID there would be
    # useless. Populated by list_logs()'s join; None if ever constructed
    # without it (e.g. record_outcome's own response, which returns the log
    # ORM object directly and doesn't set these -- fine, since that response
    # is only ever used right after a save, when the screen already has the
    # item's name in hand from its own separate fetch).
    item_name: str | None = None
    item_unit: str | None = None


# --- Purchase recommendation / over-purchase insight -----------------------

PurchaseState = Literal["BUY_MORE", "KEEP_SAME", "BUY_LESS", "DO_NOT_BUY_YET"]
PurchaseWasteRisk = Literal["unknown", "low", "medium", "high"]
PurchaseDataQuality = Literal["no_outcomes", "limited", "sufficient"]
PurchaseHabitStatus = Literal["possible_over_purchase", "on_track", "still_learning"]


class PurchaseRecommendationRequest(BaseModel):
    """Request one recommendation from the authenticated household history."""

    food_name: str = Field(min_length=1, max_length=100)

    @field_validator("food_name")
    @classmethod
    def _strip_food_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("food_name must not be blank")
        return value


class PurchaseRecommendationOut(BaseModel):
    """Auditable recommendation built only from recorded household events.

    The first six fields retain the original Epic 7/Epic 8 contract.  The
    remaining fields expose the quantities used by the rule baseline so the
    app can explain a recommendation without asking an LLM to invent facts.
    """

    name: str
    food_name: str
    category: str
    unit: str | None
    state: PurchaseState
    recommendation: PurchaseState
    recommended_qty: float
    reason: str
    usual_purchase: float
    predicted_demand: float
    current_inventory: float
    average_consumption: float | None
    average_wasted: float
    average_weekly_consumption: float
    average_waste_rate: float | None
    purchase_waste_rate: float | None
    waste_risk: PurchaseWasteRisk
    over_purchase_detected: bool
    habit_status: PurchaseHabitStatus
    status_label: str
    recommendation_available: bool
    has_outcomes: bool
    purchase_count: int = Field(ge=0)
    purchase_count_8w: int | None = Field(default=None, ge=0)
    completed_cycles: int = Field(ge=0)
    average_purchase_interval_days: float | None
    days_until_next_shop: float
    days_since_last_purchase: int | None
    is_cold_start: bool
    evidence_window_days: Literal[56]
    method: Literal["rule_baseline_v1", "rule_baseline_v2_early_estimate"]
    data_quality: PurchaseDataQuality
    warnings: list[str] = Field(default_factory=list)


# --- Dashboard -------------------------------------------------------------


class WeeklyWasteRow(BaseModel):
    week_start: datetime
    waste_reason: WasteReason | None
    waste_events: int
    total_quantity_wasted: float


class DashboardSummary(BaseModel):
    range_days: int
    total_wasted_events: int
    total_wasted_quantity: float
    total_consumed_events: int
    total_consumed_quantity: float
    waste_rate: float | None  # wasted_quantity / (wasted+consumed quantity), None if no events
    top_waste_reasons: list[dict]  # [{"waste_reason": "...", "count": n, "quantity": n}]


class WastePatternBucket(BaseModel):
    """One bar in the Patterns tab -- either a food category (free text, e.g.
    'Vegetables') or a waste_reason value. Top-5 by count + a rolled-up
    'Other' bucket for everything past the 5th, in that order."""

    label: str
    count: int


class WastePatternItem(BaseModel):
    """The single food item wasted more often than any other, matched
    case-insensitively ("Milk" and "milk" are the same item). Only ever
    populated when the repeat count is >= 2 -- a single occurrence isn't a
    pattern worth flagging."""

    name: str
    times_wasted: int


class WastePatternsOut(BaseModel):
    """GET /v1/dashboard/waste-patterns. Computed over the household's ENTIRE
    waste history (no time window) -- "based on the user's entries so far".

    Categories and reasons use the stable Top-5-plus-Other contract. Real
    rows that already display as "Other" are folded together with overflow so
    clients never receive duplicate "Other" rows.
    """

    total_waste_events: int
    top_waste_categories: list[WastePatternBucket]
    top_waste_reasons: list[WastePatternBucket]
    # Kept for compatibility with newer clients that were built while
    # waste_reason "other" was separated from the ranked list. The current
    # stable contract folds it into top_waste_reasons, so this remains zero.
    other_reason_count: int
    most_wasted_item: WastePatternItem | None


# --- Diet preferences -------------------------------------------------------


class DietPreferenceCreate(BaseModel):
    tag: str = Field(min_length=1, max_length=100)
    target_value: float | None = None

    @field_validator("tag")
    @classmethod
    def _reject_religion_linked(cls, v: str) -> str:
        if v.strip().lower() in RELIGION_LINKED_DIET_TAGS:
            raise ValueError(
                f"'{v}' is a religion-linked tag and cannot be saved as a user preference "
                "(see database-schema-no-pii.md). Apply it as an ad hoc recipe.diet_tags "
                "filter per search instead."
            )
        return v.strip().lower()


class DietPreferenceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    preference_id: UUID
    user_id: UUID
    tag: str
    target_value: float | None
    created_at: datetime


# --- Recipes -----------------------------------------------------------------


class RecipeRecommendationOut(BaseModel):
    recipe_id: str
    recipe_name: str | None
    ingredient_tokens: list[str] | None
    tags: list[str] | None
    servings: int | None
    serving_size: str | None
    matched_ingredients: list[str]
    missing_ingredients: list[str]
    expiring_ingredients_matched: list[str]
    coverage_score: float
    expiry_weight_score: float
    total_score: float


class RecipeDetailOut(BaseModel):
    recipe_id: str
    recipe_name: str | None
    ingredients: list | None
    ingredients_raw: str | None
    steps: str | None
    servings: int | None
    serving_size: str | None


# --- Reference lookups --------------------------------------------------------


class FoodkeeperStorageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    foodkeeper_id: int
    canonical_food_name: str
    category_name: str | None
    name: str | None
    name_subtitle: str | None
    # FoodKeeper splits every duration into two families and a row usually
    # populates only ONE of them:
    #   * plain `pantry_/refrigerate_/freeze_`  -- measured from the date on
    #     the package (shelf-stable and processed goods)
    #   * `dop_*` ("date of purchase")          -- measured from when you
    #     bought it, which is how FRESH food is dated
    # Fresh meat, poultry and fish are dop-only: "beef steaks" and "chicken
    # whole" have NULL in every plain column and carry their real 3-5 days /
    # 4-12 months in dop_refrigerate_*/dop_freeze_*. Serving only the plain
    # columns therefore returned an all-null payload for exactly the foods
    # where storage advice matters most, and the client fell back to whatever
    # loosely-matched processed product did have plain columns. Coverage across
    # the 661 rows: dop_refrigerate 36%, dop_pantry 30%, dop_freeze 30%, vs
    # refrigerate 20%, freeze 22%, pantry 15%. Both families are served; the
    # client merges them per method.
    pantry_min: float | None
    pantry_max: float | None
    pantry_metric: str | None
    pantry_tips: str | None
    dop_pantry_min: float | None
    dop_pantry_max: float | None
    dop_pantry_metric: str | None
    pantry_after_opening_min: float | None
    pantry_after_opening_max: float | None
    pantry_after_opening_metric: str | None
    refrigerate_min: float | None
    refrigerate_max: float | None
    refrigerate_metric: str | None
    refrigerate_tips: str | None
    dop_refrigerate_min: float | None
    dop_refrigerate_max: float | None
    dop_refrigerate_metric: str | None
    refrigerate_after_opening_min: float | None
    refrigerate_after_opening_max: float | None
    refrigerate_after_opening_metric: str | None
    refrigerate_after_thawing_min: float | None
    refrigerate_after_thawing_max: float | None
    refrigerate_after_thawing_metric: str | None
    freeze_min: float | None
    freeze_max: float | None
    freeze_metric: str | None
    freeze_tips: str | None
    dop_freeze_min: float | None
    dop_freeze_max: float | None
    dop_freeze_metric: str | None
    source_url: str | None
    license: str | None


class PriceReferenceOut(BaseModel):
    """Malaysia market price reference, percentile-trimmed.

    Exposes p05/median/p95 and NOT the raw min/max. The raw extremes are
    contaminated by data-entry errors in the official feed (chicken at
    RM0.12/kg, chilli at RM1000/kg); re-aggregating from the raw records
    showed 287 of 1,036 item-months had a corrupted minimum. p05..p95 gives
    an honest "cheap to expensive" band that a single bad record can't move.
    `raw_min_rm`/`raw_max_rm` stay in the DB for audit but are not served.
    """

    model_config = ConfigDict(from_attributes=True)

    item_code: str
    month: date
    item: str | None
    unit: str | None
    canonical_food_name: str
    price_p05_rm: float | None
    median_price_rm: float | None
    price_p95_rm: float | None
    observations: int | None
    price_quality: str
    aggregation_method: str | None
    source_url: str | None
    license: str | None


class PriceReferenceStateOut(BaseModel):
    """Per-state price -- lets a household see prices for its own region
    rather than a national average."""

    model_config = ConfigDict(from_attributes=True)

    item_code: str
    month: date
    state: str
    canonical_food_name: str
    item: str | None
    unit: str | None
    price_p05_rm: float | None
    median_price_rm: float | None
    price_p95_rm: float | None
    observations: int | None
    license: str | None


class OpenFoodFactsProductOut(BaseModel):
    """Open Food Facts product.

    `nutrition_source` tells the client where the nutrient figures came from:
    'packaging_label' (the product's own label), 'off_estimate' (Open Food
    Facts' estimate) or 'none'. Only ~6% of Malaysian products carry any
    nutrients at all -- and NOVA (6%) and Nutri-Score (4%) are just as sparse --
    so nulls are the common case and must be shown as "unknown", never zero.
    """

    model_config = ConfigDict(from_attributes=True)

    barcode: str
    product_name: str | None
    product_name_ms: str | None
    canonical_food_name: str | None
    brands: str | None
    categories: str | None
    allergens_tags: str | None
    labels_tags: str | None
    ingredients_text: str | None
    quantity: str | None
    serving_size: str | None
    energy_kcal_100g: float | None
    fat_100g: float | None
    saturated_fat_100g: float | None
    carbohydrates_100g: float | None
    sugars_100g: float | None
    fiber_100g: float | None
    proteins_100g: float | None
    salt_100g: float | None
    sodium_100g: float | None
    nutrition_source: str
    nutriscore_grade: str | None
    nova_group: str | None
    nova_group_num: int | None
    image_url: str | None
    # ODbL requires attribution wherever this data is displayed.
    license: str | None


# --- Smart Shopping List (Epic 8) ------------------------------------------
# The recommendation shape itself (PurchaseRecommendation) lives in
# app/purchase_recommendations.py -- that file is the Epic 7 <-> Epic 8 contract.

ShoppingItemSource = Literal["suggested", "manual"]
ShoppingItemStatus = Literal["to_buy", "bought"]


class ShoppingItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    list_item_id: UUID
    name: str
    category: str | None
    unit: str | None
    quantity: float
    remaining_qty: float
    source: ShoppingItemSource
    rec_state: str | None
    have_at_home_qty: float | None
    status: ShoppingItemStatus
    bought_at: datetime | None
    created_at: datetime


class SkippedItemOut(BaseModel):
    """A DO_NOT_BUY_YET recommendation -- shown in "Skip This Time" (AC 8.1.3)."""

    name: str
    category: str | None
    reason: str | None


class ShoppingListOut(BaseModel):
    to_buy: list[ShoppingItemOut]
    bought: list[ShoppingItemOut]
    skipped: list[SkippedItemOut]
    # False until Epic 7's recommendation code exists -- lets the app tell
    # "no suggestions yet" apart from "Epic 7 says buy nothing".
    recommendations_available: bool


class ShoppingItemCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    category: str | None = Field(default=None, max_length=50)
    unit: str | None = Field(default=None, max_length=20)
    quantity: float = Field(default=1, gt=0)
    # False = run the duplicate-stock check first (AC 8.2.1).
    # True  = the user tapped "Add anyway" on the warning card (AC 8.2.2).
    force: bool = False

    @field_validator("name")
    @classmethod
    def _strip_name(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Enter an item name")
        return v


class NameSuggestionOut(BaseModel):
    name: str
    category: str | None


class ShoppingItemUpdate(BaseModel):
    status: ShoppingItemStatus | None = None
    quantity: float | None = Field(default=None, gt=0, le=99)

    @model_validator(mode="after")
    def _at_least_one_change(self):
        if self.status is None and self.quantity is None:
            raise ValueError("Provide status or quantity")
        return self


class DuplicateStockOut(BaseModel):
    """Body of the 409 returned by POST /v1/shopping-list/items (AC 8.2.1)."""

    code: Literal["duplicate_stock"] = "duplicate_stock"
    pantry_item_id: UUID  # the earliest-expiring match -- "View in Pantry" opens this one (AC 8.2.3)
    pantry_name: str
    qty_at_home: float
    unit: str | None
    earliest_expiry: date | None


# --- Epic 9: Estimated food value ------------------------------------------


class FoodValueMetaOut(BaseModel):
    """Where every RM estimate comes from (AC 9.1.4)."""

    snapshot_month: date
    label: str              # "Based on Malaysian market prices, August 2026 (PriceCatcher)"
    item_count: int
    source: str
    source_url: str
    license: str


class FoodValueCategory(BaseModel):
    label: str
    value_rm: float
    is_other: bool = False   # the grouped "Other" bar (AC 9.4.1), drawn in Grey


class FoodValueTopItem(BaseModel):
    name: str
    category: str | None
    unit: str | None
    value_rm: float
    quantity: float


class FoodValueWastedOut(BaseModel):
    """Estimated value of food wasted in one calendar month (AC 9.3.1-9.4.2)."""

    month: str                          # "2026-10"
    is_current_month: bool
    label: str
    wasted_count: int                   # wasted records this month
    valued_count: int
    unvalued_count: int                 # AC 9.3.2 "3 items could not be valued"
    coverage: float
    sufficient: bool                    # False -> show "Not enough price data" (AC 9.3.3)
    total_rm: float | None
    previous_month: str
    previous_total_rm: float | None
    # total - previous total. None when last month has no records at all, so a
    # brand-new user isn't told they wasted "RM 30 more than last month".
    change_rm: float | None
    headline: str | None                # AC 9.3.5 monthly-report headline
    by_category: list[FoodValueCategory]
    top_items: list[FoodValueTopItem]


# --- Homemade recipes ("My recipes") -----------------------------------------


def _clean_text(v: str, message: str) -> str:
    v = v.strip()
    if not v:
        raise ValueError(message)
    return v


class UserRecipeIngredient(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    # Free text on purpose: "2 tbsp", "a handful", "500 g".
    amount: str | None = Field(default=None, max_length=50)

    @field_validator("name")
    @classmethod
    def _strip_name(cls, v: str) -> str:
        return _clean_text(v, "Enter an ingredient name")

    @field_validator("amount")
    @classmethod
    def _strip_amount(cls, v: str | None) -> str | None:
        v = (v or "").strip()
        return v or None


class _UserRecipeFields(BaseModel):
    servings: int | None = Field(default=None, ge=1, le=50)
    prep_minutes: int | None = Field(default=None, ge=0, le=1440)
    cook_minutes: int | None = Field(default=None, ge=0, le=1440)
    notes: str | None = Field(default=None, max_length=500)

    @field_validator("notes")
    @classmethod
    def _strip_notes(cls, v: str | None) -> str | None:
        v = (v or "").strip()
        return v or None


def _clean_steps(steps: list[str]) -> list[str]:
    cleaned = [s.strip() for s in steps if s and s.strip()]
    if any(len(s) > 500 for s in cleaned):
        raise ValueError("Each step must be 500 characters or fewer")
    return cleaned


class UserRecipeCreate(_UserRecipeFields):
    title: str = Field(min_length=1, max_length=120)
    ingredients: list[UserRecipeIngredient] = Field(min_length=1, max_length=50)
    steps: list[str] = Field(default_factory=list, max_length=50)

    @field_validator("title")
    @classmethod
    def _strip_title(cls, v: str) -> str:
        return _clean_text(v, "Enter a recipe name")

    @field_validator("steps")
    @classmethod
    def _steps(cls, v: list[str]) -> list[str]:
        return _clean_steps(v)


class UserRecipeUpdate(_UserRecipeFields):
    """PATCH: only the fields sent are changed."""

    title: str | None = Field(default=None, min_length=1, max_length=120)
    ingredients: list[UserRecipeIngredient] | None = Field(default=None, min_length=1, max_length=50)
    steps: list[str] | None = Field(default=None, max_length=50)

    @field_validator("title")
    @classmethod
    def _strip_title(cls, v: str | None) -> str | None:
        return None if v is None else _clean_text(v, "Enter a recipe name")

    @field_validator("steps")
    @classmethod
    def _steps(cls, v: list[str] | None) -> list[str] | None:
        return None if v is None else _clean_steps(v)


class UserRecipeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    recipe_id: UUID
    title: str
    servings: int | None
    prep_minutes: int | None
    cook_minutes: int | None
    ingredients: list[UserRecipeIngredient]
    steps: list[str]
    notes: str | None
    created_at: datetime
    updated_at: datetime
