"""Read-only dump of what's actually in the database.

Prints the households, their pantry, and every consumption/waste log -- i.e.
exactly what your app testing produced. Writes nothing.

Usage (from the backend/ folder, venv active):
    python scripts/show_data.py
"""
import asyncio
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import text  # noqa: E402

from app.config import get_settings  # noqa: E402
from app.db import engine  # noqa: E402


def mask(url: str) -> str:
    return re.sub(r"://([^:]+):([^@]+)@", r"://\1:****@", url)


async def main() -> int:
    print("Target:", mask(get_settings().database_url))
    print()

    async with engine.connect() as conn:
        print("=" * 78)
        print("HOUSEHOLDS (one per device that has opened the app)")
        print("=" * 78)
        households = (await conn.execute(text(
            "SELECT user_id, household_size, location, risk_score, created_at "
            "FROM user_profile ORDER BY created_at"))).all()
        if not households:
            print("  none yet -- the app has never completed its registration handshake")
        for h in households:
            print("  %s  size=%s  location=%s  risk=%s  created=%s"
                  % (str(h.user_id)[:8] + "...", h.household_size, h.location or "-",
                     h.risk_score, h.created_at.strftime("%Y-%m-%d %H:%M")))
        print()

        print("=" * 78)
        print("PANTRY  (Epic 1 + Epic 2 -- what you added, and its expiry state)")
        print("=" * 78)
        items = (await conn.execute(text(
            "SELECT name, category, quantity, unit, expiry_date, status, storage, source, "
            "       (expiry_date - CURRENT_DATE) AS days_left "
            "FROM food_item ORDER BY expiry_date NULLS LAST, name"))).all()
        if not items:
            print("  empty -- nothing has been added from the app yet")
        else:
            print("  %-18s %-12s %10s  %-11s %-6s %-14s %s"
                  % ("NAME", "CATEGORY", "QTY", "EXPIRES", "DAYS", "STATUS", "STORAGE"))
            print("  " + "-" * 74)
            for i in items:
                qty = "%s %s" % (i.quantity, i.unit or "")
                days = "-" if i.days_left is None else str(i.days_left)
                if i.days_left is not None:
                    band = "USE TODAY" if i.days_left <= 0 else ("use soon" if i.days_left <= 3 else "fresh")
                else:
                    band = "no date"
                print("  %-18s %-12s %10s  %-11s %-6s %-14s %-12s [%s]"
                      % (i.name[:18], (i.category or "-")[:12], qty, i.expiry_date or "-",
                         days, i.status, i.storage or "-", band))
        print()

        print("=" * 78)
        print("CONSUMPTION / WASTE LOG  (Epic 3 -- every outcome you recorded)")
        print("=" * 78)
        logs = (await conn.execute(text(
            "SELECT fi.name, l.status, l.quantity, fi.unit, l.waste_reason, l.notes, l.logged_at "
            "FROM consumption_waste_log l JOIN food_item fi ON fi.item_id = l.item_id "
            "ORDER BY l.logged_at DESC"))).all()
        if not logs:
            print("  empty -- nothing marked consumed or wasted yet")
        for l in logs:
            line = "  %s  %-9s %-18s %s %s" % (
                l.logged_at.strftime("%Y-%m-%d %H:%M"), l.status.upper(),
                l.name[:18], l.quantity, l.unit or "")
            if l.waste_reason:
                line += "  reason=%s" % l.waste_reason
            if l.notes:
                line += '  note="%s"' % l.notes
            print(line)
        print()

        print("=" * 78)
        print("TOTALS")
        print("=" * 78)
        totals = (await conn.execute(text(
            "SELECT status, COUNT(*) AS events, SUM(quantity) AS qty "
            "FROM consumption_waste_log GROUP BY status"))).all()
        if not totals:
            print("  nothing logged yet")
        for row in totals:
            print("  %-9s %s events, %s total quantity" % (row.status, row.events, row.qty))

        ref = (await conn.execute(text("SELECT COUNT(*) FROM ref_foodkeeper_storage"))).scalar_one()
        print()
        print("  ref_foodkeeper_storage: %d rows%s" % (
            ref, "  <-- EMPTY: storage guidance will be blank in the app" if ref == 0 else ""))

    await engine.dispose()
    return 0


raise SystemExit(asyncio.run(main()))
