# Deploying the FreshWise API on Railway

Alternative to `DEPLOY.md` (NAS + tunnel). Everything in `app/` works unchanged
on both — only configuration differs.

**Read this first:** your reference data is ~1.1 GB of CSVs, which does not fit
a free managed Postgres tier. Deploy **schema-only** to start. Epics 1–3 all
work without reference data; the only visible effect is that storage guidance
shows "No guidance on file yet". Loading the full dataset means paying for
storage — decide that after you've seen it running.

---

## 1. Commit and push to main

Railway builds from a GitHub branch, so these files have to be on
`origin/main` before it can deploy them.

```bash
git add backend/
git commit -m "Add deployment config and API hardening for public hosting"
git push origin main
```

Staging `backend/` specifically rather than `.` keeps two things out:

- `src/data/pantryItems.api.ts` -- an untracked leftover from an earlier
  iteration. Nothing imports it any more; the current client lives in
  `src/data/api.ts`, `logs.ts`, `pantryItems.ts` and friends. Committing it
  would put dead code back into the repo.
- Anything else uncommitted in the app tree that isn't yours to push.

## 2. Create the project

Railway → **New Project → Deploy from GitHub repo** → pick
`waste-wise-bytebite-tm05`.

> **Set Root Directory to `backend`** (service → Settings → Source).
> The repo root is the Expo app, so without this Railway tries to build the
> mobile app and fails with a confusing Node error. This is the single most
> common way this deployment goes wrong.

It then finds `backend/Dockerfile` and `backend/railway.json` on its own.

## 3. Add Postgres

**New → Database → PostgreSQL**, in the same project.

Railway exposes two URLs for it, and using the wrong one is the second most
common mistake:

| Variable | Resolves from | Use it for |
|---|---|---|
| `DATABASE_URL` | inside Railway only | the API service |
| `DATABASE_PUBLIC_URL` | anywhere | your laptop, running the schema script |

The internal URL is free and fast. Routing the API through the public one
works but bills egress for every query.

## 4. Set the API service's variables

Service → **Variables**:

```
DATABASE_URL = ${{Postgres.DATABASE_URL}}     # reference, not a paste
ENVIRONMENT           = production
API_KEY               = <python -c "import secrets; print(secrets.token_urlsafe(32))">
RATE_LIMIT_PER_MINUTE = 60
TRUST_PROXY_HEADERS   = true
CORS_ORIGINS          = https://<your-railway-domain>
```

`${{Postgres.DATABASE_URL}}` is Railway's reference syntax — it stays correct
if the database is ever recreated, unlike a pasted value.

**Do not set `PORT`.** Railway injects its own, and the Dockerfile already
honours it.

`TRUST_PROXY_HEADERS=true` is correct here because Railway's edge proxy sets
`X-Forwarded-For`; without it every caller would share one rate-limit bucket.

Railway hands out `DATABASE_URL` as plain `postgresql://` with no driver.
`app/config.py` converts that to `postgresql+asyncpg://` and derives the sync
URL, so nothing else needs setting.

## 5. Generate the public URL

Service → Settings → **Networking → Generate Domain**. You get
`https://<something>.up.railway.app`. Put it in `CORS_ORIGINS` (step 4).

## 6. Create the schema

From your laptop, using the **public** database URL (copy it from the Postgres
service's Variables tab):

```bash
cd backend
venv\Scripts\activate
set DATABASE_URL_SYNC=<paste DATABASE_PUBLIC_URL>
python scripts/apply_schema.py ../db/erd-schema.sql
```

This runs from your machine because `db/` is outside the Docker build context
and so isn't in the image. `erd-schema.sql` already includes the `storage`
column, so **`002_add_storage.sql` is not needed here** — that migration only
exists to upgrade a database created before it, like your NAS.

## 7. Verify before sharing

```bash
curl -i https://<your-app>.up.railway.app/health
# 200 {"status":"ok"}

curl -i https://<your-app>.up.railway.app/v1/pantry -H "X-Device-Id: 11111111-1111-1111-1111-111111111111"
# 401 -- the API key is doing its job

curl -i https://<your-app>.up.railway.app/docs
# 404 -- hidden because ENVIRONMENT=production
```

If the second returns anything but 401, `API_KEY` didn't reach the container
and your API is open. Fix that before handing the URL to anyone.

## 8. Point the app at it

The client lives in **`src/data/api.ts`**. Two changes:

```diff
- export const API_BASE_URL = 'http://100.108.18.20:8000';
+ export const API_BASE_URL = 'https://<your-app>.up.railway.app';

  const DEVICE_ID_HEADER = 'X-Device-Id';
+ // Must match API_KEY in the Railway service's variables. Empty is fine
+ // locally -- the backend only enforces it when its own API_KEY is set.
+ const API_KEY = '<the key from step 4>';
```

and inside `request()`, add the header:

```diff
    headers: {
      'Content-Type': 'application/json',
      [DEVICE_ID_HEADER]: deviceId,
+     ...(API_KEY ? { 'X-API-Key': API_KEY } : {}),
    },
```

Coordinate this one with whoever owns `src/data/api.ts` -- switching
`API_BASE_URL` moves the whole team off the current Tailscale address, so
everyone needs the Railway URL and the key at the same time. Until then they
would get 401s and assume the app is broken.

Worth knowing: this file has no request timeout, so if the host is unreachable
the app hangs on the default fetch timeout instead of failing quickly. Not a
blocker for deploying, but it makes a misconfigured URL look like a frozen app
rather than an error.

## 9. Optional: reference data

Only if you're paying for the storage. From your laptop, with
`DATABASE_URL_SYNC` set to the public URL:

```bash
python scripts/ingest_reference_data.py all ../../freshwise-docs/core_data/core_data --truncate
```

Expect this to be slow — it's ~1.1 GB over the internet rather than a LAN, and
it will exceed a free tier's disk. Loading only FoodKeeper (small, and the one
that powers storage guidance) is a reasonable middle ground; the Food.com
recipe files are what make the dataset large.

---

## What differs from the NAS route

| | Railway | NAS + tunnel |
|---|---|---|
| Uptime | theirs | your house's power and internet |
| Cost | paid once past the trial | free |
| Full 1.1 GB dataset | costs storage | already there |
| Your data | on their servers | on hardware you own |
| Setup | ~20 minutes | longer, more moving parts |

Neither needs a code change. Both are safe to try — deploying to Railway
doesn't disturb the NAS, so you can run both and compare.
