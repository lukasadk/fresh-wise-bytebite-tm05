"""SQLAlchemy models -- mirror `erd-schema.sql` field-for-field.

This file does NOT create the schema (no `Base.metadata.create_all()` is
called anywhere against the real DB). `erd-schema.sql` remains the single
source of truth for DDL; these models exist so the API can read/write
through SQLAlchemy without hand-writing SQL everywhere. If the schema
file changes, update this file to match -- not the other way around.

The `weekly_waste_summary` VIEW is deliberately not mapped here; it's
queried with raw SQL in `routers/dashboard.py` since it's read-only and
has no primary key of its own.
"""
import uuid
from datetime import date, datetime

from sqlalchemy import (
    ARRAY,
    SmallInteger,
    CheckConstraint,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base

# ---------------------------------------------------------------------------
# Enums (must match the CREATE TYPE statements in erd-schema.sql exactly --
# same name, same members, in the same order)
# ---------------------------------------------------------------------------

risk_level_enum = Enum("low", "med", "high", name="risk_level", create_type=False)
food_item_status_enum = Enum(
    "active", "consumed", "wasted", "partially_used", name="food_item_status", create_type=False
)
food_item_source_enum = Enum("manual", "barcode", "photo", name="food_item_source", create_type=False)
storage_type_enum = Enum("refrigerated", "frozen", "room_temp", name="storage_type", create_type=False)
log_status_enum = Enum("consumed", "wasted", name="log_status", create_type=False)
waste_reason_enum = Enum(
    "expired",
    "spoiled",
    "cooked_too_much",
    "forgot_about_it",
    "didnt_like_taste",
    "changed_plans",
    "bought_too_much",
    "other",
    name="waste_reason",
    create_type=False,
)

# Tags that are never allowed to be saved as a *user* diet_preference --
# mirrors the DB CHECK constraint `diet_preference_tag_not_religion_linked`.
# Kept here too (defense in depth) so the API can return a clean 422 instead
# of surfacing a raw Postgres constraint-violation error to the client.
RELIGION_LINKED_DIET_TAGS = {"halal", "kosher", "jain", "hindu-vegetarian", "buddhist-vegetarian"}


# ---------------------------------------------------------------------------
# SECTION 1 -- Core app tables
# ---------------------------------------------------------------------------


class UserProfile(Base):
    __tablename__ = "user_profile"

    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    household_size: Mapped[int] = mapped_column(nullable=False)
    location: Mapped[str | None] = mapped_column(String(50))
    risk_score: Mapped[str] = mapped_column(risk_level_enum, nullable=False, server_default="low")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (CheckConstraint("household_size > 0", name="user_profile_household_size_check"),)

    food_items: Mapped[list["FoodItem"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    diet_preferences: Mapped[list["DietPreference"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )


class FoodItem(Base):
    __tablename__ = "food_item"

    item_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("user_profile.user_id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    category: Mapped[str | None] = mapped_column(String(50))
    canonical_food_name: Mapped[str | None] = mapped_column(Text)
    barcode: Mapped[str | None] = mapped_column(Text)
    quantity: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False, server_default="1")
    unit: Mapped[str | None] = mapped_column(String(20))
    purchase_date: Mapped[date] = mapped_column(Date, nullable=False, server_default=func.current_date())
    expiry_date: Mapped[date | None] = mapped_column(Date, index=True)
    source: Mapped[str] = mapped_column(food_item_source_enum, nullable=False, server_default="manual")
    status: Mapped[str] = mapped_column(food_item_status_enum, nullable=False, server_default="active", index=True)
    # The household's own choice of where to keep this item. NULL means "not
    # specified" -- it is NOT a fallback to the FoodKeeper recommendation,
    # which stays in ref_foodkeeper_storage and is served separately.
    storage: Mapped[str | None] = mapped_column(storage_type_enum)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    user: Mapped["UserProfile"] = relationship(back_populates="food_items")
    logs: Mapped[list["ConsumptionWasteLog"]] = relationship(back_populates="item", cascade="all, delete-orphan")


class ConsumptionWasteLog(Base):
    __tablename__ = "consumption_waste_log"

    log_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    item_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("food_item.item_id", ondelete="CASCADE"), nullable=False, index=True
    )
    status: Mapped[str] = mapped_column(log_status_enum, nullable=False, index=True)
    quantity: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)
    waste_reason: Mapped[str | None] = mapped_column(waste_reason_enum, index=True)
    notes: Mapped[str | None] = mapped_column(String(100))
    logged_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)

    item: Mapped["FoodItem"] = relationship(back_populates="logs")


# ---------------------------------------------------------------------------
# SECTION 2 -- Diet Filtering & Recipe Recommendation epic
# ---------------------------------------------------------------------------


class DietPreference(Base):
    __tablename__ = "diet_preference"

    preference_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("user_profile.user_id", ondelete="CASCADE"), nullable=False
    )
    tag: Mapped[str] = mapped_column(Text, nullable=False)
    target_value: Mapped[float | None] = mapped_column(Numeric)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint("user_id", "tag", name="diet_preference_user_id_tag_key"),
        CheckConstraint(
            "lower(tag) NOT IN ('halal','kosher','jain','hindu-vegetarian','buddhist-vegetarian')",
            name="diet_preference_tag_not_religion_linked",
        ),
    )

    user: Mapped["UserProfile"] = relationship(back_populates="diet_preferences")


