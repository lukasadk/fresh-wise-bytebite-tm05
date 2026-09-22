import mimetypes
from pathlib import Path

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text

from app.auto_waste import run_daily_auto_waste_expired
from app.config import get_settings
from app.db import AsyncSessionLocal, engine
from app.notifications import run_daily_expiry_check
from app.routers import dashboard, diet, logs, pantry, recipes, reference, users
from app.security import ApiKeyMiddleware, RateLimitMiddleware
from wastewise_grocery_vlm.main import app as grocery_ai_app

settings = get_settings()
mimetypes.add_type("application/vnd.android.package-archive", ".apk")

# Interactive docs are handy in development but hand an attacker a map of
# every endpoint on a public host, so they're switched off in production.
_is_production = settings.environment.lower() == "production"

app = FastAPI(
    title="FreshWise API",
    description=(
        "Backend for the FreshWise household food-waste app (SDG 12). "
        "No login/accounts anywhere -- identity is a client-generated device "
        "UUID sent via the X-Device-Id header. See database-schema-no-pii.md "
        "in the project docs for the full rationale."
    ),
    version="0.1.0",
    docs_url=None if _is_production else "/docs",
    redoc_url=None if _is_production else "/redoc",
    openapi_url=None if _is_production else "/openapi.json",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Starlette runs the LAST-added middleware first, so the rate limiter is added
# after the key check and therefore runs before it. That ordering matters: a
# flood of wrong-key requests should be throttled too, not just counted.
app.add_middleware(
    ApiKeyMiddleware,
    api_key=settings.api_key,
    header_name=settings.api_key_header,
)
app.add_middleware(
    RateLimitMiddleware,
    limit_per_minute=settings.rate_limit_per_minute,
    trust_proxy=settings.trust_proxy_headers,
)

app.include_router(users.router)
app.include_router(pantry.router)
app.include_router(logs.router)
app.include_router(dashboard.router)
app.include_router(diet.router)
app.include_router(recipes.router)
app.include_router(reference.router)

AI_GATEWAY_ROUTE_PREFIXES = (
    "/v1/api-recognition/",
    "/v1/recipe-rag/",
    "/v1/photo-entries/",
    "/v1/expiry-estimates",
)
for route in grocery_ai_app.router.routes:
    route_path = getattr(route, "path", "")
    if route_path.startswith(AI_GATEWAY_ROUTE_PREFIXES):
        app.router.routes.append(route)

STATIC_DIR = Path(__file__).resolve().parent / "static"
STATIC_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


async def _run_auto_waste_job() -> None:
    async with AsyncSessionLocal() as db:
        wasted = await run_daily_auto_waste_expired(db)
        print(f"[auto-waste] auto-wasted {wasted} item(s)")


async def _run_expiry_check_job() -> None:
    async with AsyncSessionLocal() as db:
        sent = await run_daily_expiry_check(db)
        print(f"[expiry-check] sent {sent} notification(s)")


async def _run_daily_jobs() -> None:
    # Auto-waste runs first and fully commits (separate DB session, closed
    # before this returns) before the reminder check starts. That ordering
    # matters: an item auto-wasted just now has status='wasted' by the time
    # expiry-check runs its query, so it's correctly excluded from "still
    # needs attention" reminders -- no confusing double-notification for the
    # same item on the day it was auto-recorded.
    await _run_auto_waste_job()
    await _run_expiry_check_job()


scheduler = AsyncIOScheduler()


async def _apply_initial_schema_if_needed() -> None:
    if not settings.auto_apply_schema:
        return

    schema_path = Path(__file__).resolve().parent / "schema" / "erd-schema.sql"
    if not schema_path.exists():
        raise RuntimeError(f"AUTO_APPLY_SCHEMA is enabled, but {schema_path} is missing.")

    async with engine.begin() as conn:
        exists = await conn.scalar(text("SELECT to_regclass('public.user_profile') IS NOT NULL"))
        if exists:
            return

        raw = await conn.get_raw_connection()
        await raw.driver_connection.execute(schema_path.read_text(encoding="utf-8"))
        print("[startup] applied initial database schema")


@app.on_event("startup")
async def start_scheduler():
    await _apply_initial_schema_if_needed()
    # Runs once daily at 08:00 server time. Change the hour to whatever suits
    # actual usage -- there's nothing special about 8am beyond "a reasonable
    # default for a morning check."
    scheduler.add_job(_run_daily_jobs, CronTrigger(hour=8, minute=0))
    scheduler.start()


@app.on_event("shutdown")
async def stop_scheduler():
    scheduler.shutdown(wait=False)


@app.post("/v1/notifications/run-check", tags=["notifications"])
async def trigger_expiry_check_now():
    """Manual trigger for testing -- runs the exact same reminder job the
    daily scheduler runs, on demand, instead of waiting up to 24 hours to see
    if notifications actually work end to end. Already protected by
    ApiKeyMiddleware above like every other route, so this no longer needs
    its own separate auth check the way it did before that middleware existed."""
    async with AsyncSessionLocal() as db:
        sent = await run_daily_expiry_check(db)
    return {"notifications_sent": sent}


@app.post("/v1/notifications/run-auto-waste", tags=["notifications"])
async def trigger_auto_waste_now():
    """Manual trigger for testing the auto-waste job independently of the
    reminder check, on demand. Same auth story as run-check above."""
    async with AsyncSessionLocal() as db:
        wasted = await run_daily_auto_waste_expired(db)
    return {"items_auto_wasted": wasted}


@app.get("/health", tags=["health"])
async def health():
    return {"status": "ok"}
