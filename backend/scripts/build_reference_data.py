#!/usr/bin/env python3
"""Build FoodKeeper + Open Food Facts reference tables from official raw payloads.

FoodKeeper  <- foodkeeper.json      (USDA FSIS, public domain)
OpenFoodFacts <- openfoodfacts_export.csv  (OFF bulk CSV export, TAB-separated, ODbL 1.0)

Two things the previous build got wrong, fixed here:

  * FoodKeeper ids were locally invented (FK0001...). USDA issues a real numeric
    product ID -- that's kept as the primary key so rows can be traced upstream.
    The Category sheet (which the old build ignored entirely) is joined in, so
    category_id finally resolves to a readable name.
  * canonical_food_name was built from Name alone, collapsing 661 products into
    466 names -- "canned ham" and "glazed ham" became the same key despite very
    different storage lives. Name_subtitle is now part of the key (661 -> 658).

Open Food Facts notes:
  * The export is TAB-separated and uses OFF's nested nutrition schema
    (nutrition.input_sets.<set>.as_sold.100g.nutrients.<n>.value). Values from
    the product's own packaging are preferred; OFF's own estimates are used only
    as a fallback and recorded in `nutrition_source` so estimated figures are
    never silently presented as label data.
  * Missing nutrients stay EMPTY, never 0 -- per CORE_README.md's rule.

Usage: python build_reference_data.py <incoming_dir> <out_dir>
"""
from __future__ import annotations

import csv
import hashlib
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

csv.field_size_limit(min(sys.maxsize, 2**31 - 1))

SRC, OUT = Path(sys.argv[1]), Path(sys.argv[2])
OUT.mkdir(parents=True, exist_ok=True)
NOW = datetime.now(timezone.utc).isoformat()
manifest: list[dict] = []


