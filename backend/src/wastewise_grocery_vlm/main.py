from contextlib import asynccontextmanager
import base64
import binascii
from datetime import datetime, timezone
from io import BytesIO
import json
from pathlib import Path
from secrets import compare_digest
from time import perf_counter
from uuid import UUID, uuid4

from fastapi import FastAPI, File, HTTPException, Request, UploadFile, status
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from PIL import Image, ImageOps, UnidentifiedImageError

from .api_recognition import (
    APIRecognitionError,
    APIRecognitionNotConfiguredError,
    APIRecognitionTimeoutError,
    api_recognition_status,
    get_api_recognition_runtime,
    get_api_receipt_recognition_runtime,
)
from .barcode import decode_product_barcodes
from .config import PROJECT_ROOT, get_settings
from .expiry_estimation import estimate_expiry
from .jobs import (
    RecognitionJobNotFoundError,
    RecognitionJobQueueFullError,
    get_recognition_job_manager,
)
from .lightweight_pantry import router as lightweight_pantry_router
from .model_runtime import ModelLoadError, get_model_runtime
from .open_food_facts import ProductLookupError, lookup_barcode
from .parsing import ModelOutputError, parse_model_output
from .repository import (
    AnalysisAlreadyConfirmedError,
    AnalysisImageNotFoundError,
    AnalysisNotFoundError,
    InvalidReviewError,
    ReviewRevisionConflictError,
    get_repository,
)
from .recipe_rag import hosted_recipe_image_path, recommend_recipes
from .schemas import (
    APIRecognitionConfigResponse,
    APIRecognitionImageRequest,
    AnalysisResponse,
    ConfirmReviewRequest,
    ConfirmationResponse,
    ConfidenceDiagnosticsResponse,
    ExpiryEstimateRequest,
    ExpiryEstimateResponse,
    HealthResponse,
    InventoryEntry,
    RecognitionEngine,
    RecognitionJobResponse,
    RecipeRecommendRequest,
    RecipeRecommendResponse,
    ReviewDraftResponse,
    ReviewHistoryResponse,
    ReviewMetricsResponse,
    SaveReviewRequest,
)


def _decode_image(content: bytes) -> Image.Image:
    settings = get_settings()
    Image.MAX_IMAGE_PIXELS = settings.max_image_pixels
    try:
        with Image.open(BytesIO(content)) as probe:
            if probe.width * probe.height > settings.max_image_pixels:
                raise HTTPException(status_code=413, detail="Image pixel dimensions are too large.")
            probe.verify()
        with Image.open(BytesIO(content)) as decoded:
            return ImageOps.exif_transpose(decoded).convert("RGB")
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
        raise HTTPException(status_code=400, detail="Uploaded file is not a safe, valid image.") from exc


def _encode_review_image(image: Image.Image) -> bytes:
    preview = image.copy()
    maximum = get_settings().review_image_max_edge
    preview.thumbnail((maximum, maximum), Image.Resampling.LANCZOS)
    output = BytesIO()
    preview.save(output, format="JPEG", quality=90, optimize=True)
    return output.getvalue()


async def _read_uploaded_image(file: UploadFile) -> Image.Image:
    settings = get_settings()
    allowed_types = {"image/jpeg", "image/png", "image/webp"}
    if file.content_type not in allowed_types:
        raise HTTPException(status_code=415, detail="Use a JPEG, PNG, or WebP image.")
    maximum = settings.max_upload_mb * 1024 * 1024
    content = await file.read(maximum + 1)
    if not content:
        raise HTTPException(status_code=400, detail="Uploaded image is empty.")
    if len(content) > maximum:
        raise HTTPException(status_code=413, detail=f"Image exceeds {settings.max_upload_mb} MB.")
    return _decode_image(content)


