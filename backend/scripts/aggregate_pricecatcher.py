#!/usr/bin/env python3
"""Re-aggregate raw PriceCatcher into a monthly reference table -- WITH outlier trimming.

This replaces the previous `price_reference_item_monthly_clean.csv`, whose min/max
were computed straight off the raw feed with no filtering, so single data-entry
errors surfaced as real prices (chicken at RM0.12/kg, chilli at RM1000/kg).

Approach: for each (item_code, month), sort the raw observations and take
percentiles. p05/p95 replace raw min/max as the published range -- they answer
"what's a cheap/expensive price for this item" without a single fat-fingered
record being able to move them. Raw min/max are still recorded alongside, so
the contamination stays visible and auditable rather than being quietly dropped.

Also emits a per-state table: lookup_premise carries `state`, which the previous
build discarded entirely. That's what makes regionally-relevant pricing possible
(user_profile.location is a coarse Malaysian region).

Usage:
    python aggregate_pricecatcher.py <incoming_dir> <out_dir>
"""
from __future__ import annotations

import csv
import json
import hashlib
import re
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

csv.field_size_limit(min(sys.maxsize, 2**31 - 1))

SRC = Path(sys.argv[1])
OUT = Path(sys.argv[2])
OUT.mkdir(parents=True, exist_ok=True)

SOURCE_BASE = "https://storage.data.gov.my/pricecatcher"
LICENSE = "CC BY 4.0"
NOW = datetime.now(timezone.utc).isoformat()

# Percentile band published as the item's price range. p05/p95 keeps ~90% of real
# spread while excluding the tails where data-entry errors live.
LO_PCT, HI_PCT = 5, 95
MIN_OBS_FOR_TRIM = 20        # below this a percentile is meaningless; flag instead


def canon(s: str) -> str:
    """Match the canonical_food_name convention already used in the schema:
    lowercase, parentheses dropped, whitespace collapsed."""
    s = (s or "").lower()
    s = re.sub(r"[()]", " ", s)
    s = re.sub(r"\s+", " ", s)
    return s.strip()


def pct(sorted_vals: list[float], p: float) -> float:
    """Linear-interpolated percentile. sorted_vals must be sorted, non-empty."""
    if len(sorted_vals) == 1:
        return sorted_vals[0]
    k = (len(sorted_vals) - 1) * (p / 100.0)
    lo, hi = int(k), min(int(k) + 1, len(sorted_vals) - 1)
    return sorted_vals[lo] + (sorted_vals[hi] - sorted_vals[lo]) * (k - lo)


