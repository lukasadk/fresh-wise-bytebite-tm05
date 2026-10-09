"""Epic 9 -- Estimated Food Value Insights: price matching and RM maths.

Every RM figure in the app comes from here. Values are ESTIMATES from a
one-time snapshot of PriceCatcher (KPDN & DOSM, CC BY 4.0): the national
median price of each item for one month, shipped as app/data/price_snapshot.csv
(built by scripts/build_price_snapshot.py). The app never asks for, scans or
stores what the user paid.

How an item gets a value (AC 9.1.1 / 9.1.2)
-------------------------------------------
1. Name: the pantry name must be >= 85% similar (ignoring case, extra spaces,
   punctuation and size tokens like "1L") to a snapshot food's English name or
   one of its aliases. Same difflib ratio and threshold as Epic 8's matching.
2. Unit: the user's unit must convert to the PriceCatcher unit:
       g / kg            <-> items priced by weight      (RM per g)
       ml / L            <-> items priced by volume      (RM per ml)
       pcs / blank       <-> items priced per piece      ("30 biji" eggs -> per egg)
       carton/pack/...   <-> packaged items              (one pack = one PriceCatcher pack)
   Weight never converts to volume (no density guess) and a piece of a food
   sold loose by the kilo has no weight, so those stay unvalued rather than
   inventing a figure.
3. The stored value is RM per ONE of the user's own units, so
       value of what's left   = est_unit_value_rm x food_item.quantity
       value of what's wasted = est_unit_value_rm x log.quantity
   with no further conversion anywhere else.
"""
from __future__ import annotations

import csv
import re
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date
from decimal import ROUND_HALF_UP, Decimal
from difflib import SequenceMatcher
from functools import lru_cache
from pathlib import Path
from typing import Any

SNAPSHOT_PATH = Path(__file__).resolve().parent / "data" / "price_snapshot.csv"

# AC 9.1.1 -- "at least 85% similar". Same value as Epic 8 (app/shopping.py).
SIMILARITY_THRESHOLD = 0.85
# AC 9.2.6 / 9.3.3 -- below this share of valued items, show no total.
MIN_COVERAGE = 0.5
# AC 9.2.1 -- "expire within the next 3 days (including today)". Matches the
# Use First page's own Use Today (0) + Use Soon (1-3) bands.
AT_RISK_DAYS = 3

UNIT_VALUE_SCALE = Decimal("0.00001")   # food_item.est_unit_value_rm is NUMERIC(12,5)
RM_SCALE = Decimal("0.01")

MONTH_NAMES = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
]


# ---------------------------------------------------------------------------
# Units
# ---------------------------------------------------------------------------

_MASS = {"g": 1, "gm": 1, "gms": 1, "gr": 1, "gram": 1, "grams": 1, "gramme": 1, "grammes": 1,
         "kg": 1000, "kgs": 1000, "kilo": 1000, "kilos": 1000, "kilogram": 1000, "kilograms": 1000}
_VOLUME = {"ml": 1, "mls": 1, "millilitre": 1, "millilitres": 1, "milliliter": 1, "milliliters": 1,
           "l": 1000, "ltr": 1000, "ltrs": 1000, "litre": 1000, "litres": 1000, "liter": 1000, "liters": 1000}
_COUNT = {"pc", "pcs", "pce", "pces", "piece", "pieces", "unit", "units", "item", "items", "ea", "each",
          "whole", "no", "nos", "biji", "egg", "eggs", "fruit", "fruits", "x"}
_PACKAGE = {"carton", "cartons", "pack", "packs", "packet", "packets", "pkt", "pkts", "bottle", "bottles",
            "btl", "can", "cans", "tin", "tins", "box", "boxes", "bag", "bags", "jar", "jars", "tub", "tubs",
            "block", "blocks", "bar", "bars", "sachet", "sachets", "pouch", "pouches", "container",
            "containers", "tray", "trays", "bundle", "bundles", "cup", "cups", "punnet", "punnets", "loaf",
            "loaves", "roll", "rolls", "bungkus", "kotak", "botol", "paket", "tin"}


