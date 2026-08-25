"""Shared sync DB connection helper for scripts (schema apply + ingestion).

Uses psycopg (v3), not the app's async engine -- these are one-shot CLI
jobs, not request handlers, and psycopg's `copy` API is what makes the
bulk-load scripts fast.
"""
import os
import sys

import psycopg
from dotenv import load_dotenv

load_dotenv()


def get_sync_dsn() -> str:
    url = os.environ.get("DATABASE_URL_SYNC")
    if not url:
        print(
            "DATABASE_URL_SYNC is not set. Set it in backend/.env -- your "
            "Postgres connection details (the Synology NAS, reached over Tailscale, for "
            "the real run -- or a local/throwaway Postgres for testing).",
            file=sys.stderr,
        )
        sys.exit(1)
    # psycopg wants a plain postgresql:// DSN, not the +psycopg SQLAlchemy dialect suffix.
    return url.replace("postgresql+psycopg://", "postgresql://")


def connect() -> psycopg.Connection:
    return psycopg.connect(get_sync_dsn())
