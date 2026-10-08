"""Small recipe RAG for the mobile MVP.

This is a curated and deterministic Malaysian recipe knowledge base. Recipes
are retrieved and ranked first, then an optional OpenAI-compatible chat API may
polish the top candidates. The model is never allowed to invent recipes outside
the retrieved context.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
import json
from functools import lru_cache
from hashlib import sha256
from pathlib import Path
from time import perf_counter
from typing import Any

import httpx

from .api_recognition import _chat_completions_url
from .config import PROJECT_ROOT, get_settings
from .schemas import (
    RecipeInventoryItem,
    RecipeRecommendRequest,
    RecipeRecommendResponse,
    RecipeRecommendationItem,
)


RECIPE_KB_PATHS = (
    PROJECT_ROOT / "data" / "recipe_rag" / "mini_recipes.json",
    PROJECT_ROOT / "data" / "recipe_rag" / "malaysian_recipes_expanded.json",
    PROJECT_ROOT / "data" / "recipe_rag" / "generated_recipes_500.json",
)


RECIPE_IMAGE_URLS: dict[str, str] = {
    "rice": "https://images.unsplash.com/photo-1603133872878-684f208fb84b?auto=format&fit=crop&w=1200&q=80",
    "noodles": "https://images.unsplash.com/photo-1569718212165-3a8278d5f624?auto=format&fit=crop&w=1200&q=80",
    "curry": "https://images.unsplash.com/photo-1603894584373-5ac82b2ae398?auto=format&fit=crop&w=1200&q=80",
    "egg": "https://images.unsplash.com/photo-1525351484163-7529414344d8?auto=format&fit=crop&w=1200&q=80",
    "vegetable": "https://images.unsplash.com/photo-1540420773420-3366772f4999?auto=format&fit=crop&w=1200&q=80",
    "soup": "https://images.unsplash.com/photo-1547592166-23ac45744acd?auto=format&fit=crop&w=1200&q=80",
    "fish": "https://images.unsplash.com/photo-1467003909585-2f8a72700288?auto=format&fit=crop&w=1200&q=80",
    # Project-owned fallback photos. These deliberately show the named food
    # category instead of pretending that one generic rice/toast photo is the
    # exact finished dish for hundreds of different recipes.
    "bread": "/static/recipe-images/fallback-bread-v2.png",
    "milk": "/static/recipe-images/fallback-milk-v2.png",
    "fruit": "/static/recipe-images/fallback-fruit-v2.png",
}


# Recipe images are resolved from the most specific evidence first.  The old
# implementation selected the first broad keyword it saw (for example, "egg")
# and could therefore show a toast photo for an egg-and-rice recipe.  These
# licensed Wikimedia images cover the common multi-ingredient combinations
# where that behaviour was especially misleading.
RECIPE_IMAGE_BY_ID: dict[str, str] = {
    "my-009": "https://upload.wikimedia.org/wikipedia/commons/7/76/Telur_goreng_tomato_kacau_dengan_nasi.jpg",
}

RECIPE_IMAGE_BY_TITLE: dict[str, str] = {
    "tomato egg rice": "https://upload.wikimedia.org/wikipedia/commons/7/76/Telur_goreng_tomato_kacau_dengan_nasi.jpg",
}

RECIPE_IMAGE_COMBINATIONS: tuple[tuple[frozenset[str], str], ...] = (
    (
        frozenset({"tomato", "egg", "rice"}),
        "https://upload.wikimedia.org/wikipedia/commons/7/76/Telur_goreng_tomato_kacau_dengan_nasi.jpg",
    ),
    (
        frozenset({"potato", "egg", "rice"}),
        "/static/recipe-images/potato-egg-rice-v2.jpg",
    ),
    (
        frozenset({"egg", "rice"}),
        "https://thumb.wikimedia.org/wikipedia/commons/thumb/8/8e/Egg_Fried_rice.jpg/1280px-Egg_Fried_rice.jpg",
    ),
)


ALIASES: dict[str, str] = {
    "eggs": "egg",
    "egg": "egg",
    "tomatoes": "tomato",
    "cherry tomato": "tomato",
    "cherry tomatoes": "tomato",
    "tomato": "tomato",
    "potatoes": "potato",
    "potato": "potato",
    "spinach leaves": "spinach",
    "spinach": "spinach",
    "chicken breast": "chicken",
    "chicken breasts": "chicken",
    "chicken": "chicken",
    "full cream milk": "milk",
    "uht milk": "milk",
    "milk": "milk",
    "soy milk": "soy milk",
    "soya milk": "soy milk",
    "orange juice": "orange juice",
    "sparkling lemon": "sparkling lemon",
    "milo": "milo",
    "koko krunch": "cereal",
    "koko krunch duo": "cereal",
    "cereal": "cereal",
    "shin ramyun": "instant noodles",
    "ramyun": "instant noodles",
    "instant noodles": "instant noodles",
    "hot pot soup base": "hot pot soup base",
    "soup base": "hot pot soup base",
    "prego mushroom carbonara": "carbonara sauce",
    "prego mushroom carbonara mac": "carbonara sauce",
    "carbonara": "carbonara sauce",
    "carbonara sauce": "carbonara sauce",
    "mayonnaise": "mayonnaise",
    "kewpie mayonnaise": "mayonnaise",
    "sesame paste": "sesame paste",
    "kitkat": "chocolate",
    "kitkat chocolate": "chocolate",
    "chocolate drink": "chocolate drink",
    "chocolate": "chocolate",
    "chipsmore": "cookies",
    "chips more": "cookies",
    "chips more mini hazelnut": "cookies",
    "cookies": "cookies",
    "rice": "rice",
    "banana": "banana",
    "bananas": "banana",
    "blueberries": "blueberry",
    "blueberry": "blueberry",
    "watermelon": "watermelon",
    "garlic": "garlic",
    "mushrooms": "mushroom",
    "mushroom": "mushroom",
    "salmon": "salmon",
    "edamame": "edamame",
    "spring onion": "spring onion",
    "spring onions": "spring onion",
    "green onion": "green onion",
    "green onions": "green onion",
    "chives": "chive",
    "chive": "chive",
    "brown rice vermicelli": "brown rice vermicelli",
    "vermicelli": "brown rice vermicelli",
    "rice vermicelli": "brown rice vermicelli",
    "noodles": "noodles",
    "noodle": "noodles",
    "flat rice noodles": "flat rice noodles",
    "kway teow": "flat rice noodles",
    "spaghetti": "spaghetti",
    "pasta": "pasta",
    "yogurt": "yogurt",
    "yoghurt": "yogurt",
    "peanut butter": "peanut butter",
    "butter": "butter",
    "shrimp": "shrimp",
    "prawn": "shrimp",
    "prawns": "shrimp",
    "carrots": "carrot",
    "carrot": "carrot",
    "onions": "onion",
    "onion": "onion",
    "choy sum": "choy sum",
    "sawi": "choy sum",
    "bread": "bread",
    "baguette": "bread",
    "flatbread": "flatbread",
    "roti canai": "flatbread",
    "rice": "rice",
    "oyster sauce": "oyster sauce",
    "tofu": "tofu",
    "tauhu": "tofu",
    "soy sauce": "soy sauce",
    "kicap": "soy sauce",
    "sweet soy sauce": "soy sauce",
    "ginger": "ginger",
    "shallot": "shallot",
    "shallots": "shallot",
    "coconut milk": "coconut milk",
    "santan": "coconut milk",
    "curry powder": "curry powder",
    "curry": "curry powder",
    "sambal": "sambal",
    "anchovy": "anchovy",
    "anchovies": "anchovy",
    "ikan bilis": "anchovy",
    "fish": "fish",
    "ikan": "fish",
    "sardine": "sardine",
    "sardines": "sardine",
    "cucumber": "cucumber",
    "kangkung": "kangkung",
    "water spinach": "kangkung",
    "belacan": "shrimp paste",
    "shrimp paste": "shrimp paste",
    "tamarind": "tamarind",
    "asam": "tamarind",
    "okra": "okra",
    "lady finger": "okra",
    "lemongrass": "lemongrass",
    "serai": "lemongrass",
    "turmeric": "turmeric",
    "stock": "stock",
    "peanuts": "peanut",
    "peanut": "peanut",
    "chilli sauce": "chilli sauce",
    "chilli": "chilli",
    "chili": "chilli",
    "lemon": "lemon",
    "lime": "lime",
    "corn": "corn",
    "sweet corn": "corn",
    "flour": "flour",
    "plain flour": "flour",
    "cabbage": "cabbage",
    "long beans": "long beans",
    "bean sprouts": "bean sprouts",
    "sprouts": "bean sprouts",
    "curry sauce": "curry sauce",
    "sugar": "sugar",
    "salt": "salt",
}


@dataclass(frozen=True)
class RecipeDoc:
    recipe_id: str
    title: str
    ingredients: tuple[str, ...]
    ingredient_quantities: tuple[str, ...]
    steps: tuple[str, ...]
    image_url: str
    image_alt: str
    prep_minutes: int | None
    cook_minutes: int | None
    tags: tuple[str, ...]
    servings: int | None


@dataclass(frozen=True)
class ScoredRecipe:
    recipe: RecipeDoc
    matched: tuple[str, ...]
    missing: tuple[str, ...]
    priority_matched: tuple[str, ...]
    coverage_score: float
    expiry_score: float
    score: float
    soonest_expiry_days: int | None = None


def _clean(value: str) -> str:
    return " ".join(value.lower().replace("_", " ").replace("-", " ").split())


def _canonicalize(value: str) -> str:
    cleaned = _clean(value)
    if cleaned in ALIASES:
        return ALIASES[cleaned]
    for alias, canonical in sorted(ALIASES.items(), key=lambda pair: len(pair[0]), reverse=True):
        if alias in cleaned:
            return canonical
    if cleaned.endswith("ies") and len(cleaned) > 3:
        return f"{cleaned[:-3]}y"
    if cleaned.endswith("es") and len(cleaned) > 3:
        return cleaned[:-2]
    if cleaned.endswith("s") and len(cleaned) > 3:
        return cleaned[:-1]
    return cleaned


def _display_name(canonical: str) -> str:
    special = {
        "choy sum": "Choy sum",
        "brown rice vermicelli": "Brown rice vermicelli",
        "peanut butter": "Peanut butter",
        "spring onion": "Spring onion",
        "green onion": "Green onion",
    }
    return special.get(canonical, canonical.capitalize())


def _image_for_keywords(*values: str) -> str:
    title = _clean(values[0]) if values else ""
    text = " ".join(values).lower()
    if any(value in text for value in ("noodle", "mee", "bee hoon", "vermicelli", "laksa")):
        return RECIPE_IMAGE_URLS["noodles"]
    # When the recipe itself is a toast/roti/sandwich dish, bread is the
    # identity of the finished plate even if curry or egg appears as a side.
    if any(value in title for value in ("bread", "roti", "toast", "sandwich")):
        return RECIPE_IMAGE_URLS["bread"]
    if any(value in text for value in ("curry", "kari", "masak lemak", "santan")):
        return RECIPE_IMAGE_URLS["curry"]
    if any(value in text for value in ("fish", "ikan", "sardine", "salmon")):
        return RECIPE_IMAGE_URLS["fish"]
    if any(value in text for value in ("soup", "sup", "porridge", "bubur")):
        return RECIPE_IMAGE_URLS["soup"]
    if any(value in text for value in ("bread", "roti", "toast", "sandwich")):
        return RECIPE_IMAGE_URLS["bread"]
    fruit_words = ("fruit", "banana", "apple", "mango", "orange", "blueberry", "watermelon")
    savoury_words = ("rice", "noodle", "chicken", "fish", "beef", "curry", "soup")
    if any(value in title for value in fruit_words) and not any(value in title for value in savoury_words):
        return RECIPE_IMAGE_URLS["fruit"]
    # Coconut/soy milk used inside a savoury dish must not select a dairy
    # photo. A milk image is only used when milk is the recipe's main identity.
    if (
        any(value in title for value in ("milk", "yogurt", "yoghurt", "dairy"))
        and not any(value in title for value in savoury_words)
    ):
        return RECIPE_IMAGE_URLS["milk"]
    if any(value in text for value in ("vegetable", "kangkung", "choy sum", "spinach", "sawi")):
        return RECIPE_IMAGE_URLS["vegetable"]
    if "egg" in text or "telur" in text:
        return RECIPE_IMAGE_URLS["egg"]
    return RECIPE_IMAGE_URLS["rice"]


@lru_cache(maxsize=1)
def _generated_recipe_image_manifest() -> dict[str, Any]:
    manifest_path = (
        PROJECT_ROOT / "app" / "static" / "recipe-images" / "ai-generated" / "manifest.json"
    )
    if not manifest_path.is_file():
        return {}
    try:
        payload = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, ValueError, TypeError):
        return {}
    return payload if isinstance(payload, dict) else {}


def _image_for_recipe(
    recipe_id: str,
    title: str,
    ingredients: list[str] | tuple[str, ...],
    explicit_url: str | None = None,
) -> str:
    """Return the closest known image without letting a broad keyword win."""

    generated_entry = _generated_recipe_image_manifest().get(recipe_id)
    generated_path = generated_entry.get("path") if isinstance(generated_entry, dict) else None
    if isinstance(generated_path, str) and generated_path.startswith("/static/recipe-images/"):
        generated_file = PROJECT_ROOT / "app" / "static" / generated_path.removeprefix("/static/")
        if generated_file.is_file():
            return generated_path

    if recipe_id in RECIPE_IMAGE_BY_ID:
        return RECIPE_IMAGE_BY_ID[recipe_id]

    cleaned_title = _clean(title)
    if cleaned_title in RECIPE_IMAGE_BY_TITLE:
        return RECIPE_IMAGE_BY_TITLE[cleaned_title]

    canonical_ingredients = {_canonicalize(value) for value in ingredients if value}
    title_tokens = {
        canonical
        for alias, canonical in ALIASES.items()
        if alias in cleaned_title
    }
    recipe_tokens = canonical_ingredients | title_tokens
    for required, image_url in RECIPE_IMAGE_COMBINATIONS:
        if required.issubset(recipe_tokens):
            return image_url

    # The 500 synthetic hf-my records reused eleven representative source
    # images across hundreds of ingredient variants. Those URLs are useful as
    # dataset provenance but are not reliable recipe-card photos. Prefer the
    # title/ingredient fallback unless an exact per-recipe AI image exists in
    # the manifest (handled first above).
    if explicit_url and explicit_url.strip() and not recipe_id.startswith("hf-my-"):
        return explicit_url.strip()
    return _image_for_keywords(title, *ingredients)


def hosted_recipe_image_path(source_url: str) -> str:
    """Use an API-hosted image when the cache contains this source URL."""

    if source_url.startswith("/static/recipe-images/"):
        return source_url
    filename = f"{sha256(source_url.encode('utf-8')).hexdigest()[:20]}.jpg"
    cached = PROJECT_ROOT / "app" / "static" / "recipe-images" / filename
    if cached.is_file():
        return f"/static/recipe-images/{filename}"
    return source_url


@lru_cache(maxsize=1)
def load_recipe_docs() -> tuple[RecipeDoc, ...]:
    payload: list[dict[str, Any]] = []
    for path in RECIPE_KB_PATHS:
        if path.exists():
            payload.extend(json.loads(path.read_text(encoding="utf-8")))
    docs: list[RecipeDoc] = []
    for entry in payload:
        title = str(entry["title"])
        raw_ingredients = [str(value) for value in entry["ingredients"]]
        docs.append(
            RecipeDoc(
                recipe_id=str(entry["recipe_id"]),
                title=title,
                ingredients=tuple(_canonicalize(value) for value in raw_ingredients),
                ingredient_quantities=tuple(
                    str(value).strip()
                    for value in entry.get("ingredient_quantities", [])
                    if str(value).strip()
                ),
                steps=tuple(str(value).strip() for value in entry["steps"] if str(value).strip()),
                image_url=_image_for_recipe(
                    str(entry["recipe_id"]),
                    title,
                    raw_ingredients,
                    str(entry.get("image_url") or ""),
                ),
                image_alt=str(entry.get("image_alt") or f"Serving suggestion for {title}"),
                prep_minutes=entry.get("prep_minutes") if isinstance(entry.get("prep_minutes"), int) else None,
                cook_minutes=entry.get("cook_minutes") if isinstance(entry.get("cook_minutes"), int) else None,
                tags=tuple(str(value).strip() for value in entry.get("tags", []) if str(value).strip()),
                servings=entry.get("servings") if isinstance(entry.get("servings"), int) else None,
            )
        )
    return tuple(docs)


def _expiry_days(item: RecipeInventoryItem, today: date) -> int | None:
    if item.expiry_days is not None:
        return item.expiry_days
    if item.expiry_date is not None:
        return (item.expiry_date - today).days
    return None


def _inventory_tokens(items: list[RecipeInventoryItem]) -> tuple[set[str], set[str]]:
    today = date.today()
    pantry: set[str] = set()
    priority: set[str] = set()
    for item in items:
        token = _canonicalize(item.name)
        if token in {"water", "mineral water", "unknown", "unidentified grocery"}:
            continue
        pantry.add(token)
        days = _expiry_days(item, today)
        if days is not None and days <= 3:
            priority.add(token)
    return pantry, priority


def rank_recipes(request: RecipeRecommendRequest, top_k: int = 5) -> tuple[list[ScoredRecipe], list[str], list[str]]:
    pantry, priority = _inventory_tokens(request.inventory)
    expiry_by_ingredient: dict[str, int] = {}
    today = date.today()
    for item in request.inventory:
        token = _canonicalize(item.name)
        days = _expiry_days(item, today)
        if token and days is not None and days >= 0:
            expiry_by_ingredient[token] = min(days, expiry_by_ingredient.get(token, days))
    scored: list[ScoredRecipe] = []
    for recipe in load_recipe_docs():
        recipe_ingredients = set(recipe.ingredients)
        matched = tuple(sorted(recipe_ingredients & pantry))
        if not matched:
            continue
        missing = tuple(sorted(recipe_ingredients - pantry))
        priority_matched = tuple(sorted(recipe_ingredients & priority))
        coverage = len(matched) / max(1, len(recipe_ingredients))
        expiry = len(priority_matched) / max(1, len(priority))
        few_missing_bonus = max(0.0, 1.0 - (len(missing) / max(1, len(recipe_ingredients))))
        score = round((0.50 * coverage) + (0.35 * expiry) + (0.15 * few_missing_bonus), 4)
        scored.append(
            ScoredRecipe(
                recipe=recipe,
                matched=matched,
                missing=missing,
                priority_matched=priority_matched,
                coverage_score=round(coverage, 4),
                expiry_score=round(expiry, 4),
                score=score,
                soonest_expiry_days=min(
                    (expiry_by_ingredient[value] for value in matched if value in expiry_by_ingredient),
                    default=None,
                ),
            )
        )
    if request.selection_mode:
        # The user's taps are the strongest intent signal: first cover the most
        # selected foods, then break ties with expiring-sooner items.
        scored.sort(
            key=lambda item: (
                -len(item.matched),
                -len(item.priority_matched),
                item.soonest_expiry_days if item.soonest_expiry_days is not None else 10**9,
                -item.score,
                item.recipe.title.casefold(),
            )
        )
    else:
        scored.sort(key=lambda item: (item.score, len(item.priority_matched), len(item.matched)), reverse=True)
    return scored[:top_k], sorted(pantry), sorted(priority)


def _fallback_reason(scored: ScoredRecipe, language: str) -> str:
    matched = ", ".join(_display_name(value) for value in scored.matched)
    priority = ", ".join(_display_name(value) for value in scored.priority_matched)
    missing = ", ".join(_display_name(value) for value in scored.missing[:3])
    if language == "zh":
        reason = f"可使用现有食材：{matched}。"
        if priority:
            reason += f" 其中 {priority} 临期，建议优先使用。"
        if missing:
            reason += f" 还缺少：{missing}。"
        return reason
    reason = f"Uses ingredients you already have: {matched}."
    if priority:
        reason += f" Prioritises expiring items: {priority}."
    if missing:
        reason += f" Missing: {missing}."
    return reason


def _to_recommendation(scored: ScoredRecipe, *, language: str, ai_enhanced: bool = False) -> RecipeRecommendationItem:
    return RecipeRecommendationItem(
        recipe_id=scored.recipe.recipe_id,
        title=scored.recipe.title,
        reason=_fallback_reason(scored, language),
        available_ingredients=[_display_name(value) for value in scored.matched],
        priority_ingredients=[_display_name(value) for value in scored.priority_matched],
        missing_ingredients=[_display_name(value) for value in scored.missing],
        ingredient_quantities=list(scored.recipe.ingredient_quantities),
        steps=list(scored.recipe.steps),
        image_url=scored.recipe.image_url,
        image_alt=scored.recipe.image_alt,
        prep_minutes=scored.recipe.prep_minutes,
        cook_minutes=scored.recipe.cook_minutes,
        tags=list(scored.recipe.tags),
        servings=scored.recipe.servings,
        score=scored.score,
        ai_enhanced=ai_enhanced,
    )


def _extract_chat_content(payload: dict[str, Any]) -> str:
    content = payload.get("choices", [{}])[0].get("message", {}).get("content")
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        parts = [
            str(part.get("text", ""))
            for part in content
            if isinstance(part, dict) and part.get("type") in {None, "text"}
        ]
        return "".join(parts).strip()
    return ""


def _parse_json_object(text: str) -> dict[str, Any]:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.strip("`")
        if cleaned.lower().startswith("json"):
            cleaned = cleaned[4:].strip()
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start >= 0 and end > start:
        cleaned = cleaned[start : end + 1]
    payload = json.loads(cleaned)
    if not isinstance(payload, dict):
        raise ValueError("AI recipe response must be a JSON object.")
    return payload


def _ai_polish(
    scored: list[ScoredRecipe],
    request: RecipeRecommendRequest,
) -> tuple[list[RecipeRecommendationItem] | None, str | None, str | None]:
    settings = get_settings()
    if not request.use_ai:
        return None, None, "AI enhancement disabled by request."
    recipe_model = (settings.api_recipe_model or settings.api_model or "").strip()
    if not settings.api_base_url or not recipe_model:
        return None, None, "AI recipe enhancement skipped because WW_API_BASE_URL or WW_API_RECIPE_MODEL is not configured."
    if settings.api_key_required and not (settings.api_key and settings.api_key.get_secret_value().strip()):
        return None, None, "AI recipe enhancement skipped because WW_API_KEY is not configured."

    candidates = []
    for item in scored:
        candidates.append(
            {
                "recipe_id": item.recipe.recipe_id,
                "title": item.recipe.title,
                "ingredients": [_display_name(value) for value in item.recipe.ingredients],
                "ingredient_quantities": list(item.recipe.ingredient_quantities),
                "steps": list(item.recipe.steps),
                "image_url": item.recipe.image_url,
                "image_alt": item.recipe.image_alt,
                "prep_minutes": item.recipe.prep_minutes,
                "cook_minutes": item.recipe.cook_minutes,
                "available_ingredients": [_display_name(value) for value in item.matched],
                "priority_ingredients": [_display_name(value) for value in item.priority_matched],
                "missing_ingredients": [_display_name(value) for value in item.missing],
                "score": item.score,
            }
        )
    inventory = [
        {
            "name": item.name,
            "quantity": item.quantity,
            "unit": item.unit,
            "expiry_date": item.expiry_date.isoformat() if item.expiry_date else None,
            "expiry_days": item.expiry_days,
        }
        for item in request.inventory
    ]
    prompt_language = "Chinese" if request.language == "zh" else "English"
    system = _recipe_system_prompt(request)
    user = {
        "task": f"Choose the best {request.limit} recipes and write short {prompt_language} reasons.",
        "inventory": inventory,
        "recipe_candidates": candidates,
        "output_contract": {
            "recommendations": [
                {
                    "recipe_id": "must be one candidate recipe_id",
                    "title": "candidate title",
                    "reason": "one short practical reason",
                    "steps": ["reuse all important candidate steps; keep at least five"],
                }
            ]
        },
    }
    headers = {"Content-Type": "application/json"}
    if settings.api_key:
        key = settings.api_key.get_secret_value().strip()
        if key:
            headers["Authorization"] = f"Bearer {key}"
    payload: dict[str, Any] = {
        "model": recipe_model,
        "temperature": 0,
        "max_tokens": min(settings.api_max_tokens, 1400),
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": json.dumps(user, ensure_ascii=False)},
        ],
    }
    if settings.api_json_mode:
        payload["response_format"] = {"type": "json_object"}

    try:
        endpoint = _chat_completions_url(settings.api_base_url)
        with httpx.Client(timeout=httpx.Timeout(settings.api_timeout_seconds), follow_redirects=False) as client:
            response = client.post(endpoint, headers=headers, json=payload)
        response.raise_for_status()
        parsed = _parse_json_object(_extract_chat_content(response.json()))
        raw_recommendations = parsed.get("recommendations")
        if not isinstance(raw_recommendations, list):
            raise ValueError("AI recipe response missing recommendations array.")
    except Exception as exc:
        return None, None, f"AI recipe enhancement failed; rule-based recommendations were used ({type(exc).__name__})."

    by_id = {item.recipe.recipe_id: item for item in scored}
    polished: list[RecipeRecommendationItem] = []
    for raw in raw_recommendations:
        if not isinstance(raw, dict):
            continue
        recipe_id = str(raw.get("recipe_id", "")).strip()
        if recipe_id not in by_id:
            continue
        base = _to_recommendation(by_id[recipe_id], language=request.language, ai_enhanced=True)
        reason = str(raw.get("reason", "")).strip()
        steps = raw.get("steps")
        candidate_steps = [str(step).strip() for step in steps if str(step).strip()] if isinstance(steps, list) else []
        safe_steps = candidate_steps if len(candidate_steps) >= 5 else base.steps
        polished.append(
            base.model_copy(
                update={
                    "reason": reason[:500] if reason else base.reason,
                    "steps": safe_steps[:10] if safe_steps else base.steps,
                    "ai_enhanced": True,
                }
            )
        )
        if len(polished) >= request.limit:
            break
    if not polished:
        return None, None, "AI recipe enhancement returned no usable candidate IDs; rule-based recommendations were used."
    return polished, f"api:{recipe_model}", None


def _recipe_system_prompt(request: RecipeRecommendRequest) -> str:
    if request.selection_mode:
        selected = [item.name for item in request.inventory]
        return (
            "You are FreshWise's Malaysian home-cooking recipe assistant.\n"
            "Recommend recipes only from the retrieved recipe candidates.\n"
            "The user explicitly selected these pantry ingredients:\n"
            f"{json.dumps(selected, ensure_ascii=False)}\n\n"
            "Requirements:\n"
            "- Treat selected ingredients as the highest priority.\n"
            "- Prefer recipes that use the greatest number of selected ingredients.\n"
            "- Prioritize selected ingredients that expire sooner.\n"
            "- Clearly separate ingredients the user already has from missing ingredients.\n"
            "- Do not claim the user owns an ingredient unless it is present in the selected inventory.\n"
            "- Do not invent recipes outside the retrieved recipe candidates.\n"
            "- Prefer practical Malaysian household meals.\n"
            "- Avoid pork and alcohol unless explicitly present in the selected ingredients.\n"
            "- Preserve the candidate's precise cooking steps and never reduce a recipe below five steps.\n"
            "- Return structured JSON only."
        )
    return (
        "You are a food-waste reduction recipe assistant. Recommend only from the "
        "provided recipe candidates. Do not invent new recipes, ingredients, IDs, "
        "expiry dates, images, or steps. Preserve the candidate's precise cooking steps; "
        "never reduce a recipe below five steps. Return only compact JSON."
    )


def _recipe_api_settings() -> tuple[str | None, str | None, dict[str, str], str | None]:
    settings = get_settings()
    recipe_model = (settings.api_recipe_model or settings.api_model or "").strip()
    if not settings.api_base_url or not recipe_model:
        return None, None, {}, "WW_API_BASE_URL or WW_API_RECIPE_MODEL is not configured."
    if settings.api_key_required and not (settings.api_key and settings.api_key.get_secret_value().strip()):
        return None, None, {}, "WW_API_KEY is not configured."
    headers = {"Content-Type": "application/json"}
    if settings.api_key:
        key = settings.api_key.get_secret_value().strip()
        if key:
            headers["Authorization"] = f"Bearer {key}"
    return settings.api_base_url, recipe_model, headers, None


def _inventory_payload(request: RecipeRecommendRequest) -> list[dict[str, Any]]:
    return [
        {
            "name": item.name,
            "quantity": item.quantity,
            "unit": item.unit,
            "category": item.category,
            "expiry_date": item.expiry_date.isoformat() if item.expiry_date else None,
            "expiry_days": item.expiry_days,
        }
        for item in request.inventory
    ]


def _fallback_generated_recipes(
    request: RecipeRecommendRequest,
    pantry: list[str],
    priority: list[str],
    existing_titles: set[str] | None = None,
) -> list[RecipeRecommendationItem]:
    existing_titles = existing_titles or set()
    usable = pantry or [_canonicalize(item.name) for item in request.inventory if item.name.strip()]
    usable = [item for item in dict.fromkeys(usable) if item]
    primary = usable[0] if usable else "pantry item"
    secondary = usable[1] if len(usable) > 1 else primary
    priority_display = [_display_name(value) for value in priority if value in usable]
    available_display = [_display_name(value) for value in usable[:5]]
    templates = [
        (
            f"Quick {_display_name(primary)} Bowl",
            [f"1 portion {_display_name(primary).lower()}", "1 cup cooked rice or noodles", "1 tbsp cooking oil", "1 tbsp soy sauce"],
            [
                f"Wash, trim, and cut the {_display_name(primary).lower()} into even bite-sized pieces; prepare the rice or noodles before heating the pan.",
                "Heat 1 tablespoon of oil in a wok or frying pan over medium-high heat for 45 seconds.",
                f"Add the {_display_name(primary).lower()} and cook for 3 to 5 minutes, stirring frequently, until evenly heated and tender.",
                "Add 1 cup of cooked rice or noodles and stir-fry for 2 minutes so the ingredients are evenly distributed.",
                "Add 1 tablespoon of soy sauce, taste, and adjust with no more than 1/4 teaspoon salt if needed.",
                "Serve immediately while hot; if poultry is used, confirm the thickest piece reaches 75 C before serving.",
            ],
        ),
        (
            f"{_display_name(primary)} and {_display_name(secondary)} Stir-Fry",
            [f"1 portion {_display_name(primary).lower()}", f"1 portion {_display_name(secondary).lower()}", "1 tbsp cooking oil", "1 tbsp soy sauce"],
            [
                f"Cut the {_display_name(primary).lower()} and {_display_name(secondary).lower()} into similar 2 cm pieces so they cook evenly.",
                "Mix 1 tablespoon soy sauce with 2 tablespoons water in a small bowl before cooking.",
                "Heat 1 tablespoon oil in a wok over high heat until shimmering, about 45 seconds.",
                f"Add the {_display_name(primary).lower()} first and stir-fry for 2 to 4 minutes, then add the {_display_name(secondary).lower()}.",
                "Pour in the sauce and toss for another 1 to 2 minutes until the vegetables are crisp-tender and the sauce lightly coats everything.",
                "Remove from the heat, taste once, and serve immediately with rice; cook poultry to 75 C if used.",
            ],
        ),
        (
            f"Use-First {_display_name(primary)} Soup",
            [f"1 portion {_display_name(primary).lower()}", "500 ml water or low-salt stock", "1 cup vegetables", "1 egg or 1 portion noodles, optional"],
            [
                f"Wash and cut the {_display_name(primary).lower()} and any vegetables into spoon-sized pieces.",
                "Bring 500 ml water or stock to a full boil in a small pot, then reduce to a steady simmer.",
                f"Add the {_display_name(primary).lower()} and simmer for 5 minutes before adding faster-cooking vegetables.",
                "Add noodles, cooked rice, or a beaten egg if available and cook for 2 to 4 minutes.",
                "Check that all ingredients are tender and any poultry reaches 75 C; add up to 1/4 teaspoon salt only after tasting.",
                "Ladle into a bowl and serve hot; cool leftovers within 2 hours and refrigerate.",
            ],
        ),
    ]
    recommendations: list[RecipeRecommendationItem] = []
    for index, (title, ingredient_quantities, steps) in enumerate(templates, start=1):
        if title in existing_titles:
            title = f"{title} {index}"
        recommendations.append(
            RecipeRecommendationItem(
                recipe_id=f"generated-fallback-{index}",
                title=title,
                reason=(
                    f"Generated from your current pantry so you still get a usable recipe idea. "
                    f"Uses {', '.join(available_display[:3]) or 'available items'}."
                ),
                available_ingredients=available_display,
                priority_ingredients=priority_display,
                missing_ingredients=[],
                ingredient_quantities=ingredient_quantities,
                steps=steps,
                image_url=_image_for_recipe(
                    f"generated-fallback-{index}",
                    title,
                    usable,
                ),
                image_alt=f"Serving suggestion for {title}",
                prep_minutes=8,
                cook_minutes=12,
                tags=["generated", "quick"],
                servings=1,
                score=0.05,
                source="fallback_recipe_generation",
                ai_enhanced=False,
            )
        )
    return recommendations


def _ai_generate_from_inventory(
    request: RecipeRecommendRequest,
    pantry: list[str],
    priority: list[str],
    needed: int,
    existing_titles: set[str],
) -> tuple[list[RecipeRecommendationItem], str | None, str | None]:
    if needed <= 0 or not request.use_ai:
        return [], None, "AI direct recipe generation skipped."
    primary = pantry[0] if pantry else _canonicalize(request.inventory[0].name)
    settings = get_settings()
    base_url, recipe_model, headers, config_error = _recipe_api_settings()
    if config_error or not base_url or not recipe_model:
        return [], None, f"AI direct recipe generation skipped because {config_error}"

    prompt_language = "Chinese" if request.language == "zh" else "English"
    system = (
        "You are a practical food-waste reduction cooking assistant. Generate simple "
        "home recipes from the user's current pantry. Prefer items expiring soon. "
        "Do not mention unavailable exact expiry dates. Every recipe must include ingredient "
        "quantities and 6 to 8 precise steps. Steps must state heat level, cooking time, visual "
        "or temperature doneness checks, and safe handling where relevant. Avoid vague instructions "
        "such as 'cook until done' or 'season to taste' without a measurable starting amount. "
        "Return only compact JSON."
    )
    user = {
        "task": (
            f"Generate exactly {needed} practical recipe recommendations in {prompt_language}. "
            "They may be new recipes because the local recipe RAG did not have enough matches."
        ),
        "inventory": _inventory_payload(request),
        "canonical_pantry_ingredients": [_display_name(value) for value in pantry],
        "priority_expiring_ingredients": [_display_name(value) for value in priority],
        "avoid_duplicate_titles": sorted(existing_titles),
        "output_contract": {
            "recommendations": [
                {
                    "title": "short recipe title",
                    "reason": "one short reason using pantry and expiring items",
                    "available_ingredients": ["ingredients from inventory used by this recipe"],
                    "priority_ingredients": ["expiring inventory ingredients used, may be empty"],
                    "missing_ingredients": ["optional missing ingredients only"],
                    "ingredient_quantities": ["2 eggs", "1 cup cooked rice", "1 tbsp cooking oil"],
                    "steps": ["6 to 8 precise steps with time, heat level, amounts, and doneness checks"],
                    "prep_minutes": 10,
                    "cook_minutes": 15,
                    "servings": 1,
                }
            ]
        },
    }
    payload: dict[str, Any] = {
        "model": recipe_model,
        "temperature": 0.2,
        "max_tokens": min(settings.api_max_tokens, 1800),
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": json.dumps(user, ensure_ascii=False)},
        ],
    }
    if settings.api_json_mode:
        payload["response_format"] = {"type": "json_object"}

    try:
        endpoint = _chat_completions_url(base_url)
        with httpx.Client(timeout=httpx.Timeout(settings.api_timeout_seconds), follow_redirects=False) as client:
            response = client.post(endpoint, headers=headers, json=payload)
        response.raise_for_status()
        parsed = _parse_json_object(_extract_chat_content(response.json()))
        raw_recommendations = parsed.get("recommendations")
        if not isinstance(raw_recommendations, list):
            raise ValueError("AI generated recipe response missing recommendations array.")
    except Exception as exc:
        return [], None, f"AI direct recipe generation failed; fallback recipes were used ({type(exc).__name__})."

    generated: list[RecipeRecommendationItem] = []
    for raw in raw_recommendations:
        if not isinstance(raw, dict):
            continue
        title = str(raw.get("title", "")).strip()[:160]
        if not title or title in existing_titles:
            continue
        steps_raw = raw.get("steps")
        steps = [str(step).strip() for step in steps_raw if str(step).strip()] if isinstance(steps_raw, list) else []
        available_raw = raw.get("available_ingredients")
        available = [str(item).strip() for item in available_raw if str(item).strip()] if isinstance(available_raw, list) else []
        priority_raw = raw.get("priority_ingredients")
        priority_items = [str(item).strip() for item in priority_raw if str(item).strip()] if isinstance(priority_raw, list) else []
        missing_raw = raw.get("missing_ingredients")
        missing = [str(item).strip() for item in missing_raw if str(item).strip()] if isinstance(missing_raw, list) else []
        quantities_raw = raw.get("ingredient_quantities")
        ingredient_quantities = [
            str(item).strip() for item in quantities_raw if str(item).strip()
        ] if isinstance(quantities_raw, list) else []
        reason = str(raw.get("reason", "")).strip()[:500]
        servings_value = raw.get("servings")
        try:
            servings = int(servings_value) if servings_value is not None else None
        except (TypeError, ValueError):
            servings = None
        if len(steps) < 5:
            main_name = (available[0] if available else _display_name(primary)).lower()
            steps = [
                f"Wash, trim, and cut the {main_name} into even bite-sized pieces; measure all seasonings before heating the pan.",
                "Heat 1 tablespoon cooking oil over medium-high heat for 45 seconds.",
                f"Add the {main_name} and cook for 3 to 5 minutes, stirring every 30 seconds.",
                "Add the remaining ingredients and 2 tablespoons water; cover and cook for 4 minutes.",
                "Check that vegetables are tender and any poultry reaches 75 C, then add 1 tablespoon soy sauce.",
                "Remove from the heat, rest for 1 minute, and serve immediately.",
            ]
        prep_value = raw.get("prep_minutes")
        cook_value = raw.get("cook_minutes")
        try:
            prep_minutes = max(0, min(240, int(prep_value))) if prep_value is not None else 10
        except (TypeError, ValueError):
            prep_minutes = 10
        try:
            cook_minutes = max(0, min(480, int(cook_value))) if cook_value is not None else 15
        except (TypeError, ValueError):
            cook_minutes = 15
        generated.append(
            RecipeRecommendationItem(
                recipe_id=f"api-generated-{len(generated) + 1}",
                title=title,
                reason=reason or "Generated directly from your current pantry.",
                available_ingredients=available or [_display_name(value) for value in pantry[:4]],
                priority_ingredients=priority_items,
                missing_ingredients=missing[:6],
                ingredient_quantities=ingredient_quantities or [f"1 portion {_display_name(primary).lower()}", "1 tbsp cooking oil"],
                steps=steps[:8],
                image_url=_image_for_recipe(
                    f"api-generated-{len(generated) + 1}",
                    title,
                    [*available, *missing],
                ),
                image_alt=f"Serving suggestion for {title}",
                prep_minutes=prep_minutes,
                cook_minutes=cook_minutes,
                tags=["ai-generated"],
                servings=servings if servings and servings > 0 else 1,
                score=0.04,
                source="api_recipe_generation",
                ai_enhanced=True,
            )
        )
        existing_titles.add(title)
        if len(generated) >= needed:
            break
    return generated, f"api:{recipe_model}", None


def recommend_recipes(request: RecipeRecommendRequest) -> RecipeRecommendResponse:
    started = perf_counter()
    warnings: list[str] = []
    scored, pantry, priority = rank_recipes(request, top_k=max(5, request.limit))
    if not scored:
        warnings.append(
            "No retrieved recipe candidate matched the selected ingredients."
            if request.selection_mode
            else "No recipe in the small local knowledge base matched the current inventory; API generation was used."
        )
        recommendations = []
        model_id = "mini-rag:rules"
    else:
        recommendations, model_id, ai_warning = _ai_polish(scored, request)
        if ai_warning:
            warnings.append(ai_warning)
        if recommendations is None:
            recommendations = [
                _to_recommendation(item, language=request.language)
                for item in scored[: request.limit]
            ]
            model_id = "mini-rag:rules"

    # AI polishing is allowed to reorder and explain retrieved candidates, but
    # it may return fewer IDs than requested. In explicit selection mode, fill
    # remaining cards from the same retrieved set instead of generating meals.
    if request.selection_mode and len(recommendations) < request.limit:
        existing_ids = {item.recipe_id for item in recommendations}
        for scored_item in scored:
            if scored_item.recipe.recipe_id in existing_ids:
                continue
            recommendations.append(_to_recommendation(scored_item, language=request.language))
            existing_ids.add(scored_item.recipe.recipe_id)
            if len(recommendations) >= request.limit:
                break
    if request.selection_mode:
        selected_rank = {item.recipe.recipe_id: index for index, item in enumerate(scored)}
        recommendations.sort(key=lambda item: selected_rank.get(item.recipe_id, 10**9))

    existing_titles = {item.title for item in recommendations}
    if not request.selection_mode and len(recommendations) < request.limit and request.inventory:
        needed = request.limit - len(recommendations)
        generated, generated_model_id, generation_warning = _ai_generate_from_inventory(
            request,
            pantry,
            priority,
            needed,
            existing_titles,
        )
        if generation_warning and generated:
            warnings.append(generation_warning)
        elif generation_warning and not generated:
            warnings.append(generation_warning)
        if generated:
            recommendations.extend(generated)
            model_id = generated_model_id or model_id

    if not request.selection_mode and len(recommendations) < request.limit and request.inventory:
        existing_titles = {item.title for item in recommendations}
        fallback = _fallback_generated_recipes(request, pantry, priority, existing_titles)
        recommendations.extend(fallback[: request.limit - len(recommendations)])
        warnings.append("Fallback recipe generator filled the remaining recommendation slots.")

    return RecipeRecommendResponse(
        recommendations=recommendations[: request.limit],
        pantry_ingredients=[_display_name(value) for value in pantry],
        priority_ingredients=[_display_name(value) for value in priority],
        model_id=model_id or "mini-rag:rules",
        latency_ms=round((perf_counter() - started) * 1000, 2),
        warnings=warnings,
    )
