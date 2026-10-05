#!/usr/bin/env python3
"""Build the one-month PriceCatcher snapshot behind Epic 9's RM estimates.

Epic 9 values food from a ONE-TIME snapshot of PriceCatcher (KPDN & DOSM,
CC BY 4.0): the national median price of each item for one month. This script
takes the percentile-trimmed monthly table that aggregate_pricecatcher.py
already produces, keeps one month, joins it to the curated English names in
app/data/price_aliases.csv and writes app/data/price_snapshot.csv.

Why a committed file and not the ref_price_reference table:
    Railway runs schema-only (see RAILWAY.md -- the 1.1 GB reference load
    doesn't fit the free tier), so ref_price_reference is empty there. The
    snapshot is ~110 rows, so it ships inside the API image and
    every environment values food the same way.

Why curated English names:
    PriceCatcher names items in Malay ("AYAM BERSIH - STANDARD"), while users
    type "Chicken". A name-similarity test against the raw Malay names would
    match almost nothing, so price_aliases.csv maps each food item_code to an
    English name plus aliases (Malay names included, so "ayam" still works).
    One representative item_code per food -- usually the most-observed
    brand/grade -- keeps every value traceable to one national median.

Rows flagged `low_sample` (< 20 observations) or with no median are dropped
rather than published as a precise-looking price.

Usage (from backend/):
    python scripts/build_price_snapshot.py \
        ../../freshwise-docs/core_data_v2/price_reference_item_monthly.csv \
        --month 2026-08
"""
from __future__ import annotations

import argparse
import csv
import sys
from pathlib import Path

APP_DATA = Path(__file__).resolve().parent.parent / "app" / "data"
ALIASES = APP_DATA / "price_aliases.csv"
OUT = APP_DATA / "price_snapshot.csv"

FIELDS = [
    "item_code", "month", "name_en", "aliases", "sold_as", "item", "unit",
    "median_price_rm", "observations", "price_quality", "source_url", "license",
]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("monthly_csv", type=Path, help="price_reference_item_monthly.csv")
    parser.add_argument("--month", required=True, help="Snapshot month, YYYY-MM (e.g. 2026-08)")
    args = parser.parse_args()

    month = f"{args.month}-01"
    with open(args.monthly_csv, newline="", encoding="utf-8-sig") as f:
        prices = {r["item_code"].strip(): r for r in csv.DictReader(f) if r["month"].startswith(month)}
    if not prices:
        print(f"No rows for month {args.month} in {args.monthly_csv}", file=sys.stderr)
        return 1

    written, skipped = [], []
    with open(ALIASES, newline="", encoding="utf-8") as f:
        for alias in csv.DictReader(f):
            code = alias["item_code"].strip()
            price = prices.get(code)
            if price is None:
                skipped.append((code, alias["name_en"], "not in this month"))
                continue
            if not price.get("median_price_rm") or "low_sample" in (price.get("price_quality") or ""):
                skipped.append((code, alias["name_en"], "low sample / no median"))
                continue
            written.append({
                "item_code": code,
                "month": month,
                "name_en": alias["name_en"].strip(),
                "aliases": alias["aliases"].strip(),
                "sold_as": alias["sold_as"].strip(),
                "item": price["item"],
                "unit": price["unit"],
                "median_price_rm": price["median_price_rm"],
                "observations": price["observations"],
                "price_quality": price["price_quality"],
                "source_url": price["source_url"],
                "license": price["license"] or "CC BY 4.0",
            })

    with open(OUT, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=FIELDS, lineterminator="\n")
        writer.writeheader()
        writer.writerows(written)

    print(f"Wrote {len(written)} items for {args.month} -> {OUT}")
    for code, name, why in skipped:
        print(f"  skipped {code} ({name}): {why}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
