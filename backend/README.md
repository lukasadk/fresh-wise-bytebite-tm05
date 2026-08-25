# FreshWise API

FastAPI backend for the FreshWise household food-waste app (SDG 12).
Lives in this `backend/` folder inside the `freshwise` repo, alongside the
Expo app's own source, so it's tracked by the same git repo. Talks to the
Postgres 18 database on the Synology NAS. Matches `../db/erd-schema.sql`
(at the repo root, in `db/`) field-for-field.

## Identity model -- read this first

There is **no login, account, or credential anywhere**. Every request
identifies itself with the `X-Device-Id` header: a UUID the client app
generates once on first launch (`crypto.randomUUID()`) and persists
locally. The server never issues or checks a password -- see
`database-schema-no-pii.md` in the project docs for the full rationale
and the PII-taxonomy check this schema was designed against.

Flow for a new device:
1. `POST /v1/users` with `{"user_id": "<generated-uuid>", "household_size": N}` --
   creates the profile once; safe to call again (get-or-create, never overwrites).
2. Every other request sends `X-Device-Id: <same uuid>`.

## Project layout

```
app/
  main.py          FastAPI app + router registration
  config.py        env-based settings (pydantic-settings, reads .env)
  db.py             async SQLAlchemy engine/session
  models.py         SQLAlchemy models -- mirrors db/erd-schema.sql exactly
  schemas.py        Pydantic request/response models
  deps.py           device-id auth dependency
  routers/
    users.py         device identity handshake
    pantry.py        food_item CRUD (Pantry/AddFood/FoodDetail/UseFirst screens)
    logs.py          consumption_waste_log (Epic 1: record consumed/wasted + why)
    dashboard.py     weekly_waste_summary + rollup stats (Epic 2: insights dashboard)
    diet.py          diet_preference CRUD (religion-tag guard enforced here + DB CHECK)
    recipes.py       ingredient-based recipe recommendations + detail lookup
    reference.py     read-only FoodKeeper/PriceCatcher/Open Food Facts lookups
scripts/
  db_conn.py                  shared sync DB connection helper (used by the below)
  apply_schema.py              applies db/erd-schema.sql to a fresh database
  ingest_reference_data.py     streaming CSV -> ref_* table loaders
tests/                         pytest integration suite (needs a real Postgres)
```

## Setup

```bash
python3 -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
# edit .env -- set DB_USER, DB_PASSWORD, NAS_TAILSCALE_IP, see below
```

### Pointing `.env` at your database

For local development, point both `DATABASE_URL` and `DATABASE_URL_SYNC`
at any Postgres 14+ you have (a local install, or `docker run -p 5432:5432
postgres:16`). For the real deployment, point them at the Synology NAS
over your Tailscale network -- `DATABASE_URL` is used by the async API
(asyncpg driver), `DATABASE_URL_SYNC` by the one-shot scripts below
(psycopg driver, used for its fast COPY support). Same database, two
driver dialects, hence two URLs.

This API was developed and integration-tested against a throwaway local
Postgres 16 instance -- it was never run against your NAS from here,
since the NAS is Tailscale-only and only reachable from your own
network. Point `.env` at the NAS and re-run `scripts/apply_schema.py`
there before going further.

## First-time database setup

```bash
# 1. Create the schema (fresh DB only -- see the script's docstring)
python scripts/apply_schema.py ../db/erd-schema.sql

# 2. Load the reference datasets (FoodKeeper, PriceCatcher, Open Food
#    Facts MY, Food.com recipe index + detail) from freshwise-docs/core_data
python scripts/ingest_reference_data.py all ../../freshwise-docs/core_data/core_data --truncate
```

