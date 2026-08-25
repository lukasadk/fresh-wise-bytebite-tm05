from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.routers import dashboard, diet, logs, pantry, recipes, reference, users

settings = get_settings()

app = FastAPI(
    title="FreshWise API",
    description=(
        "Backend for the FreshWise household food-waste app (SDG 12). "
        "No login/accounts anywhere -- identity is a client-generated device "
        "UUID sent via the X-Device-Id header. See database-schema-no-pii.md "
        "in the project docs for the full rationale."
    ),
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
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
