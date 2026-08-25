#!/usr/bin/env python3
"""Re-fetch reference data from OFFICIAL primary sources, with provenance capture.

The point of this script is that every file it writes is traceable: alongside
each dataset it records the exact URL, the HTTP fetch timestamp, the byte size,
and a SHA-256 of the raw payload, into `dataset_build_manifest.csv`. That is
what the previous core_data build was missing -- CORE_README.md referenced a
manifest that never existed, so none of the shipped CSVs could be verified
against the sources they claimed.

Run this from a machine with normal internet access:

    python scripts/fetch_official_sources.py --out ../../freshwise-docs/core_data_v2
    python scripts/fetch_official_sources.py --out ./out --only foodkeeper,pricecatcher

Sources covered here are the ones with a clean, open licence and a documented
API/download endpoint. Kaggle-hosted datasets are deliberately NOT fetched by
this script -- see NOTES at the bottom.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

USER_AGENT = "FreshWise-DataFetch/1.0 (Monash FIT5120 student project; contact via repo)"

MANIFEST_FIELDS = [
    "dataset", "file", "official_source_url", "license", "fetched_at_utc",
    "http_status", "bytes", "sha256", "record_count", "notes",
]


def _get(url: str, accept: str = "*/*") -> tuple[bytes, int]:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": accept})
    with urllib.request.urlopen(req, timeout=120) as resp:
        return resp.read(), resp.status


def _stamp(rows: list[dict], **kw) -> None:
    rows.append({f: kw.get(f, "") for f in MANIFEST_FIELDS})


# ------------------------------------------------------------------ FoodKeeper
def fetch_foodkeeper(out: Path, manifest: list[dict]) -> None:
    """USDA FSIS FoodKeeper -- US Government work, public domain / CC0.

    Saves the RAW JSON as well as a flattened CSV. Keeping the raw payload is
    the whole point: it's what makes the transform re-verifiable later.
    """
    url = "https://www.fsis.usda.gov/shared/data/EN/foodkeeper.json"
    print(f"FoodKeeper  <- {url}")
    raw, status = _get(url, accept="application/json")
    (out / "raw").mkdir(parents=True, exist_ok=True)
    (out / "raw" / "foodkeeper.json").write_bytes(raw)

    data = json.loads(raw)
    sheets = data.get("sheets", [])
    products = next((s for s in sheets if s.get("name", "").lower() == "product"), None)
    count = len(products.get("data", [])) if products else 0

    _stamp(
        manifest, dataset="USDA FoodKeeper", file="raw/foodkeeper.json",
        official_source_url=url, license="Public domain (US Government work)",
        fetched_at_utc=datetime.now(timezone.utc).isoformat(), http_status=status,
        bytes=len(raw), sha256=hashlib.sha256(raw).hexdigest(), record_count=count,
        notes="Raw upstream JSON retained so any derived CSV can be re-verified. "
              "Preserve the upstream numeric product ID as foodkeeper_source_id -- "
              "do NOT invent FK#### keys as the previous build did.",
    )
    print(f"  ok: {len(raw):,} bytes, {count} products")


# ---------------------------------------------------------------- PriceCatcher
def fetch_pricecatcher(out: Path, manifest: list[dict], months: list[str]) -> None:
    """Malaysia PriceCatcher (data.gov.my) -- CC BY 4.0.

    Fetches the RAW monthly price records, not a pre-aggregated summary. The
    previous build shipped only a 266-row monthly summary whose min/max were
    contaminated by unfiltered data-entry errors in the raw records. Having the
    raw file back means aggregation can be redone with outlier trimming.

    Also fetches lookup_item.csv / lookup_premise.csv, which are what make the
    raw item_code / premise_code columns interpretable.
    """
    (out / "raw").mkdir(parents=True, exist_ok=True)

    for m in months:
        url = f"https://storage.data.gov.my/pricecatcher/pricecatcher_{m}.csv"
        print(f"PriceCatcher {m}  <- {url}")
        try:
            raw, status = _get(url, accept="text/csv")
        except Exception as e:  # a month that isn't published yet 404s
            print(f"  SKIPPED ({e})")
            continue
        fn = f"raw/pricecatcher_{m}.csv"
        (out / fn).write_bytes(raw)
        rc = raw.count(b"\n") - 1
        _stamp(
            manifest, dataset=f"Malaysia PriceCatcher {m}", file=fn,
            official_source_url=url, license="CC BY 4.0",
            fetched_at_utc=datetime.now(timezone.utc).isoformat(), http_status=status,
            bytes=len(raw), sha256=hashlib.sha256(raw).hexdigest(), record_count=rc,
            notes="RAW per-premise price records. Aggregate with outlier trimming "
                  "(e.g. 5th-95th percentile) before exposing min/max to the app; "
                  "the raw feed contains decimal-slip errors.",
        )
        print(f"  ok: {len(raw):,} bytes, ~{rc:,} records")
        time.sleep(1)

    for name in ("lookup_item", "lookup_premise"):
        url = f"https://storage.data.gov.my/pricecatcher/{name}.csv"
        print(f"PriceCatcher {name}  <- {url}")
        try:
            raw, status = _get(url, accept="text/csv")
        except Exception as e:
            print(f"  SKIPPED ({e})")
            continue
        fn = f"raw/{name}.csv"
        (out / fn).write_bytes(raw)
        _stamp(
            manifest, dataset=f"Malaysia PriceCatcher {name}", file=fn,
            official_source_url=url, license="CC BY 4.0",
            fetched_at_utc=datetime.now(timezone.utc).isoformat(), http_status=status,
            bytes=len(raw), sha256=hashlib.sha256(raw).hexdigest(),
            record_count=raw.count(b"\n") - 1,
            notes="Lookup table -- decodes item_code / premise_code in the raw price feed.",
        )
        print(f"  ok: {len(raw):,} bytes")
        time.sleep(1)


# ------------------------------------------------------------- Open Food Facts
def fetch_openfoodfacts(out: Path, manifest: list[dict], max_pages: int = 60) -> None:
    """Open Food Facts, Malaysia -- ODbL 1.0 (attribution REQUIRED).

    Paginates properly. The previous build shipped 88 products, which is a
    single unpaginated response, not the Malaysian catalogue.
    """
    base = ("https://world.openfoodfacts.org/api/v2/search"
            "?countries_tags_en=malaysia&page_size=100&page={page}"
            "&fields=code,product_name,product_name_en,brands,categories,categories_tags,"
            "ingredients_text,quantity,labels_tags,allergens_tags,"
            "nutriments,image_url,last_modified_t")
    all_products: list[dict] = []
    total = None

    for page in range(1, max_pages + 1):
        url = base.format(page=page)
        print(f"OpenFoodFacts page {page}  <- (api/v2/search)")
        try:
            raw, status = _get(url, accept="application/json")
        except Exception as e:
            print(f"  stopping ({e})")
            break
        payload = json.loads(raw)
        prods = payload.get("products", [])
        total = payload.get("count", total)
        if not prods:
            break
        all_products.extend(prods)
        print(f"  +{len(prods)} (have {len(all_products)} of {total})")
        if total and len(all_products) >= total:
            break
        time.sleep(6)  # OFF asks for <=10 req/min on search; be a good citizen

    (out / "raw").mkdir(parents=True, exist_ok=True)
    blob = json.dumps(all_products, ensure_ascii=False).encode()
    (out / "raw" / "openfoodfacts_malaysia.json").write_bytes(blob)
    _stamp(
        manifest, dataset="Open Food Facts Malaysia", file="raw/openfoodfacts_malaysia.json",
        official_source_url="https://world.openfoodfacts.org/api/v2/search?countries_tags_en=malaysia",
        license="ODbL 1.0 -- attribution to Open Food Facts contributors is REQUIRED",
        fetched_at_utc=datetime.now(timezone.utc).isoformat(), http_status=200,
        bytes=len(blob), sha256=hashlib.sha256(blob).hexdigest(), record_count=len(all_products),
        notes=f"Paginated fetch; upstream reported {total} total MY products. "
              "Nutrient fields are frequently absent -- treat missing as UNKNOWN, never as 0.",
    )
    print(f"  ok: {len(all_products)} products saved")


SOURCES = {
    "foodkeeper": fetch_foodkeeper,
    "pricecatcher": fetch_pricecatcher,
    "openfoodfacts": fetch_openfoodfacts,
}


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--out", required=True, help="Output directory for raw files + manifest")
    p.add_argument("--only", default="", help="Comma-separated subset: foodkeeper,pricecatcher,openfoodfacts")
    p.add_argument("--months", default="2026-08",
                   help="Comma-separated PriceCatcher months, e.g. 2026-06,2026-07,2026-08")
    args = p.parse_args()

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    wanted = [s.strip() for s in args.only.split(",") if s.strip()] or list(SOURCES)

    manifest: list[dict] = []
    for name in wanted:
        if name not in SOURCES:
            print(f"Unknown source '{name}'; valid: {', '.join(SOURCES)}", file=sys.stderr)
            continue
        try:
            if name == "pricecatcher":
                SOURCES[name](out, manifest, [m.strip() for m in args.months.split(",")])
            else:
                SOURCES[name](out, manifest)
        except Exception as e:
            print(f"  FAILED {name}: {e}", file=sys.stderr)

    mpath = out / "dataset_build_manifest.csv"
    with open(mpath, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=MANIFEST_FIELDS)
        w.writeheader()
        w.writerows(manifest)
    print(f"\nManifest: {mpath}  ({len(manifest)} entries)")


if __name__ == "__main__":
    main()


# ---------------------------------------------------------------------------
# NOTES -- sources deliberately NOT fetched here
#
# Kaggle (Food.com recipes, Instacart): Kaggle requires an authenticated API
#   token, so it can't be a no-credential fetch. More importantly, every
#   Food.com dataset on Kaggle originates from scraping Food.com, whose Terms
#   of Use prohibit scraping and redistribution -- there is no licence under
#   which that data can ship in a deployed product. Instacart's dataset is
#   released for non-commercial research under its own terms. Both are usable
#   for coursework/prototyping with citation; neither is safe to build a
#   product's live recipe feature on. See DATA_AUDIT.md for the licensed
#   alternatives (Spoonacular/Edamam under their API terms; USDA FoodData
#   Central for nutrients, CC0).
#
# Malaysian household food-waste statistics: DOSM publishes these as a
#   statistical release (Household Food Waste in Malaysia 2025, from NHIS
#   2025), not as a machine-readable open dataset -- there is no CSV endpoint
#   to fetch. Use the published figures as calibration constants/citations,
#   entered deliberately rather than scraped. See DATA_AUDIT.md.
# ---------------------------------------------------------------------------
