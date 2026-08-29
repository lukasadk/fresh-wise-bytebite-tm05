from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.routers import dashboard, diet, logs, pantry, recipes, reference, users
from app.security import ApiKeyMiddleware, RateLimitMiddleware

settings = get_settings()

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


@app.get("/health", tags=["health"])
async def health():
    return {"status": "ok"}
