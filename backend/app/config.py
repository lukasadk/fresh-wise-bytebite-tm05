"""Environment-based settings.

Nothing in this file talks to a database directly -- it just reads
connection info from the environment (.env locally, real env vars in
whatever hosts this later). This is deliberate: this API is developed
and tested against a local/throwaway Postgres, and the real target
(the Synology NAS over Tailscale) is only reachable from your own
machine/network, never from wherever this was authored.
"""
from functools import lru_cache

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


def _with_driver(url: str, driver: str) -> str:
    """Force a SQLAlchemy driver onto a plain Postgres URL.

    Managed platforms (Railway, Render, Heroku, Neon, Supabase) hand out
    `postgresql://user:pass@host/db` -- and Heroku-lineage ones still use the
    legacy `postgres://` scheme. SQLAlchemy needs an explicit driver, so
    without this the app boots and dies on the first query with
    "Can't load plugin: sqlalchemy.dialects:postgres".
    """
    scheme, _, rest = url.partition("://")
    if not rest:
        return url
    base = scheme.split("+", 1)[0]
    if base == "postgres":       # legacy Heroku-style scheme
        base = "postgresql"
    return f"{base}+{driver}://{rest}"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    database_url: str = "postgresql+asyncpg://freshwise_app:changeme@localhost:5432/freshwise"
    database_url_sync: str = "postgresql+psycopg://freshwise_app:changeme@localhost:5432/freshwise"

    device_id_header: str = "X-Device-Id"
    cors_origins: str = "http://localhost:19006,http://localhost:8081"
    environment: str = "development"

    # --- Public-deployment hardening (all OFF by default) ------------------
    # Empty api_key disables the key check; 0 disables rate limiting. That
    # keeps local development working exactly as before -- these only switch
    # on where they're set, i.e. a public deployment's environment.
    api_key: str = ""
    api_key_header: str = "X-API-Key"
    rate_limit_per_minute: int = 0
    # Only true when something trusted (Railway's edge, a Cloudflare/Tailscale
    # tunnel, a reverse proxy) really is in front, because it makes the rate
    # limiter believe X-Forwarded-For -- which a direct caller could forge.
    trust_proxy_headers: bool = False

    @model_validator(mode="after")
    def _normalise_database_urls(self):
        """Accept a driverless DATABASE_URL and derive both forms from it.

        Locally, .env sets both URLs explicitly and this leaves them alone. On
        a managed platform only DATABASE_URL is injected (with no driver and no
        sync counterpart), so async gets asyncpg, and the sync URL -- used by
        the schema/ingest scripts -- is derived from the same credentials
        rather than silently staying on its localhost default.
        """
        if "+" not in self.database_url.partition("://")[0]:
            raw = self.database_url
            self.database_url = _with_driver(raw, "asyncpg")
            # Only derive the sync URL if the environment didn't set one, so an
            # explicit DATABASE_URL_SYNC is never overwritten.
            if "database_url_sync" not in self.model_fields_set:
                self.database_url_sync = _with_driver(raw, "psycopg")
        return self

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
