#!/usr/bin/env python3
"""Applies erd-schema.sql to whatever DATABASE_URL_SYNC points at.

Usage:
    python scripts/apply_schema.py path/to/erd-schema.sql

Intended for a fresh database only -- CREATE TYPE / CREATE TABLE have no
"IF NOT EXISTS" equivalent for enums in Postgres, so re-running this
against a DB that already has the schema will fail partway through.
That's deliberate: it's a signal to use a migration tool (Alembic is
already in requirements.txt) for anything past the first apply, rather
than silently no-op-ing.
"""
import sys
from pathlib import Path

from db_conn import connect


def main() -> None:
    if len(sys.argv) != 2:
        print("Usage: python scripts/apply_schema.py path/to/erd-schema.sql", file=sys.stderr)
        sys.exit(1)

    schema_path = Path(sys.argv[1])
    sql = schema_path.read_text(encoding="utf-8")

    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(sql)
        conn.commit()

    print(f"Applied {schema_path} successfully.")


if __name__ == "__main__":
    main()