@dataclass(frozen=True)
class PriceUnit:
    """What one PriceCatcher price buys: an amount in g or ml, and/or a piece count."""
    base: str | None      # 'g' | 'ml' | None
    amount: float | None  # in `base`
    count: int | None     # pieces per priced unit ("30 biji" -> 30, "5 X 79g" -> 5)


def parse_price_unit(raw: str | None) -> PriceUnit:
    s = (raw or "").strip().lower().replace("+-", "").replace("±", "").strip()
    s = re.sub(r"\s+", " ", s)
    multi = re.fullmatch(r"(\d+)\s*x\s*(\d+(?:\.\d+)?)\s*(g|ml)", s)
    if multi:
        n, size, base = int(multi.group(1)), float(multi.group(2)), multi.group(3)
        return PriceUnit(base, n * size, n)
    measure = re.fullmatch(r"(\d+(?:\.\d+)?)\s*([a-z]+)", s)
    if measure:
        qty, word = float(measure.group(1)), measure.group(2)
        if word in _MASS:
            return PriceUnit("g", qty * _MASS[word], None)
        if word in _VOLUME:
            return PriceUnit("ml", qty * _VOLUME[word], None)
        if word in {"biji", "beg", "pcs", "unit", "units", "ekor"}:
            return PriceUnit(None, None, int(qty))
    return PriceUnit(None, None, None)


def classify_user_unit(raw: str | None) -> tuple[str, float] | None:
    """('mass', grams per unit) | ('volume', ml per unit) | ('count', pieces) |
    ('pack', 1) | ('blank', 1) -- or None when the unit isn't understood."""
    s = re.sub(r"[^a-z ]", "", (raw or "").strip().lower()).strip()
    if not s:
        return ("blank", 1)
    if s in _MASS:
        return ("mass", _MASS[s])
    if s in _VOLUME:
        return ("volume", _VOLUME[s])
    if s in _COUNT:
        return ("count", 1)
    if s in {"dozen", "dozens"}:
        return ("count", 12)
    if s in _PACKAGE:
        return ("pack", 1)
    return None


# ---------------------------------------------------------------------------
# Snapshot
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class PriceItem:
    item_code: str
    month: date
    name_en: str
    keys: tuple[str, ...]      # normalised name + aliases
    sold_as: str               # 'pack' | 'loose'
    item: str                  # original Malay PriceCatcher name, for traceability
    unit_raw: str
    unit: PriceUnit
    median_rm: Decimal

    def value_per_user_unit(self, user_unit: str | None) -> Decimal | None:
        """RM for ONE of the user's units, or None when the units don't convert."""
        kind = classify_user_unit(user_unit)
        if kind is None or self.median_rm <= 0:
            return None
        what, factor = kind
        u = self.unit
        if what == "mass":
            return self.median_rm / Decimal(str(u.amount)) * Decimal(str(factor)) if u.base == "g" and u.amount else None
        if what == "volume":
            return self.median_rm / Decimal(str(u.amount)) * Decimal(str(factor)) if u.base == "ml" and u.amount else None
        if what in ("count", "blank"):
            if u.count:
                return self.median_rm / Decimal(u.count) * Decimal(str(factor))
            # "2 pcs" of milk = two cartons. A piece of something sold loose by
            # the kilo has no known weight, so it stays unvalued.
            return self.median_rm * Decimal(str(factor)) if self.sold_as == "pack" else None
        if what == "pack":
            return self.median_rm if self.sold_as == "pack" else None
        return None


@dataclass(frozen=True)
class Snapshot:
    month: date
    items: tuple[PriceItem, ...]

    @property
    def label(self) -> str:
        return price_label(self.month)