class Recipe(Base):
    __tablename__ = "recipe"

    recipe_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    external_id: Mapped[str | None] = mapped_column(Text)
    source: Mapped[str] = mapped_column(Text, nullable=False)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    image_url: Mapped[str | None] = mapped_column(Text)
    ingredients: Mapped[list] = mapped_column(JSONB, nullable=False, server_default="[]")
    instructions: Mapped[str | None] = mapped_column(Text)
    nutrients: Mapped[dict | None] = mapped_column(JSONB)
    diet_tags: Mapped[list[str]] = mapped_column(ARRAY(Text), nullable=False, server_default="{}")
    cached_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (UniqueConstraint("source", "external_id", name="recipe_source_external_id_key"),)


# ---------------------------------------------------------------------------
# SECTION 3 -- Reference data (read-only, public datasets)
# ---------------------------------------------------------------------------


class RefFoodkeeperStorage(Base):
    """USDA FoodKeeper, rebuilt from the official JSON (see DATA_AUDIT.md).

    `foodkeeper_id` is the upstream USDA product ID -- the previous build
    invented FK#### keys, which made rows untraceable to the source.
    `canonical_food_name` includes the product subtitle so distinct products
    (canned vs glazed ham) don't collapse onto one storage rule;
    `canonical_name_base` keeps the name-only form for broad fallback matching.
    """

    __tablename__ = "ref_foodkeeper_storage"

    foodkeeper_id: Mapped[int] = mapped_column(primary_key=True)
    category_id: Mapped[int | None] = mapped_column()
    category_name: Mapped[str | None] = mapped_column(Text)
    name: Mapped[str | None] = mapped_column(Text)
    name_subtitle: Mapped[str | None] = mapped_column(Text)
    keywords: Mapped[str | None] = mapped_column(Text)
    canonical_food_name: Mapped[str] = mapped_column(Text, nullable=False, index=True)
    canonical_name_base: Mapped[str | None] = mapped_column(Text, index=True)
    pantry_min: Mapped[float | None] = mapped_column(Numeric)
    pantry_max: Mapped[float | None] = mapped_column(Numeric)
    pantry_metric: Mapped[str | None] = mapped_column(Text)
    pantry_tips: Mapped[str | None] = mapped_column(Text)
    dop_pantry_min: Mapped[float | None] = mapped_column(Numeric)
    dop_pantry_max: Mapped[float | None] = mapped_column(Numeric)
    dop_pantry_metric: Mapped[str | None] = mapped_column(Text)
    pantry_after_opening_min: Mapped[float | None] = mapped_column(Numeric)
    pantry_after_opening_max: Mapped[float | None] = mapped_column(Numeric)
    pantry_after_opening_metric: Mapped[str | None] = mapped_column(Text)
    refrigerate_min: Mapped[float | None] = mapped_column(Numeric)
    refrigerate_max: Mapped[float | None] = mapped_column(Numeric)
    refrigerate_metric: Mapped[str | None] = mapped_column(Text)
    refrigerate_tips: Mapped[str | None] = mapped_column(Text)
    dop_refrigerate_min: Mapped[float | None] = mapped_column(Numeric)
    dop_refrigerate_max: Mapped[float | None] = mapped_column(Numeric)
    dop_refrigerate_metric: Mapped[str | None] = mapped_column(Text)
    refrigerate_after_opening_min: Mapped[float | None] = mapped_column(Numeric)
    refrigerate_after_opening_max: Mapped[float | None] = mapped_column(Numeric)
    refrigerate_after_opening_metric: Mapped[str | None] = mapped_column(Text)
    refrigerate_after_thawing_min: Mapped[float | None] = mapped_column(Numeric)
    refrigerate_after_thawing_max: Mapped[float | None] = mapped_column(Numeric)
    refrigerate_after_thawing_metric: Mapped[str | None] = mapped_column(Text)
    freeze_min: Mapped[float | None] = mapped_column(Numeric)
    freeze_max: Mapped[float | None] = mapped_column(Numeric)
    freeze_metric: Mapped[str | None] = mapped_column(Text)
    freeze_tips: Mapped[str | None] = mapped_column(Text)
    dop_freeze_min: Mapped[float | None] = mapped_column(Numeric)
    dop_freeze_max: Mapped[float | None] = mapped_column(Numeric)
    dop_freeze_metric: Mapped[str | None] = mapped_column(Text)
    source_dataset: Mapped[str | None] = mapped_column(Text)
    source_url: Mapped[str | None] = mapped_column(Text)
    license: Mapped[str | None] = mapped_column(Text)
    fetched_at_utc: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class RefPriceReference(Base):
    """Percentile-trimmed monthly price reference, rebuilt from the RAW feed.

    raw_min_rm / raw_max_rm exist ONLY so the upstream contamination stays
    auditable -- they are not part of any API response. Publish p05..p95.
    """

    __tablename__ = "ref_price_reference"

    item_code: Mapped[str] = mapped_column(Text, primary_key=True)
    month: Mapped[date] = mapped_column(Date, primary_key=True, index=True)
    item: Mapped[str | None] = mapped_column(Text)
    unit: Mapped[str | None] = mapped_column(Text)
    item_group: Mapped[str | None] = mapped_column(Text)
    item_category: Mapped[str | None] = mapped_column(Text)
    canonical_food_name: Mapped[str] = mapped_column(Text, nullable=False, index=True)
    price_p05_rm: Mapped[float | None] = mapped_column(Numeric(10, 2))
    price_p25_rm: Mapped[float | None] = mapped_column(Numeric(10, 2))
    median_price_rm: Mapped[float | None] = mapped_column(Numeric(10, 2))
    price_p75_rm: Mapped[float | None] = mapped_column(Numeric(10, 2))
    price_p95_rm: Mapped[float | None] = mapped_column(Numeric(10, 2))
    raw_min_rm: Mapped[float | None] = mapped_column(Numeric(10, 2))   # audit only
    raw_max_rm: Mapped[float | None] = mapped_column(Numeric(10, 2))   # audit only
    observations: Mapped[int | None] = mapped_column()
    price_quality: Mapped[str] = mapped_column(Text, nullable=False, server_default="ok")
    aggregation_method: Mapped[str | None] = mapped_column(Text)
    source_dataset: Mapped[str | None] = mapped_column(Text)
    source_url: Mapped[str | None] = mapped_column(Text)
    license: Mapped[str | None] = mapped_column(Text)
    fetched_at_utc: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class RefPriceReferenceState(Base):
    """Per-state prices -- what makes user_profile.location actually useful."""

    __tablename__ = "ref_price_reference_state"

    item_code: Mapped[str] = mapped_column(Text, primary_key=True)
    month: Mapped[date] = mapped_column(Date, primary_key=True)
    state: Mapped[str] = mapped_column(Text, primary_key=True, index=True)
    canonical_food_name: Mapped[str] = mapped_column(Text, nullable=False, index=True)
    item: Mapped[str | None] = mapped_column(Text)
    unit: Mapped[str | None] = mapped_column(Text)
    median_price_rm: Mapped[float | None] = mapped_column(Numeric(10, 2))
    price_p05_rm: Mapped[float | None] = mapped_column(Numeric(10, 2))
    price_p95_rm: Mapped[float | None] = mapped_column(Numeric(10, 2))
    observations: Mapped[int | None] = mapped_column()
    source_url: Mapped[str | None] = mapped_column(Text)
    license: Mapped[str | None] = mapped_column(Text)


