"""The REAL lookup_foodkeeper() query against the REAL FoodKeeper CSV in SQLite.

Exists because free-text matching against a fixed USDA catalogue is where this
feature actually breaks, and the failures are unobvious: "fresh milk" landed on
`fresh pasta`, because the ranking treated the FIRST word as the head noun and
"fresh" also opens `fresh lobster tails`, `fresh clams ...`.

  python backend/scripts/verify_lookup.py
"""
import asyncio, csv, os, sys

os.environ["DATABASE_URL"] = "sqlite+aiosqlite:///:memory:"
os.environ["DATABASE_URL_SYNC"] = "sqlite:///:memory:"
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

from sqlalchemy import Integer, Numeric
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from app.models import RefFoodkeeperStorage
from app.routers.reference import lookup_foodkeeper

CSV = os.environ.get(
    "FOODKEEPER_CSV",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..",
                 "freshwise-docs", "core_data_v2", "foodkeeper_storage.csv"),
)

passed = failed = 0


def check(name, cond, detail=""):
    global passed, failed
    if cond:
        passed += 1
    else:
        failed += 1
        print(f"  FAIL {name}" + (f" -- {detail}" if detail else ""))


def load_rows():
    coltypes = {c.name: c.type for c in RefFoodkeeperStorage.__table__.columns}
    out = []
    with open(CSV, newline="", encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            d = {}
            for k, v in r.items():
                if k not in coltypes or k == "fetched_at_utc":
                    continue
                if v == "":
                    d[k] = None
                elif isinstance(coltypes[k], (Numeric, Integer)):
                    try:
                        d[k] = float(v)
                    except ValueError:
                        d[k] = None
                else:
                    d[k] = v
            if d.get("foodkeeper_id") is None or not d.get("canonical_food_name"):
                continue
            d["foodkeeper_id"] = int(d["foodkeeper_id"])
            if d.get("category_id") is not None:
                d["category_id"] = int(d["category_id"])
            out.append(RefFoodkeeperStorage(**d))
    return out


async def main():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(lambda c: RefFoodkeeperStorage.__table__.create(c))
    Session = async_sessionmaker(engine, expire_on_commit=False)

    async with Session() as s:
        rows = load_rows()
        s.add_all(rows)
        await s.commit()
        print(f"loaded {len(rows)} rows\n")

        async def top(q, n=3):
            res = await lookup_foodkeeper(canonical_food_name=q, db=s)
            return [r.canonical_food_name for r in res][:n]

        print("== the reported bug: a leading adjective hijacked the match ==")
        for q, want in [
            ("fresh milk", "milk"),
            ("fresh chicken", "chicken"),
            ("fresh fish", "fish"),
            ("fresh beef", "beef"),
        ]:
            t = await top(q)
            check(f"'{q}' leads with a {want} row", bool(t) and want in t[0], f"got {t}")
            check(f"'{q}' does not lead with fresh pasta", not t or t[0] != "fresh pasta", f"got {t}")
            print(f"   {q:16s} -> {t}")

        print("\n== other adjective-first phrasings users actually type ==")
        for q, want in [
            ("whole chicken", "chicken"),
            ("ground beef", "beef"),
            ("raw chicken", "chicken"),
            ("cooked rice", "rice"),
        ]:
            t = await top(q)
            check(f"'{q}' leads with a {want} row", bool(t) and want in t[0], f"got {t}")
            print(f"   {q:16s} -> {t}")

        print("\n== head-initial cases must NOT regress ==")
        t = await top("chicken breast")
        check("'chicken breast' still avoids the stuffed product",
              bool(t) and t[0] != "stuffed raw chicken breasts", f"got {t}")
        check("'chicken breast' still finds a real breast row",
              any("chicken parts breast halves" in x for x in t), f"got {t}")
        print(f"   chicken breast   -> {t}")
        for q, want in [("beef steak", "beef steaks"), ("chicken thigh", "chicken parts legs or thighs"),
                        ("pork chop", "pork loin chops")]:
            t = await top(q)
            check(f"'{q}' still leads correctly", bool(t) and want in t[0], f"got {t}")
            print(f"   {q:16s} -> {t}")

        print("\n== single-word and exact lookups unchanged ==")
        for q, want in [("egg", "egg"), ("tomato", "tomato"), ("milk", "milk"), ("beef", "beef"),
                        ("rice", "rice"), ("fish", "fish")]:
            t = await top(q)
            check(f"'{q}' still matches", bool(t) and any(want in x for x in t), f"got {t}")
        exact = await lookup_foodkeeper(canonical_food_name="beef steaks", db=s)
        check("an exact key still returns exactly that row",
              len(exact) == 1 and exact[0].canonical_food_name == "beef steaks",
              f"got {[x.canonical_food_name for x in exact]}")

        print("\n== nothing sensible returns nothing ==")
        for q in ["fresh milk", "whole chicken", "fish fillet", "chicken breast", "ground beef"]:
            check(f"'{q}' returns at least one candidate", len(await top(q)) > 0)

        print(f"\n{passed} passed, {failed} failed")
        return 1 if failed else 0


sys.exit(asyncio.run(main()))
