"""Deterministic, editable shelf-life estimates for grocery intake.

These dates are not OCR results and are never presented as a printed expiry.
They start from the day of recognition unless a caller supplies a reference
date, and are conservative defaults that help a user complete the review form.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date, timedelta


@dataclass(frozen=True)
class ExpiryEstimate:
    estimated_expiry_date: date
    estimate_days: int
    basis: str


def _normalized(value: str | None) -> str:
    return re.sub(r"\s+", " ", (value or "").strip().casefold())


# Estimates assume the user is adding food for home inventory after purchase or
# opening, so chilled/opened usability wins over unopened shelf-stable packaging.
_NAME_RULES: tuple[tuple[tuple[str, ...], int, str], ...] = (
    (("uht", "long life milk", "susu uht", "recombined milk"), 10, "opened refrigerated UHT milk"),
    (("infant formula", "milk powder", "powdered milk"), 270, "sealed milk powder"),
    (("fresh milk", "pasteurised milk", "pasteurized milk", "full cream milk", "milk"), 10, "refrigerated milk after opening"),
    (("yogurt", "yoghurt"), 14, "refrigerated yogurt"),
    (("cheese",), 21, "refrigerated cheese"),
    (("egg", "eggs", "telur"), 21, "refrigerated eggs"),
    (("raw fish", "fresh fish", "salmon", "tuna steak", "ikan"), 2, "fresh fish"),
    (("raw chicken", "fresh chicken", "chicken breast", "poultry", "ayam"), 2, "fresh poultry"),
    (("raw beef", "fresh beef", "steak", "raw meat", "daging"), 3, "fresh raw meat"),
    (("minced meat", "ground meat", "minced beef"), 2, "fresh minced meat"),
    (("bread", "baguette", "bun", "roll"), 5, "fresh bakery item"),
    (("cake", "pastry", "croissant"), 4, "fresh pastry"),
    (("leaf lettuce", "lettuce", "spinach", "kale", "leafy green", "sawi"), 5, "fresh leafy vegetables"),
    (("spring onion", "green onion", "scallion", "herb", "coriander", "parsley"), 7, "fresh herbs or alliums"),
    (("broccoli", "cauliflower", "tomato", "tomatoes", "carrot", "cucumber", "pepper"), 7, "fresh vegetables"),
    (("banana",), 5, "fresh bananas"),
    (("berry", "berries", "blueberry", "strawberry", "raspberry"), 4, "fresh berries"),
    (("apple", "orange", "pear", "lemon", "lime", "grapefruit"), 21, "whole fresh fruit"),
    (("avocado", "mango", "papaya", "dragon fruit"), 7, "ripe tropical fruit"),
    (("chocolate", "cocoa confectionery"), 270, "sealed chocolate"),
    (("biscuit", "cookie", "cracker", "wafer"), 180, "sealed dry snack"),
    (("potato chip", "crisps", "corn snack", "snack"), 120, "sealed snack"),
    (("instant noodle", "instant mee", "ramen"), 270, "sealed instant noodles"),
    (("rice", "pasta", "spaghetti", "macaroni", "flour", "oat"), 365, "sealed dry staple"),
    (("cereal", "granola", "muesli"), 180, "sealed breakfast cereal"),
    (("canned", "tin of", "tinned"), 365, "sealed canned food"),
    (("cooking oil", "olive oil", "vegetable oil"), 365, "sealed cooking oil"),
    (("soy sauce", "oyster sauce", "chilli sauce", "ketchup", "mayonnaise", "sauce"), 180, "sealed condiment"),
    (("jam", "peanut butter", "spread"), 180, "sealed spread"),
    (("frozen", "ice cream"), 90, "frozen food"),
    (("bottled water", "mineral water", "drinking water"), 365, "sealed bottled water"),
    (("juice", "soft drink", "soda", "malt drink", "beverage"), 180, "sealed beverage"),
)

_CATEGORY_RULES: dict[str, tuple[int, str]] = {
    "dairy": (10, "generic refrigerated dairy"),
    "meat": (3, "generic fresh meat"),
    "seafood": (2, "generic fresh seafood"),
    "protein": (5, "generic fresh protein"),
    "fruit": (10, "generic fresh fruit"),
    "vegetable": (7, "generic fresh vegetables"),
    "vegetables": (7, "generic fresh vegetables"),
    "bakery": (5, "generic bakery item"),
    "frozen": (90, "generic frozen food"),
    "beverage": (180, "generic sealed beverage"),
    "beverages": (180, "generic sealed beverage"),
    "pantry": (180, "generic sealed pantry food"),
}


def estimate_expiry(
    food_name: str,
    category: str | None = None,
    *,
    reference_date: date | None = None,
) -> ExpiryEstimate:
    """Return a conservative best-effort date from the food type.

    The result is intentionally separate from ``expiry_date_candidate``, which
    remains reserved for dates visibly read from packaging.
    """

    name = _normalized(food_name)
    category_name = _normalized(category)
    for needles, days, basis in _NAME_RULES:
        if any(needle in name for needle in needles):
            break
    else:
        days, basis = _CATEGORY_RULES.get(
            category_name,
            (30, "generic grocery fallback"),
        )
    start = reference_date or date.today()
    return ExpiryEstimate(
        estimated_expiry_date=start + timedelta(days=days),
        estimate_days=days,
        basis=basis,
    )