class RefOpenFoodFactsProduct(Base):
    """Open Food Facts Malaysia -- 6,885 products.

    Coverage is very uneven and that shapes what this table can do:
    barcode -> identity works (89% named, 69% have allergen tags), but every
    diet-relevant field is sparse -- nutrients 6%, NOVA 6%, Nutri-Score 4%.
    So no diet filtering can be served from here; use USDA FDC / MyFCD.
    (OFF writes absent NOVA/Nutri-Score as the literal string "Unknown", so a
    naive non-empty count looks like 99%. nova_group_num is the parsed form.)
    Missing nutrients stay NULL -- absent means unknown, never zero.
    """

    __tablename__ = "ref_openfoodfacts_product"

    barcode: Mapped[str] = mapped_column(Text, primary_key=True)
    product_name: Mapped[str | None] = mapped_column(Text)
    product_name_en: Mapped[str | None] = mapped_column(Text)
    product_name_ms: Mapped[str | None] = mapped_column(Text)
    canonical_food_name: Mapped[str | None] = mapped_column(Text, index=True)
    brands: Mapped[str | None] = mapped_column(Text)
    categories: Mapped[str | None] = mapped_column(Text)
    categories_tags: Mapped[str | None] = mapped_column(Text)
    labels_tags: Mapped[str | None] = mapped_column(Text)
    allergens_tags: Mapped[str | None] = mapped_column(Text)
    ingredients_text: Mapped[str | None] = mapped_column(Text)
    quantity: Mapped[str | None] = mapped_column(Text)
    serving_size: Mapped[str | None] = mapped_column(Text)
    energy_kcal_100g: Mapped[float | None] = mapped_column(Numeric)
    energy_kj_100g: Mapped[float | None] = mapped_column(Numeric)
    fat_100g: Mapped[float | None] = mapped_column(Numeric)
    saturated_fat_100g: Mapped[float | None] = mapped_column(Numeric)
    carbohydrates_100g: Mapped[float | None] = mapped_column(Numeric)
    sugars_100g: Mapped[float | None] = mapped_column(Numeric)
    fiber_100g: Mapped[float | None] = mapped_column(Numeric)
    proteins_100g: Mapped[float | None] = mapped_column(Numeric)
    salt_100g: Mapped[float | None] = mapped_column(Numeric)
    sodium_100g: Mapped[float | None] = mapped_column(Numeric)
    nutrition_source: Mapped[str] = mapped_column(Text, nullable=False, server_default="none")
    nutriscore_grade: Mapped[str | None] = mapped_column(Text)
    nova_group: Mapped[str | None] = mapped_column(Text)
    nova_group_num: Mapped[int | None] = mapped_column(SmallInteger, index=True)
    image_url: Mapped[str | None] = mapped_column(Text)
    source_dataset: Mapped[str | None] = mapped_column(Text)
    source_url: Mapped[str | None] = mapped_column(Text)
    license: Mapped[str | None] = mapped_column(Text)
    fetched_at_utc: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class RefRecipeIndex(Base):
    __tablename__ = "ref_recipe_index"

    recipe_id: Mapped[str] = mapped_column(Text, primary_key=True)
    source_recipe_id: Mapped[str | None] = mapped_column(Text)
    recipe_name: Mapped[str | None] = mapped_column(Text)
    recipe_name_canonical: Mapped[str | None] = mapped_column(Text)
    ingredient_tokens: Mapped[list[str] | None] = mapped_column(ARRAY(Text))
    tags: Mapped[list[str] | None] = mapped_column(ARRAY(Text))
    servings: Mapped[int | None] = mapped_column()
    serving_size: Mapped[str | None] = mapped_column(Text)

    detail: Mapped["RefRecipeDetail"] = relationship(back_populates="index_row", uselist=False)


class RefRecipeDetail(Base):
    __tablename__ = "ref_recipe_detail"

    recipe_id: Mapped[str] = mapped_column(
        Text, ForeignKey("ref_recipe_index.recipe_id", ondelete="CASCADE"), primary_key=True
    )
    ingredients: Mapped[list | None] = mapped_column(JSONB)
    ingredients_raw: Mapped[str | None] = mapped_column(Text)
    steps: Mapped[str | None] = mapped_column(Text)
    servings: Mapped[int | None] = mapped_column()
    serving_size: Mapped[str | None] = mapped_column(Text)

    index_row: Mapped["RefRecipeIndex"] = relationship(back_populates="detail")