def _read_json_image(request: APIRecognitionImageRequest) -> Image.Image:
    settings = get_settings()
    maximum = settings.max_upload_mb * 1024 * 1024
    payload = request.image_base64.strip()
    if "," in payload and payload.lower().startswith("data:"):
        payload = payload.split(",", 1)[1]
    try:
        content = base64.b64decode(payload, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise HTTPException(status_code=400, detail="image_base64 is not valid base64.") from exc
    if not content:
        raise HTTPException(status_code=400, detail="Uploaded image is empty.")
    if len(content) > maximum:
        raise HTTPException(status_code=413, detail=f"Image exceeds {settings.max_upload_mb} MB.")
    return _decode_image(content)


def _prepare_inference_image(image: Image.Image) -> Image.Image:
    prepared = image.copy()
    maximum = get_settings().inference_image_max_edge
    prepared.thumbnail((maximum, maximum), Image.Resampling.LANCZOS)
    return prepared


def _generate_validated(runtime: object, image: Image.Image):
    settings = get_settings()
    last_error: ModelOutputError | None = None
    attempts = 1 + settings.structured_retry_count
    for attempt in range(1, attempts + 1):
        raw_output, model_id = runtime.generate(image, recovery=attempt > 1)
        try:
            items, warnings = parse_model_output(
                raw_output,
                settings.confidence_threshold,
                max_items=settings.max_recognized_items,
            )
        except ModelOutputError as exc:
            last_error = exc
            if attempt < attempts:
                continue
            _audit_invalid_model_output(raw_output, exc, attempt)
            raise
        if attempt > 1:
            warnings.insert(0, "Initial model output was invalid; one bounded retry succeeded.")
        return model_id, items, warnings, attempt
    raise last_error or ModelOutputError("The model did not return a valid JSON object.")


def _capitalize_first_letter(value: str) -> str:
    for index, character in enumerate(value):
        if character.isalpha():
            return f"{value[:index]}{character.upper()}{value[index + 1:]}"
    return value


def _audit_invalid_model_output(
    raw_output: str,
    error: Exception,
    attempt: int,
) -> None:
    audit_dir = PROJECT_ROOT / "logs" / "invalid_model_outputs"
    try:
        audit_dir.mkdir(parents=True, exist_ok=True)
        audit_path = audit_dir / f"{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}_{uuid4().hex}.json"
        audit_path.write_text(
            json.dumps(
                {
                    "error": str(error),
                    "attempt": attempt,
                    "raw_output_preview": raw_output[:6000],
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )
    except OSError:
        pass


def _expiry_estimation_identity(item) -> str:
    parts = [
        item.food_name,
        item.brand,
        item.product_variant,
        item.net_content_text,
        item.category,
        *item.packaging_text_evidence,
    ]
    return " ".join(str(part) for part in parts if part)


def _with_expiry_fallbacks(items: list) -> list:
    """Prefer a printed expiry and estimate only when no exact date survived parsing."""

    enriched_items = []
    for item in items:
        display_item = item.model_copy(
            update={"food_name": _capitalize_first_letter(item.food_name)}
        )
        if display_item.expiry_date_candidate is not None:
            # Defensive clearing matters if a future model/API returns both an
            # exact printed date and stale estimate fields in the same object.
            enriched_items.append(
                display_item.model_copy(
                    update={
                        "estimated_expiry_date": None,
                        "expiry_estimate_days": None,
                        "expiry_estimate_basis": None,
                    }
                )
            )
            continue
        estimate = estimate_expiry(
            _expiry_estimation_identity(display_item),
            display_item.category,
        )
        enriched_items.append(
            display_item.model_copy(
                update={
                    "estimated_expiry_date": estimate.estimated_expiry_date,
                    "expiry_estimate_days": estimate.estimate_days,
                    "expiry_estimate_basis": estimate.basis,
                }
            )
        )
    return enriched_items


def _save_analysis_result(
    image: Image.Image,
    model_id: str,
    items: list,
    warnings: list[str],
    generation_attempts: int,
    started: float,
    input_type: str = "grocery_photo",
) -> AnalysisResponse:
    latency_ms = round((perf_counter() - started) * 1000, 2)
    analysis_id = uuid4()
    enriched_items = _with_expiry_fallbacks(items)
    response = AnalysisResponse(
        analysis_id=analysis_id,
        input_type=input_type,
        model_id=model_id,
        items=enriched_items,
        barcode_candidates=decode_product_barcodes(image),
        warnings=warnings,
        generation_attempts=generation_attempts,
        latency_ms=latency_ms,
        created_at=datetime.now(timezone.utc),
        review_image_url=f"/v1/photo-entries/{analysis_id}/image",
    )
    get_repository().save_analysis(response, _encode_review_image(image), "image/jpeg")
    return response


@asynccontextmanager
async def lifespan(_: FastAPI):
    settings = get_settings()
    get_repository()
    if settings.preload_model:
        try:
            await run_in_threadpool(get_model_runtime().ensure_loaded)
        except Exception:
            # Health exposes the error. Keeping the API alive allows diagnosis/retry.
            pass
    yield


app = FastAPI(
    title="WasteWise Grocery VLM API",
    version="0.4.0",
    description="API-based grocery-photo and receipt recognition with editable expiry estimates.",
    lifespan=lifespan,
)
app.include_router(lightweight_pantry_router)

# The computer UI preview runs on a separate local development port. Permit
# only loopback browser origins; this does not expose the model service to the
# public internet or to arbitrary websites.
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^http://(?:localhost|127\.0\.0\.1)(?::\d+)?$",
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    configured_key = get_settings().service_api_key
    if request.url.path.startswith("/v1/") and configured_key:
        expected = configured_key.get_secret_value()
        supplied = request.headers.get("X-WasteWise-API-Key", "")
        if expected and not compare_digest(supplied, expected):
            return JSONResponse(
                status_code=401,
                content={"detail": "A valid X-WasteWise-API-Key header is required."},
                headers={
                    "Cache-Control": "private, no-store",
                    "X-Content-Type-Options": "nosniff",
                    "Referrer-Policy": "no-referrer",
                    "X-Frame-Options": "DENY",
                },
            )
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "no-referrer")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault(
        "Content-Security-Policy",
        "default-src 'self'; img-src 'self' blob: data:; script-src 'self'; "
        "style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
    )
    if request.url.path.startswith("/v1/"):
        response.headers.setdefault("Cache-Control", "private, no-store")
    return response

STATIC_DIR = Path(__file__).resolve().parent / "static"
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/", include_in_schema=False)
def review_app() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    settings = get_settings()
    runtime = get_model_runtime()
    return HealthResponse(
        status="ready" if runtime.loaded or not settings.preload_model else "degraded",
        backend=settings.backend,
        model_loaded=runtime.loaded,
        selected_model=runtime.state.selected_model,
        attempted_models=runtime.state.attempted_models,
        last_model_error=runtime.state.last_error,
        hardware=runtime.hardware.as_dict(),
    )


@app.post(
    "/v1/photo-entries/analyze",
    response_model=AnalysisResponse,
    status_code=status.HTTP_201_CREATED,
)
async def analyze_photo(file: UploadFile = File(...)) -> AnalysisResponse:
    image = await _read_uploaded_image(file)
    inference_image = _prepare_inference_image(image)
    started = perf_counter()
    try:
        model_id, items, warnings, attempts = await run_in_threadpool(
            _generate_validated, get_model_runtime(), inference_image
        )
        return _save_analysis_result(image, model_id, items, warnings, attempts, started)
    except ModelOutputError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except ModelLoadError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.get(
    "/v1/api-recognition/config",
    response_model=APIRecognitionConfigResponse,
)
def api_recognition_config() -> APIRecognitionConfigResponse:
    """Report whether external recognition is usable without exposing its key."""

    return api_recognition_status()


@app.post(
    "/v1/api-recognition/analyze",
    response_model=AnalysisResponse,
    status_code=status.HTTP_201_CREATED,
)
async def analyze_photo_with_api(file: UploadFile = File(...)) -> AnalysisResponse:
    """Analyze a photo through the configured OpenAI-compatible vision API."""

    image = await _read_uploaded_image(file)
    inference_image = _prepare_inference_image(image)
    started = perf_counter()
    try:
        model_id, items, warnings, attempts = await run_in_threadpool(
            _generate_validated, get_api_recognition_runtime(), inference_image
        )
        return _save_analysis_result(image, model_id, items, warnings, attempts, started)
    except APIRecognitionNotConfiguredError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except APIRecognitionTimeoutError as exc:
        raise HTTPException(status_code=504, detail=str(exc)) from exc
    except (APIRecognitionError, ModelOutputError) as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.post(
    "/v1/api-recognition/analyze-json",
    response_model=AnalysisResponse,
    status_code=status.HTTP_201_CREATED,
)
async def analyze_photo_json_with_api(request: APIRecognitionImageRequest) -> AnalysisResponse:
    """Analyze a JSON/base64 photo upload through the configured vision API."""

    image = _read_json_image(request)
    inference_image = _prepare_inference_image(image)
    started = perf_counter()
    try:
        model_id, items, warnings, attempts = await run_in_threadpool(
            _generate_validated, get_api_recognition_runtime(), inference_image
        )
        return _save_analysis_result(image, model_id, items, warnings, attempts, started)
    except APIRecognitionNotConfiguredError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except APIRecognitionTimeoutError as exc:
        raise HTTPException(status_code=504, detail=str(exc)) from exc
    except (APIRecognitionError, ModelOutputError) as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.post(
    "/v1/api-recognition/receipt",
    response_model=AnalysisResponse,
    status_code=status.HTTP_201_CREATED,
)
async def analyze_receipt_with_api(file: UploadFile = File(...)) -> AnalysisResponse:
    """Read grocery lines from a receipt through the configured vision API."""

    image = await _read_uploaded_image(file)
    inference_image = _prepare_inference_image(image)
    started = perf_counter()
    try:
        model_id, items, warnings, attempts = await run_in_threadpool(
            _generate_validated, get_api_receipt_recognition_runtime(), inference_image
        )
        return _save_analysis_result(
            image,
            model_id,
            items,
            warnings,
            attempts,
            started,
            input_type="receipt",
        )
    except APIRecognitionNotConfiguredError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except APIRecognitionTimeoutError as exc:
        raise HTTPException(status_code=504, detail=str(exc)) from exc
    except (APIRecognitionError, ModelOutputError) as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.post(
    "/v1/api-recognition/receipt-json",
    response_model=AnalysisResponse,
    status_code=status.HTTP_201_CREATED,
)
async def analyze_receipt_json_with_api(request: APIRecognitionImageRequest) -> AnalysisResponse:
    """Read grocery lines from a JSON/base64 receipt upload through the configured vision API."""

    image = _read_json_image(request)
    inference_image = _prepare_inference_image(image)
    started = perf_counter()
    try:
        model_id, items, warnings, attempts = await run_in_threadpool(
            _generate_validated, get_api_receipt_recognition_runtime(), inference_image
        )
        return _save_analysis_result(
            image,
            model_id,
            items,
            warnings,
            attempts,
            started,
            input_type="receipt",
        )
    except APIRecognitionNotConfiguredError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except APIRecognitionTimeoutError as exc:
        raise HTTPException(status_code=504, detail=str(exc)) from exc
    except (APIRecognitionError, ModelOutputError) as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.post("/v1/expiry-estimates", response_model=ExpiryEstimateResponse)
def expiry_estimate(request: ExpiryEstimateRequest) -> ExpiryEstimateResponse:
    """Return an explicitly labelled, editable shelf-life estimate."""

    estimate = estimate_expiry(
        request.food_name,
        request.category,
        reference_date=request.reference_date,
    )
    return ExpiryEstimateResponse(
        estimated_expiry_date=estimate.estimated_expiry_date,
        estimate_days=estimate.estimate_days,
        basis=estimate.basis,
    )


@app.post("/v1/recipe-rag/recommend", response_model=RecipeRecommendResponse)
def recipe_rag_recommend(
    payload: RecipeRecommendRequest,
    http_request: Request,
) -> RecipeRecommendResponse:
    """Recommend recipes from a small local recipe RAG, optionally polished by the API model."""

    response = recommend_recipes(payload)
    forwarded_proto = http_request.headers.get("x-forwarded-proto", "").split(",", 1)[0].strip()
    forwarded_host = http_request.headers.get("x-forwarded-host", "").split(",", 1)[0].strip()
    public_host = forwarded_host or http_request.url.netloc
    public_scheme = forwarded_proto if forwarded_proto in {"http", "https"} else http_request.url.scheme
    # Railway terminates TLS before forwarding to Uvicorn. Depending on the
    # proxy path, Starlette can still see the internal request as HTTP; an
    # Android release build then blocks the generated cleartext image URL.
    if public_host.endswith(".up.railway.app"):
        public_scheme = "https"
    public_base = f"{public_scheme}://{public_host}".rstrip("/")
    recommendations = []
    for recipe in response.recommendations:
        image_url = hosted_recipe_image_path(recipe.image_url)
        if image_url.startswith("/"):
            image_url = f"{public_base}{image_url}"
        recommendations.append(recipe.model_copy(update={"image_url": image_url}))
    return response.model_copy(update={"recommendations": recommendations})


def _run_recognition_job(
    image: Image.Image,
    engine: RecognitionEngine,
    progress,
) -> UUID:
    started = perf_counter()
    inference_image = _prepare_inference_image(image)
    progress("model_inference", 0.25)
    runtime = (
        get_model_runtime()
        if engine is RecognitionEngine.local
        else get_api_recognition_runtime()
    )
    model_id, items, warnings, attempts = _generate_validated(runtime, inference_image)
    progress("validating_and_saving_review", 0.9)
    response = _save_analysis_result(
        image, model_id, items, warnings, attempts, started
    )
    return response.analysis_id


@app.post(
    "/v1/recognition-jobs",
    response_model=RecognitionJobResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
async def create_recognition_job(
    engine: RecognitionEngine = RecognitionEngine.local,
    file: UploadFile = File(...),
) -> RecognitionJobResponse:
    """Queue a long inference call and return immediately with a pollable job ID."""

    image = await _read_uploaded_image(file)
    manager = get_recognition_job_manager()
    try:
        job = manager.create(engine)
    except RecognitionJobQueueFullError as exc:
        raise HTTPException(status_code=429, detail=str(exc)) from exc
    manager.submit(
        job.job_id,
        lambda progress: _run_recognition_job(image, engine, progress),
    )
    return job


@app.get(
    "/v1/recognition-jobs/{job_id}",
    response_model=RecognitionJobResponse,
)
def get_recognition_job(job_id: UUID) -> RecognitionJobResponse:
    try:
        return get_recognition_job_manager().get(job_id)
    except RecognitionJobNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Recognition job not found.") from exc


@app.get("/v1/photo-entries/{analysis_id}", response_model=AnalysisResponse)
def get_analysis(analysis_id: UUID) -> AnalysisResponse:
    try:
        return get_repository().get_analysis(analysis_id)
    except AnalysisNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Analysis not found.") from exc


@app.get("/v1/photo-entries/{analysis_id}/image", response_class=Response)
def get_analysis_image(analysis_id: UUID) -> Response:
    try:
        content, media_type = get_repository().get_analysis_image(analysis_id)
    except AnalysisNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Analysis not found.") from exc
    except AnalysisImageNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Review image is unavailable.") from exc
    return Response(
        content=content,
        media_type=media_type,
        headers={"Cache-Control": "private, no-store"},
    )


@app.head("/v1/photo-entries/{analysis_id}/image", response_class=Response)
def head_analysis_image(analysis_id: UUID) -> Response:
    try:
        content, media_type = get_repository().get_analysis_image(analysis_id)
    except AnalysisNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Analysis not found.") from exc
    except AnalysisImageNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Review image is unavailable.") from exc
    return Response(
        content=b"",
        media_type=media_type,
        headers={
            "Cache-Control": "private, no-store",
            "Content-Length": str(len(content)),
        },
    )


@app.get(
    "/v1/photo-entries/{analysis_id}/review",
    response_model=ReviewDraftResponse,
)
def get_review(analysis_id: UUID) -> ReviewDraftResponse:
    try:
        return get_repository().get_review(analysis_id)
    except AnalysisNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Analysis not found.") from exc


@app.put(
    "/v1/photo-entries/{analysis_id}/review",
    response_model=ReviewDraftResponse,
)
def save_review(analysis_id: UUID, request: SaveReviewRequest) -> ReviewDraftResponse:
    try:
        return get_repository().save_review(analysis_id, request)
    except AnalysisNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Analysis not found.") from exc
    except (AnalysisAlreadyConfirmedError, ReviewRevisionConflictError) as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except InvalidReviewError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.post("/v1/photo-entries/{analysis_id}/confirm", response_model=ConfirmationResponse)
def confirm_analysis(analysis_id: UUID, request: ConfirmReviewRequest) -> ConfirmationResponse:
    try:
        return get_repository().confirm(analysis_id, request)
    except AnalysisNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Analysis not found.") from exc
    except AnalysisAlreadyConfirmedError as exc:
        raise HTTPException(status_code=409, detail="Analysis has already been confirmed.") from exc
    except ReviewRevisionConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except InvalidReviewError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.get(
    "/v1/photo-entries/{analysis_id}/review-history",
    response_model=ReviewHistoryResponse,
)
def review_history(analysis_id: UUID) -> ReviewHistoryResponse:
    try:
        return get_repository().get_review_history(analysis_id)
    except AnalysisNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Analysis not found.") from exc


@app.get("/v1/inventory", response_model=list[InventoryEntry])
def active_inventory() -> list[InventoryEntry]:
    return get_repository().list_active_inventory()


@app.get("/v1/review-metrics", response_model=ReviewMetricsResponse)
def review_metrics() -> ReviewMetricsResponse:
    return get_repository().review_metrics()


@app.get(
    "/v1/review-metrics/confidence-bins",
    response_model=ConfidenceDiagnosticsResponse,
)
def confidence_diagnostics() -> ConfidenceDiagnosticsResponse:
    return get_repository().confidence_diagnostics()


@app.get("/v1/products/barcode/{barcode}")
async def product_by_barcode(barcode: str) -> dict:
    try:
        return await lookup_barcode(barcode, get_settings().off_timeout_seconds)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Product not found in Open Food Facts.") from exc
    except ProductLookupError as exc:
        raise HTTPException(status_code=503, detail="Open Food Facts is temporarily unavailable.") from exc
