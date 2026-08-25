# FreshWise

Household food-waste reduction app for **UN SDG 12 (Responsible Consumption
and Production)**.

FreshWise is one product made of two runnable applications that talk to each
other over HTTP, kept in a single repo so they version together:

1. **The mobile app** (repo root + `src/`) — React Native / Expo, TypeScript.
   What the user actually taps: pantry, expiry warnings, logging food as
   consumed or wasted, the insights dashboard.
2. **The API** (`backend/`) — Python, FastAPI, SQLAlchemy, Postgres 18.
   What stores and serves that data. Runs on the Synology NAS.

`db/` is not a third app — it holds `erd-schema.sql`, the authoritative
database schema both of the above are built against.

## Repository layout

```
freshwise/
├── .gitattributes          # LF line endings for the whole repo
├── .gitignore              # ONE ignore file, covers node + python + OS
├── README.md               # you are here
│
├── App.tsx                 # mobile entry: font loading + tab navigation
├── app.json                # Expo config
├── package.json            # mobile dependencies
├── tsconfig.json
├── .npmrc
├── src/
│   ├── theme/theme.ts      # single source of truth: colors, spacing, radii, fonts
│   ├── icons/              # food illustration SVGs + lucide re-exports
│   ├── components/         # Button, ExpiryPill, FoodRow, BottomNav, StatCard…
│   ├── screens/            # Home, Pantry, UseFirst, AddFood, FoodDetail…
│   └── data/               # placeholder pantry data (swap for API calls)
│
├── backend/                # FastAPI service — see backend/README.md
│   ├── app/
│   │   ├── main.py  config.py  db.py  deps.py  models.py  schemas.py
│   │   └── routers/        # users, pantry, logs, dashboard, diet, recipes, reference
│   ├── scripts/            # schema apply + reference-data ingest
│   ├── tests/              # pytest integration suite
│   ├── requirements.txt
│   └── .env                 # local config, git-ignored
│
└── db/
    └── erd-schema.sql      # authoritative schema; models.py mirrors it exactly
```

## Getting started

### Mobile app

```bash
npm install
npx expo start
```

Scan the QR code with Expo Go (iOS/Android), or press `i` / `a` for a simulator.

### Backend

```bash
cd backend
python3 -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
# edit .env -- set DB_USER, DB_PASSWORD, NAS_TAILSCALE_IP
python scripts/apply_schema.py ../db/erd-schema.sql
uvicorn app.main:app --reload
```

Full setup, identity model, and endpoint reference: **[`backend/README.md`](backend/README.md)**.

## Conventions

- **Line endings are LF.** `.gitattributes` enforces this. After your first
  pull that includes it, run `git add --renormalize .` once so your checkout
  stops showing every file as modified.
- **One `.gitignore`, at the root.** Do not add per-folder ignore files —
  add the rule to the root file under the matching section instead.
- **No PII, no login.** Clients identify with an `X-Device-Id` UUID header;
  the server never stores credentials or personal identifiers. See the
  project docs (`database-schema-no-pii.md`) for the rationale.
- **`db/erd-schema.sql` is the source of truth** for the database. Change it
  first, then mirror the change in `backend/app/models.py`.

## Mobile app: how it differs from the raw Figma export

- **Absolute positioning → Flexbox.** The export pins every element to
  393×852 pixel coordinates; these screens adapt to real device sizes.
- **Unicode glyphs → real icons.** `⌂ ▤ ⚡ ◷ ✦ ＋` replaced with
  `lucide-react-native`, food illustrations rebuilt as `react-native-svg`.
- **Duplicated markup → shared components.** The bottom nav, food row,
  expiry pill and stat card were copy-pasted per screen; here they are single
  prop-driven components in `src/components/`.
- **Preview screens → real navigation.** Wired into a bottom-tab navigator
  with a custom tab bar matching the design.

## Known gaps

- Pantry data in `PantryScreen.tsx` / `UseFirstScreen.tsx` is still hardcoded —
  swap for the live `GET /v1/pantry` calls now that the backend exists.
- Recipes tab content is not built yet.
- No Alembic migration history; the schema is applied wholesale from `db/`.
