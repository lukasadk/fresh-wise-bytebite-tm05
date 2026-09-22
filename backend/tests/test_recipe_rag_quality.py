from __future__ import annotations

import re

from wastewise_grocery_vlm.recipe_rag import (
    _image_for_recipe,
    hosted_recipe_image_path,
    load_recipe_docs,
    recommend_recipes,
)
from wastewise_grocery_vlm.schemas import RecipeInventoryItem, RecipeRecommendRequest


def test_curated_malaysian_recipe_docs_have_images_quantities_and_precise_steps() -> None:
    docs = load_recipe_docs()

    assert len(docs) >= 530
    for recipe in docs:
        assert recipe.image_url.startswith("https://")
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
        assert recipe.image_url.startswith("https://")
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

    assert "Telur_goreng_tomato_kacau_dengan_nasi" in tomato_egg_rice
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
    assert len(set(hosted_paths)) >= 20
