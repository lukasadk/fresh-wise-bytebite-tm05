from __future__ import annotations

from datetime import date, datetime
from enum import Enum
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class GroceryUnit(str, Enum):
    piece = "piece"
    pack = "pack"
    bag = "bag"
    box = "box"
    bottle = "bottle"
    can = "can"
    jar = "jar"
    bunch = "bunch"
    tray = "tray"
    carton = "carton"
    kilogram = "kg"
    gram = "g"
    litre = "L"
    millilitre = "mL"
    unknown = "unknown"


class AnalysisStatus(str, Enum):
    needs_confirmation = "needs_confirmation"
    confirmed = "confirmed"


class BarcodeCandidate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    value: str = Field(pattern=r"^\d{8,14}$")
    format: str


class ReviewDecision(str, Enum):
    pending = "pending"
    accepted = "accepted"
    rejected = "rejected"


class ReviewOrigin(str, Enum):
    model = "model"
    manual = "manual"


class RecognizedFoodItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    item_id: UUID
    food_name: str = Field(min_length=1, max_length=200)
    brand: str | None = Field(default=None, max_length=100)
    product_variant: str | None = Field(default=None, max_length=150)
    net_content_text: str | None = Field(default=None, max_length=50)
    category: str = Field(min_length=1, max_length=100)
    quantity: float | None = Field(default=None, gt=0)
    unit: GroceryUnit = GroceryUnit.unknown
    bounding_box: tuple[int, int, int, int] | None = None
    confidence: float = Field(ge=0.0, le=1.0)
    review_required: bool
    review_reasons: list[str] = Field(default_factory=list)
    packaging_text_evidence: list[str] = Field(default_factory=list)
    expiry_date_candidate: date | None = None
    expiry_text_evidence: str | None = Field(default=None, max_length=100)
    estimated_expiry_date: date | None = None
    expiry_estimate_days: int | None = Field(default=None, ge=1, le=730)
    expiry_estimate_basis: str | None = Field(default=None, max_length=120)

    @field_validator("bounding_box")
    @classmethod
    def validate_bounding_box(
        cls, value: tuple[int, int, int, int] | None
    ) -> tuple[int, int, int, int] | None:
        if value is None:
            return None
        x1, y1, x2, y2 = value
        if not (0 <= x1 < x2 <= 1000 and 0 <= y1 < y2 <= 1000):
            raise ValueError("bounding_box must be normalized to the 0..1000 image plane")
        if x2 - x1 < 10 or y2 - y1 < 10:
            raise ValueError("bounding_box is too small to be reliable")
        return value


class AnalysisResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    analysis_id: UUID
    input_type: Literal["grocery_photo", "receipt"] = "grocery_photo"
    status: AnalysisStatus = AnalysisStatus.needs_confirmation
    model_id: str
    items: list[RecognizedFoodItem]
    barcode_candidates: list[BarcodeCandidate] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    generation_attempts: int = Field(default=1, ge=1, le=2)
    latency_ms: float = Field(ge=0.0)
    created_at: datetime
    review_image_url: str | None = None


class ReviewItemUpdate(BaseModel):
    """One user-editable review row.

    Model-only evidence fields are intentionally absent. They are restored from
    the immutable analysis by the repository and cannot be forged by a client.
    """

    model_config = ConfigDict(extra="forbid")

    review_item_id: UUID | None = None
    source_item_id: UUID | None = None
    decision: ReviewDecision = ReviewDecision.pending
    food_name: str = Field(min_length=1, max_length=200)
    brand: str | None = Field(default=None, max_length=100)
    product_variant: str | None = Field(default=None, max_length=150)
    net_content_text: str | None = Field(default=None, max_length=50)
    category: str = Field(min_length=1, max_length=100)
    quantity: float | None = Field(default=None, gt=0)
    unit: GroceryUnit = GroceryUnit.unknown
    expiry_date: date | None = None
    expiry_confirmed: bool = False
    notes: str | None = Field(default=None, max_length=500)

    @field_validator("food_name", "category")
    @classmethod
    def strip_required_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("must not be blank")
        return value

    @field_validator("brand", "product_variant", "net_content_text", "notes")
    @classmethod
    def strip_optional_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None


class SaveReviewRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    expected_revision: int = Field(ge=0)
    items: list[ReviewItemUpdate]

    @model_validator(mode="after")
    def reject_duplicate_ids(self) -> "SaveReviewRequest":
        source_ids = [item.source_item_id for item in self.items if item.source_item_id]
        if len(source_ids) != len(set(source_ids)):
            raise ValueError("source_item_id may appear only once")
        review_ids = [item.review_item_id for item in self.items if item.review_item_id]
        if len(review_ids) != len(set(review_ids)):
            raise ValueError("review_item_id may appear only once")
        return self


class ReviewFoodItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    review_item_id: UUID
    source_item_id: UUID | None = None
    origin: ReviewOrigin
    decision: ReviewDecision
    food_name: str
    brand: str | None = None
    product_variant: str | None = None
    net_content_text: str | None = None
    category: str
    quantity: float | None = None
    unit: GroceryUnit
    expiry_date: date | None = None
    expiry_confirmed: bool = False
    notes: str | None = None
    model_confidence: float | None = Field(default=None, ge=0.0, le=1.0)
    model_review_required: bool = False
    model_review_reasons: list[str] = Field(default_factory=list)
    packaging_text_evidence: list[str] = Field(default_factory=list)
    model_expiry_date_candidate: date | None = None
    expiry_text_evidence: str | None = None
    corrected_fields: list[str] = Field(default_factory=list)


class ReviewSummary(BaseModel):
    model_candidates: int = Field(ge=0)
    manual_items: int = Field(ge=0)
    pending: int = Field(ge=0)
    accepted: int = Field(ge=0)
    rejected: int = Field(ge=0)
    corrected_model_items: int = Field(ge=0)
    unresolved_accepted_items: int = Field(ge=0)
    unconfirmed_expiry_items: int = Field(ge=0)
    ready_to_confirm: bool


class ReviewDraftResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    analysis_id: UUID
    status: AnalysisStatus
    revision: int = Field(ge=0)
    items: list[ReviewFoodItem]
    summary: ReviewSummary
    created_at: datetime
    updated_at: datetime


class ConfirmReviewRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    expected_revision: int = Field(ge=0)
    confirm_to_active_inventory: Literal[True]


class LiteralExpirySource(str, Enum):
    user_provided = "user_provided"
    model_ocr_user_confirmed = "model_ocr_user_confirmed"


class InventoryEntry(BaseModel):
    model_config = ConfigDict(extra="forbid")

    inventory_id: UUID
    analysis_id: UUID
    review_item_id: UUID
    source_item_id: UUID | None
    origin: ReviewOrigin
    food_name: str
    brand: str | None = None
    product_variant: str | None = None
    net_content_text: str | None = None
    category: str
    quantity: float
    unit: GroceryUnit
    expiry_date: date | None
    expiry_source: LiteralExpirySource | None = None
    notes: str | None
    corrected_by_user: bool
    corrected_fields: list[str] = Field(default_factory=list)
    review_revision: int = Field(ge=0)
    status: str = "active"
    created_at: datetime


class ConfirmationResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    analysis_id: UUID
    status: AnalysisStatus = AnalysisStatus.confirmed
    review_revision: int
    review_summary: ReviewSummary
    inventory_entries: list[InventoryEntry]


class ReviewEvent(BaseModel):
    model_config = ConfigDict(extra="forbid")

    event_id: UUID
    analysis_id: UUID
    event_type: str
    revision: int
    summary: ReviewSummary
    created_at: datetime


class ReviewHistoryResponse(BaseModel):
    analysis_id: UUID
    events: list[ReviewEvent]


class ReviewMetricsResponse(BaseModel):
    confirmed_analyses: int = Field(ge=0)
    reviewed_model_candidates: int = Field(ge=0)
    accepted_model_items: int = Field(ge=0)
    rejected_model_items: int = Field(ge=0)
    corrected_model_items: int = Field(ge=0)
    manually_added_items: int = Field(ge=0)
    user_correction_rate: float | None = Field(default=None, ge=0.0, le=1.0)


class ConfidenceBinMetrics(BaseModel):
    model_config = ConfigDict(extra="forbid")

    lower_bound: float = Field(ge=0.0, le=1.0)
    upper_bound: float = Field(gt=0.0, le=1.0)
    model_candidates: int = Field(ge=0)
    accepted_unchanged: int = Field(ge=0)
    corrected_or_rejected: int = Field(ge=0)
    observed_unchanged_rate: float | None = Field(default=None, ge=0.0, le=1.0)


class ConfidenceDiagnosticsResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    confirmed_model_candidates: int = Field(ge=0)
    note: str
    bins: list[ConfidenceBinMetrics]


class RecognitionEngine(str, Enum):
    local = "local"
    api = "api"


class RecognitionJobState(str, Enum):
    queued = "queued"
    running = "running"
    succeeded = "succeeded"
    failed = "failed"


class RecognitionJobResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    job_id: UUID
    engine: RecognitionEngine
    state: RecognitionJobState
    phase: str
    progress: float = Field(ge=0.0, le=1.0)
    analysis_id: UUID | None = None
    error: str | None = None
    created_at: datetime
    updated_at: datetime


class HealthResponse(BaseModel):
    status: str
    backend: str
    model_loaded: bool
    selected_model: str | None = None
    attempted_models: list[str] = Field(default_factory=list)
    last_model_error: str | None = None
    hardware: dict[str, Any]


class APIRecognitionConfigResponse(BaseModel):
    """Safe, public view of the server-side external API configuration."""

    model_config = ConfigDict(extra="forbid")

    enabled: bool
    provider_format: Literal["openai_compatible"] = "openai_compatible"
    base_url: str | None = None
    model: str | None = None
    api_key_required: bool
    api_key_configured: bool
    json_mode: bool
    prompt_file: str
    prompt_loaded: bool
    receipt_prompt_file: str
    receipt_prompt_loaded: bool
    config_file: str
    config_loaded: bool
    timeout_seconds: float
    image_max_edge: int
    max_tokens: int
    configuration_error: str | None = None


class APIRecognitionImageRequest(BaseModel):
    """JSON image upload path for mobile clients that cannot reliably multipart-upload file:// URIs."""

    model_config = ConfigDict(extra="forbid")

    image_base64: str = Field(min_length=1)
    content_type: Literal["image/jpeg", "image/png", "image/webp"] = "image/jpeg"


class ExpiryEstimateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    food_name: str = Field(min_length=1, max_length=200)
    category: str | None = Field(default=None, max_length=100)
    reference_date: date | None = None

    @field_validator("food_name")
    @classmethod
    def strip_food_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("must not be blank")
        return value


class ExpiryEstimateResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    estimated_expiry_date: date
    estimate_days: int = Field(ge=1, le=730)
    basis: str
    is_estimate: Literal[True] = True


class RecipeInventoryItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=200)
    quantity: float | None = Field(default=None, gt=0)
    unit: str | None = Field(default=None, max_length=40)
    category: str | None = Field(default=None, max_length=100)
    expiry_date: date | None = None
    expiry_days: int | None = Field(default=None, ge=-365, le=3650)

    @field_validator("name")
    @classmethod
    def strip_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("must not be blank")
        return value

    @field_validator("unit", "category")
    @classmethod
    def strip_optional_recipe_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None


class RecipeRecommendRequest(BaseModel):
    # The Expo app sends extra UI guidance such as locale/cuisine_profile and
    # local_recipe_hints. The gateway can safely ignore fields it does not use;
    # rejecting them breaks the mobile recipe page even though the required
    # inventory payload is present.
    model_config = ConfigDict(extra="ignore")

    inventory: list[RecipeInventoryItem] = Field(min_length=1, max_length=120)
    limit: int = Field(default=3, ge=1, le=10)
    use_ai: bool = True
    language: Literal["en", "zh"] = "en"
    selection_mode: bool = False
    selected_ingredients: list[str] = Field(default_factory=list, max_length=120)

    @field_validator("selected_ingredients")
    @classmethod
    def clean_selected_ingredients(cls, values: list[str]) -> list[str]:
        cleaned: list[str] = []
        for value in values:
            item = str(value).strip()
            if item and item.casefold() not in {existing.casefold() for existing in cleaned}:
                cleaned.append(item[:200])
        return cleaned


class RecipeRecommendationItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    recipe_id: str
    title: str
    reason: str
    available_ingredients: list[str]
    priority_ingredients: list[str] = Field(default_factory=list)
    missing_ingredients: list[str]
    ingredient_quantities: list[str] = Field(default_factory=list)
    steps: list[str]
    image_url: str
    image_alt: str
    prep_minutes: int | None = Field(default=None, ge=0, le=240)
    cook_minutes: int | None = Field(default=None, ge=0, le=480)
    tags: list[str] = Field(default_factory=list)
    servings: int | None = Field(default=None, ge=1, le=20)
    score: float = Field(ge=0.0)
    source: str = "mini_recipe_rag"
    ai_enhanced: bool = False


class RecipeRecommendResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    recommendations: list[RecipeRecommendationItem]
    pantry_ingredients: list[str]
    priority_ingredients: list[str]
    model_id: str
    latency_ms: float = Field(ge=0.0)
    warnings: list[str] = Field(default_factory=list)
