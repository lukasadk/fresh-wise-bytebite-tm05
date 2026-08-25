"""Integration test fixtures.

These tests run against a real Postgres database (DATABASE_URL in your
.env) -- not sqlite/mocks -- because the schema leans on Postgres-only
features (native enums, JSONB, TEXT[] + GIN indexes, CHECK constraints)
that don't have a meaningful sqlite equivalent. Point .env at a
throwaway/dev database before running `pytest`, never at data you care
about: every test truncates the core app tables between runs.
"""
import uuid
from collections.abc import AsyncGenerator

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from app.db import engine
from app.main import app

CORE_TABLES = ["consumption_waste_log", "food_item", "diet_preference", "user_profile"]


@pytest_asyncio.fixture(autouse=True)
async def _clean_core_tables():
    # pytest-asyncio gives each test function its own event loop by default,
    # but `engine`'s asyncpg connection pool is a module-level singleton that
    # binds itself to whichever loop is running the first time it's used.
    # Disposing it here forces fresh connections bound to *this* test's loop
    # instead of erroring with "attached to a different loop" on test #2+.
    await engine.dispose()
    async with engine.begin() as conn:
        await conn.execute(text(f"TRUNCATE TABLE {', '.join(CORE_TABLES)} CASCADE"))
    yield


@pytest_asyncio.fixture
async def client() -> AsyncGenerator[AsyncClient, None]:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


@pytest.fixture
def device_id() -> str:
    return str(uuid.uuid4())


@pytest_asyncio.fixture
async def registered_device(client: AsyncClient, device_id: str) -> str:
    resp = await client.post(
        "/v1/users", json={"user_id": device_id, "household_size": 2, "location": "Selangor"}
    )
    assert resp.status_code == 200
    return device_id
