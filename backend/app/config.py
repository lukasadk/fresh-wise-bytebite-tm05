"""Environment-based settings.

Nothing in this file talks to a database directly -- it just reads
connection info from the environment (.env locally, real env vars in
whatever hosts this later). This is deliberate: this API is developed
and tested against a local/throwaway Postgres, and the real target
(the Synology NAS over Tailscale) is only reachable from your own
machine/network, never from wherever this was authored.
"""
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    database_url: str = "postgresql+asyncpg://freshwise_app:changeme@localhost:5432/freshwise"
    database_url_sync: str = "postgresql+psycopg://freshwise_app:changeme@localhost:5432/freshwise"

    device_id_header: str = "X-Device-Id"
    cors_origins: str = "http://localhost:19006,http://localhost:8081"
    environment: str = "development"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
