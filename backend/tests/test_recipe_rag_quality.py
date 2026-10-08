from __future__ import annotations

import re

import pytest_asyncio

from wastewise_grocery_vlm.recipe_rag import (
    PROJECT_ROOT,
    _image_for_recipe,
    _recipe_system_prompt,
    hosted_recipe_image_path,
    load_recipe_docs,
    rank_recipes,
    recommend_recipes,
)
from wastewise_grocery_vlm.schemas import RecipeInventoryItem, RecipeRecommendRequest


@pytest_asyncio.fixture(autouse=True)
async def _clean_core_tables():
    """Override the integration suite's Postgres fixture for these unit tests."""
    yield


def test_curated_malaysian_recipe_docs_have_images_quantities_and_precise_steps() -> None:
    docs = load_recipe_docs()

    assert len(docs) >= 530
    for recipe in docs:
        assert recipe.image_url.startswith(("https://", "/static/recipe-images/"))
        assert recipe.image_alt.strip()
        assert recipe.ingredient_quantities
        assert recipe.prep_minutes is not None and recipe.prep_minutes > 0
        assert recipe.cook_minutes is not None and recipe.cook_minutes > 0
        assert len(recipe.steps) >= 5

        instructions = " ".join(recipe.steps).lower()
        assert re.search(r"\b(second|seconds|minute|minutes)\b", instructions)
        assert re.search(r"\b(low|medium|high|heat|boil|simmer|75 c)\b", instructions)


def test_rule_based_response_preserves_recipe_visuals_and_detail() -> None:
    response = recommend_recipes(
        RecipeRecommendRequest(
            inventory=[
                RecipeInventoryItem(name="rice", expiry_days=1),
                RecipeInventoryItem(name="egg", expiry_days=2),
                RecipeInventoryItem(name="choy sum", expiry_days=2),
            ],
            limit=3,
            use_ai=False,
        )
    )

    assert len(response.recommendations) == 3
    for recipe in response.recommendations:
        assert recipe.image_url.startswith(("https://", "/static/recipe-images/"))
        assert recipe.image_alt
        assert recipe.ingredient_quantities
        assert len(recipe.steps) >= 5


def test_multi_ingredient_recipe_images_override_misleading_single_keyword_images() -> None:
    old_egg_breakfast_image = (
        "https://images.unsplash.com/photo-1525351484163-7529414344d8"
        "?auto=format&fit=crop&w=1200&q=80"
    )

    tomato_egg_rice = _image_for_recipe(
        "my-009",
        "Tomato Egg Rice",
        ["tomato", "egg", "rice"],
        old_egg_breakfast_image,
    )
    potato_egg_rice = _image_for_recipe(
        "generated-test",
        "Potato Egg Rice",
        ["potato", "egg", "rice"],
        old_egg_breakfast_image,
    )
    egg_fried_rice = _image_for_recipe(
        "generated-test-2",
        "Egg Fried Rice",
        ["egg", "rice"],
        old_egg_breakfast_image,
    )

    assert tomato_egg_rice == "/static/recipe-images/ai-generated/my-009-9237b0d3.jpg"
    assert potato_egg_rice == "/static/recipe-images/potato-egg-rice-v2.jpg"
    assert "Egg_Fried_rice" in egg_fried_rice
    assert old_egg_breakfast_image not in {
        tomato_egg_rice,
        potato_egg_rice,
        egg_fried_rice,
    }


def test_every_recipe_image_has_a_same_origin_cached_copy() -> None:
    docs = load_recipe_docs()
    hosted_paths = [hosted_recipe_image_path(recipe.image_url) for recipe in docs]

    assert all(path.startswith("/static/recipe-images/") for path in hosted_paths)
    assert len(docs) == 530
    assert len(set(hosted_paths)) == len(docs)
    assert all("/ai-generated/" in path for path in hosted_paths)
    for path in hosted_paths:
        asset = PROJECT_ROOT / "app" / "static" / path.removeprefix("/static/")
        assert asset.is_file()
        assert asset.stat().st_size > 100_000


def test_selected_mode_ranks_recipe_coverage_before_expiry() -> None:
    request = RecipeRecommendRequest(
        inventory=[
            RecipeInventoryItem(name="rice", expiry_days=8),
            RecipeInventoryItem(name="egg", expiry_days=1),
            RecipeInventoryItem(name="tomato", expiry_days=2),
            RecipeInventoryItem(name="onion", expiry_days=6),
        ],
        limit=5,
        use_ai=False,
        selection_mode=True,
        selected_ingredients=["rice", "egg", "tomato", "onion"],
    )

    scored, _, _ = rank_recipes(request, top_k=10)
    match_counts = [len(item.matched) for item in scored]

    assert match_counts == sorted(match_counts, reverse=True)
    assert match_counts[0] >= 3


def test_selected_mode_prompt_is_candidate_grounded_and_inventory_scoped() -> None:
    request = RecipeRecommendRequest(
        inventory=[
            RecipeInventoryItem(name="chicken", expiry_days=1),
            RecipeInventoryItem(name="tomato", expiry_days=2),
        ],
        selection_mode=True,
        selected_ingredients=["chicken", "tomato"],
    )

    prompt = _recipe_system_prompt(request)

    assert "FreshWise's Malaysian home-cooking recipe assistant" in prompt
    assert '"chicken"' in prompt and '"tomato"' in prompt
    assert "greatest number of selected ingredients" in prompt
    assert "Do not invent recipes outside the retrieved recipe candidates" in prompt
    assert "Return structured JSON only" in prompt


def test_selected_mode_never_fills_with_generated_recipes() -> None:
    response = recommend_recipes(
        RecipeRecommendRequest(
            inventory=[RecipeInventoryItem(name="not-a-real-recipe-ingredient")],
            limit=3,
            selection_mode=True,
            use_ai=True,
            selected_ingredients=["not-a-real-recipe-ingredient"],
        )
    )

    assert response.recommendations == []
    assert all("generated" not in warning.lower() for warning in response.warnings)


def test_selected_mode_uses_retrieved_fallback_when_ai_is_unavailable(monkeypatch) -> None:
    import wastewise_grocery_vlm.recipe_rag as recipe_rag

    monkeypatch.setattr(
        recipe_rag,
        "_ai_polish",
        lambda scored, request: (None, None, "AI unavailable in test."),
    )
    response = recommend_recipes(
        RecipeRecommendRequest(
            inventory=[
                RecipeInventoryItem(name="chicken", expiry_days=1),
                RecipeInventoryItem(name="onion", expiry_days=2),
            ],
            limit=3,
            selection_mode=True,
            use_ai=True,
            selected_ingredients=["chicken", "onion"],
        )
    )
    known_ids = {recipe.recipe_id for recipe in load_recipe_docs()}

    assert response.recommendations
    assert all(recipe.recipe_id in known_ids for recipe in response.recommendations)
    assert all(recipe.source == "mini_recipe_rag" for recipe in response.recommendations)
    selected = {"Chicken", "Onion"}
    for recipe in response.recommendations:
        assert set(recipe.available_ingredients) <= selected
        assert not (set(recipe.available_ingredients) & set(recipe.missing_ingredients))
