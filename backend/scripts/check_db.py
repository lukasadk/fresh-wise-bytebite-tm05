"""Connectivity + schema drift check for the FreshWise API.

Answers three questions, in order, and stops at the first failure:

  1. Can we reach the database at all, with the credentials in .env?
  2. Do the tables that actually exist match what app/models.py expects?
  3. How many rows are in each one?

Step 2 matters when the schema was created by hand in pgAdmin/psql rather
than by apply_schema.py -- a mistyped column name doesn't surface at
connect time, it surfaces as a 500 on some endpoint days later.

Usage (from the backend/ folder, venv active):
    python scripts/check_db.py
"""
import asyncio
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import inspect, text  # noqa: E402

from app.config import get_settings  # noqa: E402
from app.db import Base, engine  # noqa: E402
import app.models  # noqa: E402,F401  (registers every table on Base.metadata)

EXPECTED_VIEW = "weekly_waste_summary"


def mask(url: str) -> str:
    return re.sub(r"://([^:]+):([^@]+)@", r"://\1:****@", url)


async def main() -> int:
    settings = get_settings()
    print("Target :", mask(settings.database_url))
    print()

    # --- 1. can we connect? ---------------------------------------------
    try:
        async with engine.connect() as conn:
            version = (await conn.execute(text("SELECT version()"))).scalar_one()
            dbname = (await conn.execute(text("SELECT current_database()"))).scalar_one()
            whoami = (await conn.execute(text("SELECT current_user"))).scalar_one()
    except Exception as exc:  # noqa: BLE001
        print("[FAIL] Could not connect.")
        print(f"       {type(exc).__name__}: {exc}")
        print()
        print("       Common causes:")
        print("       - Ran from the wrong folder. .env is read relative to your")
        print("         working directory -- you must be in backend/.")
        print("       - NAS not reachable over Tailscale (try: tailscale ping <host>).")
        print("       - Postgres not listening on 0.0.0.0, or pg_hba.conf rejects")
        print("         your Tailscale subnet.")
        return 1

    print(f"[OK]   Connected as '{whoami}' to database '{dbname}'")
    print(f"       {version.split(',')[0]}")
    print()

    # --- 2. does the real schema match the models? -----------------------
    async with engine.connect() as conn:
        actual_tables = set(await conn.run_sync(lambda c: inspect(c).get_table_names()))
        actual_views = set(await conn.run_sync(lambda c: inspect(c).get_view_names()))
        actual_cols = {}
        for t in actual_tables:
            cols = await conn.run_sync(lambda c, t=t: inspect(c).get_columns(t))
            actual_cols[t] = {col["name"] for col in cols}

    expected = Base.metadata.tables
    missing_tables = sorted(set(expected) - actual_tables)
    problems = 0

    if missing_tables:
        problems += len(missing_tables)
        print("[FAIL] Tables the code expects but the database does not have:")
        for t in missing_tables:
            print(f"       - {t}")
        print()

    for name, table in sorted(expected.items()):
        if name in missing_tables:
            continue
        want = {c.name for c in table.columns}
        have = actual_cols[name]
        if want - have:
            problems += 1
            print(f"[FAIL] {name}: missing column(s) {sorted(want - have)}")
        if have - want:
            print(f"[warn] {name}: extra column(s) in DB, harmless {sorted(have - want)}")

    if EXPECTED_VIEW not in actual_views:
        problems += 1
        print(f"[FAIL] View '{EXPECTED_VIEW}' is missing -- GET /v1/dashboard will 500.")
        print("       It is defined near the bottom of db/erd-schema.sql.")

    if problems == 0:
        print(f"[OK]   All {len(expected)} tables and the '{EXPECTED_VIEW}' view match models.py")
    print()

    # --- 3. row counts ----------------------------------------------------
    print("Row counts:")
    async with engine.connect() as conn:
        for name in sorted(expected):
            if name in missing_tables:
                continue
            try:
                n = (await conn.execute(text(f'SELECT count(*) FROM "{name}"'))).scalar_one()
                print(f"       {name:<32} {n:>10,}")
            except Exception as exc:  # noqa: BLE001
                problems += 1
                print(f"       {name:<32} [FAIL] {type(exc).__name__}: {exc}")

    await engine.dispose()
    print()
    print("RESULT:", "everything looks good" if problems == 0 else f"{problems} problem(s) above")
    return 0 if problems == 0 else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