Timing observed loading all five CSVs against a local Postgres:
foodkeeper/price/openfoodfacts (small, together < 1,100 rows) load in
under a second each; `foodcom_recipe_index_clean.csv` (488,740 rows,
~230MB) took ~30 seconds; `foodcom_recipe_ingredients_clean.csv` is the
same row count but much larger per-row (steps/ingredients_raw text), so
budget more -- run it and let it finish rather than assuming it hung.
Both loaders are streaming (constant memory, not "load the whole file
then insert"), so they don't need a bigger machine, just time and,
for the real run, whatever network latency exists to the NAS.

Loading a single file, or testing on a subset first:

```bash
python scripts/ingest_reference_data.py recipe-index /path/to/foodcom_recipe_index_clean.csv --limit 5000
```

**Order matters for "all" only if you call the individual loaders
yourself**: `recipe-index` must run before `recipe-detail` (the latter's
`recipe_id` is a foreign key into the former).

## Running the API

```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Interactive API docs: `http://localhost:8000/docs`. Health check:
`GET /health`.

For the Expo app to reach this from a phone/simulator on the same
network, use your machine's LAN IP instead of `localhost` in the app's
API base URL, and open port 8000 if a firewall is in the way. When the
NAS is the target instead of your dev machine, the app should point at
wherever this API is actually deployed (e.g. run as a Container Manager
task alongside Postgres) -- not at the NAS's Postgres port directly.

## Running tests

```bash
pytest -v
```

These are integration tests against a **real** Postgres (the schema
relies on native enums, JSONB, `TEXT[]` + GIN indexes, and CHECK
constraints that don't have a meaningful SQLite equivalent) -- point
`.env` at a throwaway/dev database first. Every test truncates
`user_profile`, `food_item`, `consumption_waste_log`, and
`diet_preference` beforehand, so **never run this against data you
care about**. The `ref_*` reference tables are left alone.

## Endpoint reference

| Method & path | Purpose |
|---|---|
| `POST /v1/users` | Register a device UUID (get-or-create) |
| `GET /v1/users/me` | Current device's profile |
| `PATCH /v1/users/me` | Update household_size / location |
| `DELETE /v1/users/me` | Delete profile + cascade all its data |
| `GET /v1/pantry` | List food items (`?status=`, `?expiring_within_days=`) |
| `POST /v1/pantry` | Add a food item |
| `GET /v1/pantry/{id}` | Get one food item |
| `PATCH /v1/pantry/{id}` | Edit a food item |
| `DELETE /v1/pantry/{id}` | Remove a food item |
| `POST /v1/logs` | Record consumed/wasted outcome (auto-updates the item) |
| `GET /v1/logs` | List logs (`?item_id=`, `?status=`, `?since=`, `?until=`) |
| `GET /v1/dashboard/weekly-waste` | Weekly waste breakdown by reason |
| `GET /v1/dashboard/summary` | Rolled-up totals + waste rate + top reasons |
| `GET /v1/diet-preferences` | List saved diet tags |
| `POST /v1/diet-preferences` | Save a tag (religion-linked tags rejected, 422) |
| `DELETE /v1/diet-preferences/{id}` | Remove a saved tag |
| `GET /v1/recipes/recommendations` | Ingredient-matched recipes, ranked (`?diet_tags=`, `?limit=`) |
| `GET /v1/recipes/{recipe_id}` | Full ingredients/steps for one recipe |
| `GET /v1/reference/foodkeeper` | Storage guidance by `canonical_food_name` |
| `GET /v1/reference/price` | Malaysia market price reference |
| `GET /v1/reference/product/{barcode}` | Open Food Facts product lookup |

Full request/response schemas: `/docs` (Swagger) once the server is running.

## Known limitations / next steps

These are flagged deliberately, not overlooked -- carried over from the
project's own docs (`database-schema-no-pii.md`,
`CORE_README.md`/`DATA_RELATIONSHIPS.md`):

- **Ingredient matching is approximate.** `canonical_food_name` (pantry)
  and `ingredient_tokens` (recipes) are matched by exact-then-substring
  text comparison, not a real synonym/semantic mapping -- CORE_README.md
  already flags `canonical_food_name` as "a preliminary normalization,
  not a perfect semantic match." Good enough for a demo; a curated
  mapping table is the documented next step.
- **No unit-aware quantity sufficiency check** in recipe scoring (e.g.
  "you have enough flour") -- the Food.com dataset only has free-text
  ingredient lines, not structured quantities, so this is approximated
  as "ingredient is in stock" rather than "enough of it is in stock."
- **No live third-party recipe API** (Spoonacular/Edamam) wired in yet --
  this build uses the free Food.com dataset per the "fastest path to a
  working demo" recommendation in the recipe-epic reference doc.
  Swapping in a live API later only touches `routers/recipes.py` and
  the ingestion step, not the schema or the rest of the API.
- **No Alembic migration history yet** -- `db/erd-schema.sql` is the source
  of truth for the current schema; Alembic is in `requirements.txt` for
  when the schema needs to evolve without a full re-apply.
- **Least-privilege DB role** (`freshwise_app`, scoped grants) and
  `pg_hba.conf` scoping to the Tailscale interface are still open items
  on the NAS side per database-schema-no-pii.md -- this API assumes
  whatever role you put in `.env` already has the right grants.