def sha256_file(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for c in iter(lambda: f.read(1 << 20), b""):
            h.update(c)
    return h.hexdigest()


def canon(s: str) -> str:
    """Normalise a food name for cross-dataset matching.

    Smart quotes and other punctuation are stripped, not just parentheses:
    FoodKeeper ships subtitles like `canned ("keep refrigerated" label)` with
    curly quotes, which would otherwise have to be reproduced exactly by any
    caller trying to match on the canonical name.
    """
    s = (s or "").lower()
    s = s.replace("“", " ").replace("”", " ")   # curly double quotes
    s = s.replace("‘", " ").replace("’", "'")   # curly single quotes
    s = re.sub(r"[()\[\]{},;:/\\]", " ", s)
    return re.sub(r"\s+", " ", s).strip()


NOVA_RE = re.compile(r"^\s*([1-4])\b")


def nova_num(v: str) -> str:
    """OFF stores NOVA as free text ('4 - Ultra processed food and drink
    products', 'Unknown'). Pull out the 1-4 group so it can be filtered
    numerically; anything unparseable becomes blank (=> NULL)."""
    m = NOVA_RE.match(v or "")
    return m.group(1) if m else ""


def clean_grade(v: str) -> str:
    """Nutri-Score arrives as a literal 'unknown'/'not-applicable' string for
    products that don't have one -- that's a null, not a grade."""
    v = (v or "").strip().lower()
    return "" if v in {"", "unknown", "not-applicable", "not-computed"} else v


# ============================================================ FoodKeeper
fk_path = SRC / "foodkeeper.json"
if fk_path.exists():
    print("FoodKeeper ...", flush=True)
    data = json.loads(fk_path.read_text(encoding="utf-8"))

    # USDA ships each row as an ARRAY of single-key objects, not a flat object.
    flat = lambda row: {k: v for d in row for k, v in d.items()}
    sheet = lambda n: next((s["data"] for s in data["sheets"]
                            if s.get("name", "").lower() == n), [])

    cats = {}
    for c in map(flat, sheet("category")):
        cats[c.get("ID")] = c.get("Category_Name") or c.get("Name") or ""

    prods = list(map(flat, sheet("product")))
    rows = []
    for p in prods:
        rows.append({
            "foodkeeper_id": p.get("ID"),
            "category_id": p.get("Category_ID"),
            "category_name": cats.get(p.get("Category_ID"), ""),
            "name": p.get("Name"),
            "name_subtitle": p.get("Name_subtitle"),
            "keywords": p.get("Keywords"),
            # subtitle included: keeps distinct products distinct
            "canonical_food_name": canon(" ".join(
                x for x in [p.get("Name"), p.get("Name_subtitle")] if x)),
            "canonical_name_base": canon(p.get("Name") or ""),
            "pantry_min": p.get("Pantry_Min"), "pantry_max": p.get("Pantry_Max"),
            "pantry_metric": p.get("Pantry_Metric"), "pantry_tips": p.get("Pantry_tips"),
            "dop_pantry_min": p.get("DOP_Pantry_Min"), "dop_pantry_max": p.get("DOP_Pantry_Max"),
            "dop_pantry_metric": p.get("DOP_Pantry_Metric"),
            "pantry_after_opening_min": p.get("Pantry_After_Opening_Min"),
            "pantry_after_opening_max": p.get("Pantry_After_Opening_Max"),
            "pantry_after_opening_metric": p.get("Pantry_After_Opening_Metric"),
            "refrigerate_min": p.get("Refrigerate_Min"), "refrigerate_max": p.get("Refrigerate_Max"),
            "refrigerate_metric": p.get("Refrigerate_Metric"), "refrigerate_tips": p.get("Refrigerate_tips"),
            "dop_refrigerate_min": p.get("DOP_Refrigerate_Min"), "dop_refrigerate_max": p.get("DOP_Refrigerate_Max"),
            "dop_refrigerate_metric": p.get("DOP_Refrigerate_Metric"),
            "refrigerate_after_opening_min": p.get("Refrigerate_After_Opening_Min"),
            "refrigerate_after_opening_max": p.get("Refrigerate_After_Opening_Max"),
            "refrigerate_after_opening_metric": p.get("Refrigerate_After_Opening_Metric"),
            "refrigerate_after_thawing_min": p.get("Refrigerate_After_Thawing_Min"),
            "refrigerate_after_thawing_max": p.get("Refrigerate_After_Thawing_Max"),
            "refrigerate_after_thawing_metric": p.get("Refrigerate_After_Thawing_Metric"),
            "freeze_min": p.get("Freeze_Min"), "freeze_max": p.get("Freeze_Max"),
            "freeze_metric": p.get("Freeze_Metric"), "freeze_tips": p.get("Freeze_Tips"),
            "dop_freeze_min": p.get("DOP_Freeze_Min"), "dop_freeze_max": p.get("DOP_Freeze_Max"),
            "dop_freeze_metric": p.get("DOP_Freeze_Metric"),
            "source_dataset": "USDA FSIS FoodKeeper",
            "source_url": "https://www.fsis.usda.gov/shared/data/EN/foodkeeper.json",
            "license": "Public domain (US Government work)",
            "fetched_at_utc": NOW,
        })

    with open(OUT / "foodkeeper_storage.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader(); w.writerows(rows)

    base = len({r["canonical_name_base"] for r in rows})
    full = len({r["canonical_food_name"] for r in rows})
    print(f"  {len(rows)} products, {len(cats)} categories")
    print(f"  distinct canonical: {base} (name only)  ->  {full} (with subtitle)")

    manifest.append({
        "dataset": "USDA FoodKeeper", "output": "foodkeeper_storage.csv",
        "official_source_url": "https://www.fsis.usda.gov/shared/data/EN/foodkeeper.json",
        "license": "Public domain (US Government work)",
        "raw_file": fk_path.name, "raw_bytes": fk_path.stat().st_size,
        "raw_sha256": sha256_file(fk_path), "record_count": len(rows), "fetched_at_utc": NOW,
        "notes": "Primary key is the upstream USDA numeric ID. Category sheet joined. "
                 "canonical_food_name includes Name_subtitle to avoid collapsing distinct products.",
    })

# ============================================================ Open Food Facts
off_path = SRC / "openfoodfacts_export.csv"
if off_path.exists():
    print("\nOpen Food Facts ...", flush=True)

    NUTRIENTS = {
        "energy_kcal_100g": "energy-kcal", "energy_kj_100g": "energy-kj",
        "fat_100g": "fat", "saturated_fat_100g": "saturated-fat",
        "carbohydrates_100g": "carbohydrates", "sugars_100g": "sugars",
        "fiber_100g": "fiber", "proteins_100g": "proteins",
        "salt_100g": "salt", "sodium_100g": "sodium",
    }
    # label values first; OFF's own estimates only as a marked fallback
    SETS = [("packaging", "packaging_label"), ("estimate", "off_estimate")]

    def nut_col(setname, nutrient, per="100g"):
        return f"nutrition.input_sets.{setname}.as_sold.{per}.nutrients.{nutrient}.value"

    def first_nonempty(row, cols):
        for c in cols:
            v = (row.get(c) or "").strip()
            if v:
                return v
        return ""

    out_rows, n_in, skipped = [], 0, 0
    with open(off_path, newline="", encoding="utf-8", errors="replace") as f:
        rd = csv.DictReader(f, delimiter="\t")
        for row in rd:
            n_in += 1
            code = (row.get("code") or "").strip().strip('"')
            if not code:
                skipped += 1
                continue

            name = first_nonempty(row, ["product_name_en", "product_name_ms",
                                        "product_name_xx", "product_name_id", "product_name_zh"])
            rec = {
                "barcode": code,
                "product_name": name,
                "product_name_en": (row.get("product_name_en") or "").strip(),
                "product_name_ms": (row.get("product_name_ms") or "").strip(),
                "canonical_food_name": canon(name),
                "brands": (row.get("brands") or "").strip(),
                "categories": (row.get("categories") or "").strip(),
                "categories_tags": (row.get("categories_tags") or "").strip(),
                "labels_tags": (row.get("labels") or "").strip(),
                "allergens_tags": (row.get("allergens") or "").strip(),
                "ingredients_text": first_nonempty(row, ["ingredients_text_en", "ingredients_text_ms",
                                                         "ingredients_text_id"]),
                "quantity": (row.get("quantity") or "").strip(),
                "serving_size": (row.get("serving_size") or "").strip(),
            }

            src_used = ""
            for out_col, nut in NUTRIENTS.items():
                val = ""
                for setname, label in SETS:
                    v = (row.get(nut_col(setname, nut)) or "").strip()
                    if not v:
                        v = (row.get(nut_col(setname, nut, "100ml")) or "").strip()
                    if v:
                        val = v
                        if not src_used:
                            src_used = label
                        break
                try:
                    rec[out_col] = str(float(val)) if val else ""   # blank stays blank, never 0
                except ValueError:
                    rec[out_col] = ""
            rec["nutrition_source"] = src_used or "none"
            rec["nutriscore_grade"] = clean_grade(row.get("off:nutriscore_grade"))
            rec["nova_group"] = (row.get("off:nova_groups") or "").strip()
            rec["nova_group_num"] = nova_num(rec["nova_group"])
            rec["image_url"] = (row.get("link") or "").strip()
            rec["source_dataset"] = "Open Food Facts (Malaysia export)"
            rec["source_url"] = ("https://world.openfoodfacts.org/cgi/search.pl?action=process"
                                 "&tagtype_0=countries&tag_contains_0=contains&tag_0=malaysia"
                                 "&download=on&format=csv")
            rec["license"] = "ODbL 1.0"
            rec["fetched_at_utc"] = NOW
            out_rows.append(rec)

    # de-dup on barcode, keeping the record with the most populated fields
    best: dict[str, dict] = {}
    for r in out_rows:
        score = sum(1 for v in r.values() if v)
        if r["barcode"] not in best or score > best[r["barcode"]]["_score"]:
            best[r["barcode"]] = {**r, "_score": score}
    final = [{k: v for k, v in r.items() if k != "_score"} for r in best.values()]

    with open(OUT / "openfoodfacts_malaysia_products.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(final[0].keys()))
        w.writeheader(); w.writerows(final)

    cov = {c: sum(1 for r in final if r.get(c)) for c in NUTRIENTS}
    srcs: dict[str, int] = {}
    for r in final:
        srcs[r["nutrition_source"]] = srcs.get(r["nutrition_source"], 0) + 1
    n_nova = sum(1 for r in final if r.get("nova_group_num"))
    n_grade = sum(1 for r in final if r.get("nutriscore_grade"))
    print(f"  NOVA group parsed to 1-4: {n_nova}/{len(final)} ({100*n_nova/len(final):.0f}%)")
    print(f"  Nutri-Score (real grade):  {n_grade}/{len(final)} ({100*n_grade/len(final):.0f}%)")

    print(f"  input rows: {n_in:,}   skipped(no barcode): {skipped}   unique products: {len(final):,}")
    print("  nutrient coverage:")
    for c, n in cov.items():
        print(f"    {c:<24}{n:>6}/{len(final)}  ({100*n/len(final):.0f}%)")
    print(f"  nutrition source: {srcs}")

    manifest.append({
        "dataset": "Open Food Facts Malaysia", "output": "openfoodfacts_malaysia_products.csv",
        "official_source_url": rec["source_url"], "license": "ODbL 1.0 -- attribution REQUIRED",
        "raw_file": off_path.name, "raw_bytes": off_path.stat().st_size,
        "raw_sha256": sha256_file(off_path), "record_count": len(final), "fetched_at_utc": NOW,
        "notes": "Bulk CSV export (TAB-separated). Label nutrition preferred over OFF estimates; "
                 "`nutrition_source` records which was used. Missing nutrients left EMPTY, never 0.",
    })

(OUT / "reference_build_manifest.json").write_text(
    json.dumps({"generated_at_utc": NOW, "files": manifest}, indent=2), encoding="utf-8")
print(f"\nWrote {OUT/'reference_build_manifest.json'}")
