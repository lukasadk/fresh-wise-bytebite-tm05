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