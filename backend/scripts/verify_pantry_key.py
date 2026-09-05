"""The canonical_food_name rules, through the REAL create/patch handlers and the
REAL FoodKeeper lookup, against the REAL dataset.

Covers the two behaviours that pull against each other:
  * a rename re-points the lookup, so Edit repairs a typo;
  * a food the user PICKED in the guidance sheet outranks that, so a later
    rename doesn't silently throw their choice away.
"""
import asyncio, csv, os, sys, uuid

os.environ["DATABASE_URL"] = "sqlite+aiosqlite:///:memory:"
os.environ["DATABASE_URL_SYNC"] = "sqlite:///:memory:"
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

from sqlalchemy import Integer, Numeric
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from app.models import ConsumptionWasteLog, FoodItem, RefFoodkeeperStorage, UserProfile
from app.routers.pantry import create_pantry_item, update_pantry_item
from app.routers.reference import lookup_foodkeeper
from app.schemas import FoodItemCreate, FoodItemUpdate

# freshwise-docs lives beside the repo, not in it (see repo conventions), so the
# dataset is located relative to the repo root and overridable for other setups.
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
        for t in (
            UserProfile.__table__, FoodItem.__table__,
            ConsumptionWasteLog.__table__, RefFoodkeeperStorage.__table__,
        ):
            await conn.run_sync(lambda c, t=t: t.create(c))
    Session = async_sessionmaker(engine, expire_on_commit=False)

    async with Session() as s:
        s.add_all(load_rows())
        user = UserProfile(user_id=uuid.uuid4(), household_size=2, risk_score="low")
        s.add(user)
        await s.commit()

        async def key_of(item_id):
            # No expire_all() here: the session uses expire_on_commit=False and
            # the handlers mutate these very objects, so the in-memory value is
            # already what was committed. Expiring would trigger a lazy reload
            # outside the async context and blow up with MissingGreenlet.
            return (await s.get(FoodItem, item_id)).canonical_food_name

        async def guidance_count(item_id):
            k = await key_of(item_id)
            return 0 if not k else len(await lookup_foodkeeper(canonical_food_name=k, db=s))

        async def new_item(**kw):
            return await create_pantry_item(FoodItemCreate(quantity=1, **kw), user=user, db=s)

        async def patch(item_id, **kw):
            return await update_pantry_item(item_id, FoodItemUpdate(**kw), user=user, db=s)

        print("== rename still repairs a typo ==")
        typo = await new_item(name="Chiken breast")
        check("typo yields no guidance", await guidance_count(typo.item_id) == 0)
        await patch(typo.item_id, name="Chicken breast")
        check("rename re-derives the key", await key_of(typo.item_id) == "chicken breast",
              await key_of(typo.item_id))
        check("rename now yields guidance", await guidance_count(typo.item_id) > 0)

        print("\n== the picker's choice is stored ==")
        ikan = await new_item(name="Ikan")
        check("free text 'Ikan' matches nothing", await guidance_count(ikan.item_id) == 0)
        chosen = "lean fish cod flounder haddock halibut sole etc."
        await patch(ikan.item_id, canonical_food_name=chosen)
        check("the pick is stored", await key_of(ikan.item_id) == chosen, await key_of(ikan.item_id))
        check("the pick yields guidance", await guidance_count(ikan.item_id) > 0)

        print("\n== and it survives a later rename ==")
        await patch(ikan.item_id, name="Ikan merah")
        check("rename does NOT clobber the chosen food",
              await key_of(ikan.item_id) == chosen, await key_of(ikan.item_id))
        check("guidance still resolves after the rename",
              await guidance_count(ikan.item_id) > 0)
        check("the display name did change", (await s.get(FoodItem, ikan.item_id)).name == "Ikan merah")

        print("\n== a pick can itself be corrected ==")
        second = "fish hot smoked air pack"
        await patch(ikan.item_id, canonical_food_name=second)
        check("re-picking overwrites the previous choice",
              await key_of(ikan.item_id) == second, await key_of(ikan.item_id))

        print("\n== picks are normalised like derived keys ==")
        messy = await new_item(name="Beef")
        await patch(messy.item_id, canonical_food_name="  BEEF Steaks  ")
        check("a pick is trimmed and lowercased",
              await key_of(messy.item_id) == "beef steaks", await key_of(messy.item_id))

        print("\n== unrelated patches leave the key alone ==")
        plain = await new_item(name="Beef steaks")
        await patch(plain.item_id, quantity=5)
        check("quantity-only patch keeps the key",
              await key_of(plain.item_id) == "beef steaks", await key_of(plain.item_id))
        await patch(plain.item_id, storage="frozen")
        check("storage-only patch keeps the key",
              await key_of(plain.item_id) == "beef steaks", await key_of(plain.item_id))

        print("\n== renaming an unchosen item keeps re-deriving ==")
        drifting = await new_item(name="Beef steaks")
        await patch(drifting.item_id, name="Chicken whole")
        check("still auto-derived, so it follows the name",
              await key_of(drifting.item_id) == "chicken whole", await key_of(drifting.item_id))
        await patch(drifting.item_id, name="Beef ground")
        check("and keeps following it on the next rename",
              await key_of(drifting.item_id) == "beef ground", await key_of(drifting.item_id))

        print(f"\n{passed} passed, {failed} failed")
        return 1 if failed else 0


sys.exit(asyncio.run(main()))