def sha256_file(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


# ---------------------------------------------------------------- lookups
print("Loading lookups ...", flush=True)
items: dict[str, dict] = {}
with open(SRC / "lookup_item.csv", newline="", encoding="utf-8-sig") as f:
    for r in csv.DictReader(f):
        if r["item_code"] and r["item_code"] != "-1":
            items[r["item_code"].strip()] = r

premise_state: dict[str, str] = {}
with open(SRC / "lookup_premise.csv", newline="", encoding="utf-8-sig") as f:
    for r in csv.DictReader(f):
        code = (r.get("premise_code") or "").strip()
        if not code or code.startswith("-1"):
            continue
        # premise_code arrives as a float string ("2.0") in the lookup but as an
        # int string ("2") in the price feed -- normalise so the join works.
        try:
            code = str(int(float(code)))
        except ValueError:
            continue
        premise_state[code] = (r.get("state") or "").strip()

print(f"  items: {len(items)}   premises: {len(premise_state)}", flush=True)

# ---------------------------------------------------------------- aggregate
month_files = sorted(SRC.glob("pricecatcher_*.csv"))
national_rows: list[dict] = []
state_rows: list[dict] = []
manifest: list[dict] = []
summary: list[dict] = []

for mf in month_files:
    month = re.search(r"(\d{4}-\d{2})", mf.name).group(1)
    print(f"\n{mf.name} ...", flush=True)

    by_item: dict[str, list[float]] = defaultdict(list)
    by_item_state: dict[tuple, list[float]] = defaultdict(list)
    n_raw = n_bad = 0

    with open(mf, newline="", encoding="utf-8-sig") as f:
        for r in csv.DictReader(f):
            n_raw += 1
            try:
                price = float(r["price"])
            except (ValueError, TypeError, KeyError):
                n_bad += 1
                continue
            if price <= 0:
                n_bad += 1
                continue
            ic = (r.get("item_code") or "").strip()
            if not ic:
                n_bad += 1
                continue
            by_item[ic].append(price)
            st = premise_state.get((r.get("premise_code") or "").strip())
            if st:
                by_item_state[(ic, st)].append(price)

    print(f"  raw rows: {n_raw:,}   unusable: {n_bad:,}   items: {len(by_item):,}", flush=True)

    flagged = 0
    for ic, vals in by_item.items():
        vals.sort()
        n = len(vals)
        meta = items.get(ic, {})
        p05, p50, p95 = pct(vals, LO_PCT), pct(vals, 50), pct(vals, HI_PCT)
        p25, p75 = pct(vals, 25), pct(vals, 75)
        raw_min, raw_max = vals[0], vals[-1]

        # How badly would the untrimmed range have misled? This is the number
        # that shows the previous build's min/max were unusable.
        lo_infl = (p50 / raw_min) if raw_min > 0 else None
        hi_infl = (raw_max / p50) if p50 > 0 else None
        notes = []
        # data.gov.my's own lookup_item.csv doesn't define every item_code that
        # appears in the price feed (52 codes / ~588k observations as of
        # 2026-06..08). Those rows are kept -- dropping them would silently lose
        # 11% of the data -- but flagged and given a placeholder name so they're
        # visibly unresolved rather than quietly absent.
        if not meta:
            notes.append("unmapped_item_code")
        if n < MIN_OBS_FOR_TRIM:
            notes.append("low_sample")
        if lo_infl and lo_infl >= 5:
            notes.append("raw_min_contaminated")
        if hi_infl and hi_infl >= 5:
            notes.append("raw_max_contaminated")
        if notes:
            flagged += 1

        national_rows.append({
            "item_code": ic,
            "month": f"{month}-01",
            "item": meta.get("item", ""),
            "unit": meta.get("unit", ""),
            "item_group": meta.get("item_group", ""),
            "item_category": meta.get("item_category", ""),
            # never blank -- the column is NOT NULL and a placeholder keeps the
            # row joinable/auditable instead of failing the load
            "canonical_food_name": canon(meta.get("item", "")) or f"unmapped_item_{ic}",
            "price_p05_rm": round(p05, 2),
            "price_p25_rm": round(p25, 2),
            "median_price_rm": round(p50, 2),
            "price_p75_rm": round(p75, 2),
            "price_p95_rm": round(p95, 2),
            "raw_min_rm": round(raw_min, 2),
            "raw_max_rm": round(raw_max, 2),
            "observations": n,
            "price_quality": "|".join(notes) if notes else "ok",
            "aggregation_method": f"percentile p{LO_PCT}/p{HI_PCT} trimmed",
            "source_dataset": "Malaysia PriceCatcher (raw transactional feed)",
            "source_url": f"{SOURCE_BASE}/pricecatcher_{month}.csv",
            "license": LICENSE,
            "fetched_at_utc": NOW,
        })

    for (ic, st), vals in by_item_state.items():
        if len(vals) < MIN_OBS_FOR_TRIM:
            continue
        vals.sort()
        meta = items.get(ic, {})
        state_rows.append({
            "item_code": ic,
            "month": f"{month}-01",
            "state": st,
            "canonical_food_name": canon(meta.get("item", "")) or f"unmapped_item_{ic}",
            "item": meta.get("item", ""),
            "unit": meta.get("unit", ""),
            "median_price_rm": round(pct(vals, 50), 2),
            "price_p05_rm": round(pct(vals, LO_PCT), 2),
            "price_p95_rm": round(pct(vals, HI_PCT), 2),
            "observations": len(vals),
            "source_url": f"{SOURCE_BASE}/pricecatcher_{month}.csv",
            "license": LICENSE,
        })

    summary.append({"month": month, "raw_rows": n_raw, "items": len(by_item), "flagged": flagged})
    manifest.append({
        "dataset": f"Malaysia PriceCatcher {month} (raw)",
        "file": mf.name,
        "official_source_url": f"{SOURCE_BASE}/pricecatcher_{month}.csv",
        "license": LICENSE,
        "record_count": n_raw,
        "bytes": mf.stat().st_size,
        "sha256": sha256_file(mf),
        "fetched_at_utc": NOW,
        "notes": f"Raw per-premise records. Aggregated to p{LO_PCT}/p{HI_PCT}-trimmed monthly reference.",
    })
    del by_item, by_item_state

# ---------------------------------------------------------------- write
def write_csv(path: Path, rows: list[dict]) -> None:
    if not rows:
        return
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)
    print(f"  {path.name}: {len(rows):,} rows", flush=True)

print("\nWriting ...", flush=True)
national_rows.sort(key=lambda r: (r["month"], r["item_code"]))
state_rows.sort(key=lambda r: (r["month"], r["state"], r["item_code"]))
write_csv(OUT / "price_reference_item_monthly.csv", national_rows)
write_csv(OUT / "price_reference_item_state_monthly.csv", state_rows)

for m in ("lookup_item.csv", "lookup_premise.csv"):
    p = SRC / m
    if p.exists():
        manifest.append({
            "dataset": f"Malaysia PriceCatcher {p.stem}", "file": m,
            "official_source_url": f"{SOURCE_BASE}/{m}", "license": LICENSE,
            "record_count": sum(1 for _ in open(p, encoding="utf-8-sig")) - 1,
            "bytes": p.stat().st_size, "sha256": sha256_file(p),
            "fetched_at_utc": NOW, "notes": "Lookup table decoding item_code / premise_code.",
        })

(OUT / "pricecatcher_manifest.json").write_text(
    json.dumps({"generated_at_utc": NOW, "summary": summary, "files": manifest}, indent=2),
    encoding="utf-8")

print("\n=== summary ===")
for s in summary:
    print(f"  {s['month']}: {s['raw_rows']:,} raw rows -> {s['items']} items, {s['flagged']} flagged")
print(f"  national rows: {len(national_rows):,}   state rows: {len(state_rows):,}")
