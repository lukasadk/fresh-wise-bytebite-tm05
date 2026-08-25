#!/usr/bin/env python3
"""Streaming loaders for the 5 reference CSVs -> ref_* tables.

Why streaming: two of these files are large (foodcom_recipe_index_clean.csv
is ~240MB/488,740 rows; foodcom_recipe_ingredients_clean.csv is ~775MB,
same row count). Nothing here ever loads a full file into memory -- each
loader reads the CSV row-by-row with the stdlib `csv` module and streams
straight into a Postgres COPY, so peak memory is roughly "one row", not
"one file".

Order matters: `ref_recipe_detail.recipe_id` is a foreign key into
`ref_recipe_index.recipe_id`, so recipe-index must be loaded before
recipe-detail (the CLI's "all" command does this in the right order).

Usage:
    python scripts/ingest_reference_data.py all /path/to/core_data
    python scripts/ingest_reference_data.py foodkeeper /path/to/foodkeeper_storage_clean.csv
    python scripts/ingest_reference_data.py recipe-detail /path/to/foodcom_recipe_ingredients_clean.csv --limit 1000

Each loader takes --truncate to clear the target table first (useful for
re-running during development; leave it off to append/upsert-by-copy
onto an already-loaded table -- though COPY has no upsert, a truncate-then-
load is the simplest correct way to re-run this against the same table).
"""
from __future__ import annotations

import argparse
import csv
import json
import sys
from datetime import date
from pathlib import Path
from typing import Callable, Iterator

from psycopg.types.json import Jsonb

from db_conn import connect

csv.field_size_limit(sys.maxsize)  # some Food.com `steps`/`ingredients_raw` fields are very long

PROGRESS_EVERY = 20_000


def _num(v: str | None) -> float | None:
    if v is None or v == "":
        return None
    try:
        return float(v)
    except ValueError:
        return None


def _int(v: str | None) -> int | None:
    n = _num(v)
    return int(n) if n is not None else None


def _blank_to_none(v: str | None) -> str | None:
    return v if v not in (None, "") else None


def _split_pipe(v: str | None) -> list[str] | None:
    if not v:
        return None
    return [tok.strip() for tok in v.split("|") if tok.strip()]


def _json_array(v: str | None) -> list | None:
    if not v:
        return None
    try:
        return json.loads(v)
    except json.JSONDecodeError:
        return None


def _month_to_first_of_month(v: str) -> date:
    year, month = v.split("-")
    return date(int(year), int(month), 1)