def price_label(month: date) -> str:
    """AC 9.1.4 -- the Grey source label shown under every RM figure."""
    return f"Based on Malaysian market prices, {MONTH_NAMES[month.month - 1]} {month.year} (PriceCatcher)"


_SIZE_TOKEN = re.compile(r"\b\d+(?:\.\d+)?\s*(?:g|gm|kg|ml|l|ltr|pcs|pc|pack|x)\b")


def normalise_name(name: str | None) -> str:
    s = (name or "").lower().replace("&", " and ")
    s = _SIZE_TOKEN.sub(" ", s)
    s = re.sub(r"[^a-z0-9 ]+", " ", s.replace("'", ""))
    return re.sub(r"\s+", " ", s).strip()


def _similarity(a: str, b: str) -> float:
    if not a or not b:
        return 0.0
    if a == b:
        return 1.0
    return SequenceMatcher(None, a, b).ratio()


def load_snapshot(path: Path = SNAPSHOT_PATH) -> Snapshot:
    items: list[PriceItem] = []
    with open(path, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            try:
                median = Decimal(row["median_price_rm"])
                month = date.fromisoformat(row["month"][:10])
            except Exception:
                continue
            keys = [normalise_name(row["name_en"])]
            keys += [normalise_name(a) for a in (row.get("aliases") or "").split("|") if a.strip()]
            items.append(PriceItem(
                item_code=row["item_code"].strip(),
                month=month,
                name_en=row["name_en"].strip(),
                keys=tuple(dict.fromkeys(k for k in keys if k)),
                sold_as=(row.get("sold_as") or "loose").strip(),
                item=row.get("item") or "",
                unit_raw=row.get("unit") or "",
                unit=parse_price_unit(row.get("unit")),
                median_rm=median,
            ))
    if not items:
        raise RuntimeError(f"Price snapshot {path} has no usable rows")
    return Snapshot(month=max(i.month for i in items), items=tuple(items))


@lru_cache(maxsize=1)
def get_snapshot() -> Snapshot:
    return load_snapshot()


# ---------------------------------------------------------------------------
# Estimating one item (AC 9.1.1 / 9.1.2)
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Estimate:
    unit_value_rm: Decimal | None     # RM per one of the user's units; None = no match
    item_code: str | None
    month: date                       # snapshot month the estimate was made against
    matched_name: str | None = None


def estimate_unit_value(name: str | None, unit: str | None, snapshot: Snapshot | None = None) -> Estimate:
    snap = snapshot or get_snapshot()
    wanted = normalise_name(name)
    if not wanted:
        return Estimate(None, None, snap.month)
    scored: list[tuple[float, PriceItem]] = []
    for item in snap.items:
        score = max(_similarity(wanted, key) for key in item.keys)
        if score >= SIMILARITY_THRESHOLD:
            scored.append((score, item))
    # Best name match first; if its unit can't convert, a slightly weaker match
    # that does convert is still a real >=85% match, so try it before giving up.
    scored.sort(key=lambda pair: pair[0], reverse=True)
    for _, item in scored:
        value = item.value_per_user_unit(unit)
        if value is not None and value > 0:
            return Estimate(value.quantize(UNIT_VALUE_SCALE, rounding=ROUND_HALF_UP), item.item_code,
                            snap.month, item.name_en)
    return Estimate(None, None, snap.month)


def apply_estimate(food_item: Any, snapshot: Snapshot | None = None) -> Estimate:
    """Write the estimate onto a FoodItem (or anything with the same attributes)."""
    est = estimate_unit_value(food_item.name, food_item.unit, snapshot)
    food_item.est_unit_value_rm = est.unit_value_rm
    food_item.est_price_item_code = est.item_code
    food_item.est_price_month = est.month
    return est


def money(value: Decimal | float | None) -> float | None:
    if value is None:
        return None
    return float(Decimal(str(value)).quantize(RM_SCALE, rounding=ROUND_HALF_UP))


def item_value(unit_value_rm: Decimal | float | None, quantity: Decimal | float | None) -> Decimal | None:
    if unit_value_rm is None or quantity is None:
        return None
    return Decimal(str(unit_value_rm)) * Decimal(str(quantity))


# ---------------------------------------------------------------------------
# Value wasted in a month (AC 9.3.1 - 9.3.3, 9.4.1, 9.4.2)
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class WastedRow:
    name: str
    category: str | None
    unit: str | None
    quantity: Decimal
    unit_value_rm: Decimal | None


def summarise_wasted(rows: Iterable[WastedRow]) -> dict[str, Any]:
    rows = list(rows)
    wasted_count = len(rows)
    valued = [r for r in rows if r.unit_value_rm is not None]
    coverage = (len(valued) / wasted_count) if wasted_count else 0.0
    total = sum((item_value(r.unit_value_rm, r.quantity) for r in valued), Decimal("0"))

    by_category: dict[str, Decimal] = {}
    for r in valued:
        label = (r.category or "").strip() or "Other"
        label = "Other" if label.casefold() == "other" else label
        by_category[label] = by_category.get(label, Decimal("0")) + item_value(r.unit_value_rm, r.quantity)
    ranked = sorted(by_category.items(), key=lambda kv: kv[1], reverse=True)
    # AC 9.4.1 -- top 5 categories get their own bar, the rest fold into "Other".
    # A real category literally named "Other" folds into the same bar.
    top = [(k, v) for k, v in ranked if k != "Other"][:5]
    rest = sum((v for k, v in ranked if (k, v) not in top), Decimal("0"))
    categories = [{"label": k, "value_rm": money(v), "is_other": False} for k, v in top if v > 0]
    if rest > 0:
        categories.append({"label": "Other", "value_rm": money(rest), "is_other": True})

    grouped: dict[str, dict[str, Any]] = {}
    for r in valued:
        key = " ".join(r.name.split()).casefold()
        g = grouped.setdefault(key, {"name": " ".join(r.name.split()), "category": r.category, "unit": r.unit,
                                     "value": Decimal("0"), "quantity": Decimal("0")})
        g["value"] += item_value(r.unit_value_rm, r.quantity)
        g["quantity"] += r.quantity
    ranked_items = sorted(grouped.values(), key=lambda g: g["value"], reverse=True)
    top_items = ranked_items[:3]

    # Wasted items with no estimate (no PriceCatcher match / unit can't be
    # converted), grouped by name the same way -- listed on the low-coverage
    # state so the user can see which items are missing a price.
    unpriced: dict[str, dict[str, Any]] = {}
    for r in rows:
        if r.unit_value_rm is not None:
            continue
        key = " ".join(r.name.split()).casefold()
        g = unpriced.setdefault(key, {"name": " ".join(r.name.split()), "category": r.category,
                                      "unit": r.unit, "quantity": Decimal("0")})
        g["quantity"] += r.quantity

    def _item(g: dict[str, Any]) -> dict[str, Any]:
        return {"name": g["name"], "category": g["category"], "unit": g["unit"],
                "value_rm": money(g["value"]), "quantity": float(g["quantity"])}

    return {
        "wasted_count": wasted_count,
        "valued_count": len(valued),
        "unvalued_count": wasted_count - len(valued),
        "coverage": round(coverage, 4),
        "sufficient": wasted_count > 0 and coverage >= MIN_COVERAGE,
        "total_rm": money(total),
        "by_category": categories,
        "top_items": [_item(g) for g in top_items if g["value"] > 0],
        # Every valued item, highest first -- the "See all" list (AC 9.4.2).
        "all_items": [_item(g) for g in ranked_items if g["value"] > 0],
        "unpriced_items": [
            {"name": g["name"], "category": g["category"], "unit": g["unit"], "quantity": float(g["quantity"])}
            for g in unpriced.values()
        ],
    }
