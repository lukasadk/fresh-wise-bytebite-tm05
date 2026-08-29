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
    # DATABASE_URL_SYNC first, but fall back to DATABASE_URL: managed platforms
    # (Railway, Render, Neon...) inject only the latter, so without this fallback
    # these scripts fail with "not set" on a database that is in fact configured.
    url = os.environ.get("DATABASE_URL_SYNC") or os.environ.get("DATABASE_URL")
    if not url:
        print(
            "Neither DATABASE_URL_SYNC nor DATABASE_URL is set. Set one in "
            "backend/.env -- your Postgres connection details (the Synology NAS "
            "over Tailscale, a managed platform's URL, or a local/throwaway "
            "Postgres for testing).",
            file=sys.stderr,
        )
        sys.exit(1)
    # psycopg wants a plain postgresql:// DSN: strip any SQLAlchemy +driver
    # suffix, and upgrade the legacy Heroku-style postgres:// scheme.
    scheme, sep, rest = url.partition("://")
    if not sep:
        return url
    base = scheme.split("+", 1)[0]
    if base == "postgres":
        base = "postgresql"
    return f"{base}://{rest}"


def connect() -> psycopg.Connection:
    return psycopg.connect(get_sync_dsn())