def _rows(csv_path: Path, limit: int | None) -> Iterator[dict]:
    with open(csv_path, newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        for i, row in enumerate(reader):
            if limit is not None and i >= limit:
                return
            yield row


def _run_copy(table: str, columns: list[str], row_iter: Iterator[tuple], truncate: bool) -> int:
    count = 0
    with connect() as conn:
        with conn.cursor() as cur:
            if truncate:
                cur.execute(f"TRUNCATE TABLE {table} CASCADE")
            col_list = ", ".join(columns)
            with cur.copy(f"COPY {table} ({col_list}) FROM STDIN") as copy:
                for row in row_iter:
                    copy.write_row(row)
                    count += 1
                    if count % PROGRESS_EVERY == 0:
                        print(f"  {table}: {count:,} rows staged...")
        conn.commit()
    return count


# --- Per-file loaders -------------------------------------------------------


def _passthrough(columns: list[str], table: str):
    """Loader for a CSV whose header already matches the target table 1:1.

    The v2 reference builders (build_reference_data.py, aggregate_pricecatcher.py)
    emit columns named exactly like the DB columns, so there's nothing to remap --
    just coerce blanks to NULL and stream. Numeric/int coercion is driven by the
    column name suffix so a blank nutrient stays NULL rather than becoming 0.
    """
    INT_COLS = {"observations", "foodkeeper_id", "category_id", "nova_group_num"}

    def loader(csv_path: Path, truncate: bool, limit: int | None) -> int:
        def gen() -> Iterator[tuple]:
            for row in _rows(csv_path, limit):
                out = []
                for c in columns:
                    v = row.get(c)
                    if v is None or v == "":
                        out.append(None)
                    elif c in INT_COLS:
                        out.append(_int(v))
                    elif c.endswith(("_rm", "_100g", "_min", "_max")):
                        out.append(_num(v))
                    else:
                        out.append(v)
                yield tuple(out)

        return _run_copy(table, columns, gen(), truncate)

    return loader


# --- FoodKeeper (v2: upstream USDA ids, category joined, subtitle in canonical name)
load_foodkeeper = _passthrough([
    "foodkeeper_id", "category_id", "category_name", "name", "name_subtitle", "keywords",
    "canonical_food_name", "canonical_name_base",
    "pantry_min", "pantry_max", "pantry_metric", "pantry_tips",
    "dop_pantry_min", "dop_pantry_max", "dop_pantry_metric",
    "pantry_after_opening_min", "pantry_after_opening_max", "pantry_after_opening_metric",
    "refrigerate_min", "refrigerate_max", "refrigerate_metric", "refrigerate_tips",
    "dop_refrigerate_min", "dop_refrigerate_max", "dop_refrigerate_metric",
    "refrigerate_after_opening_min", "refrigerate_after_opening_max", "refrigerate_after_opening_metric",
    "refrigerate_after_thawing_min", "refrigerate_after_thawing_max", "refrigerate_after_thawing_metric",
    "freeze_min", "freeze_max", "freeze_metric", "freeze_tips",
    "dop_freeze_min", "dop_freeze_max", "dop_freeze_metric",
    "source_dataset", "source_url", "license", "fetched_at_utc",
], "ref_foodkeeper_storage")


# --- PriceCatcher national monthly (v2: percentile-trimmed)
load_price_reference = _passthrough([
    "item_code", "month", "item", "unit", "item_group", "item_category",
    "canonical_food_name",
    "price_p05_rm", "price_p25_rm", "median_price_rm", "price_p75_rm", "price_p95_rm",
    "raw_min_rm", "raw_max_rm", "observations",
    "price_quality", "aggregation_method",
    "source_dataset", "source_url", "license", "fetched_at_utc",
], "ref_price_reference")


# --- PriceCatcher per-state monthly (NEW -- enables region-relevant pricing)
load_price_state = _passthrough([
    "item_code", "month", "state", "canonical_food_name", "item", "unit",
    "median_price_rm", "price_p05_rm", "price_p95_rm", "observations",
    "source_url", "license",
], "ref_price_reference_state")


# --- Open Food Facts Malaysia (v2: full 6,885-product export)
load_openfoodfacts = _passthrough([
    "barcode", "product_name", "product_name_en", "product_name_ms", "canonical_food_name",
    "brands", "categories", "categories_tags", "labels_tags", "allergens_tags",
    "ingredients_text", "quantity", "serving_size",
    "energy_kcal_100g", "energy_kj_100g", "fat_100g", "saturated_fat_100g",
    "carbohydrates_100g", "sugars_100g", "fiber_100g", "proteins_100g",
    "salt_100g", "sodium_100g",
    "nutrition_source", "nutriscore_grade", "nova_group", "nova_group_num", "image_url",
    "source_dataset", "source_url", "license", "fetched_at_utc",
], "ref_openfoodfacts_product")


def load_recipe_index(csv_path: Path, truncate: bool, limit: int | None) -> int:
    columns = [
        "recipe_id",
        "source_recipe_id",
        "recipe_name",
        "recipe_name_canonical",
        "ingredient_tokens",
        "tags",
        "servings",
        "serving_size",
    ]

    def gen() -> Iterator[tuple]:
        for row in _rows(csv_path, limit):
            yield (
                row["recipe_id"],
                _blank_to_none(row["source_recipe_id"]),
                _blank_to_none(row["recipe_name"]),
                _blank_to_none(row["recipe_name_canonical"]),
                _split_pipe(row["ingredient_tokens"]),
                _json_array(row["tags"]),
                _int(row["servings"]),
                _blank_to_none(row["serving_size"]),
            )

    return _run_copy("ref_recipe_index", columns, gen(), truncate)


def load_recipe_detail(csv_path: Path, truncate: bool, limit: int | None) -> int:
    columns = ["recipe_id", "ingredients", "ingredients_raw", "steps", "servings", "serving_size"]

    def gen() -> Iterator[tuple]:
        for row in _rows(csv_path, limit):
            ingredients = _json_array(row["ingredients"])
            yield (
                row["recipe_id"],
                Jsonb(ingredients) if ingredients is not None else None,
                _blank_to_none(row["ingredients_raw"]),
                _blank_to_none(row["steps"]),
                _int(row["servings"]),
                _blank_to_none(row["serving_size"]),
            )

    return _run_copy("ref_recipe_detail", columns, gen(), truncate)


LOADERS: dict[str, Callable[[Path, bool, int | None], int]] = {
    "foodkeeper": load_foodkeeper,
    "price": load_price_reference,
    "price-state": load_price_state,
    "openfoodfacts": load_openfoodfacts,
    "recipe-index": load_recipe_index,
    "recipe-detail": load_recipe_detail,
}

# filename -> loader key, used by the "all" command to find files in a core_data dir
DEFAULT_FILENAMES = {
    "foodkeeper": "foodkeeper_storage.csv",
    "price": "price_reference_item_monthly.csv",
    "price-state": "price_reference_item_state_monthly.csv",
    "openfoodfacts": "openfoodfacts_malaysia_products.csv",
    "recipe-index": "foodcom_recipe_index_clean.csv",
    "recipe-detail": "foodcom_recipe_ingredients_clean.csv",
}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument(
        "target", choices=[*LOADERS.keys(), "all"], help="Which reference table to load, or 'all'"
    )
    parser.add_argument("path", help="CSV file path (single target) or core_data directory (for 'all')")
    parser.add_argument("--truncate", action="store_true", help="TRUNCATE the target table(s) before loading")
    parser.add_argument("--limit", type=int, default=None, help="Only load the first N rows (for testing)")
    args = parser.parse_args()

    if args.target == "all":
        base = Path(args.path)
        # Order matters: recipe-index before recipe-detail (FK dependency).
        for key in ["foodkeeper", "price", "price-state", "openfoodfacts", "recipe-index", "recipe-detail"]:
            csv_path = base / DEFAULT_FILENAMES[key]
            if not csv_path.exists():
                print(f"Skipping {key}: {csv_path} not found", file=sys.stderr)
                continue
            print(f"Loading {key} from {csv_path} ...")
            n = LOADERS[key](csv_path, args.truncate, args.limit)
            print(f"  -> {n:,} rows loaded into ref_{key.replace('-', '_')}"
                  if key not in ("recipe-index", "recipe-detail")
                  else f"  -> {n:,} rows loaded")
    else:
        csv_path = Path(args.path)
        if not csv_path.exists():
            print(f"File not found: {csv_path}", file=sys.stderr)
            sys.exit(1)
        print(f"Loading {args.target} from {csv_path} ...")
        n = LOADERS[args.target](csv_path, args.truncate, args.limit)
        print(f"Done -- {n:,} rows loaded.")


if __name__ == "__main__":
    main()
