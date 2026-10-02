from pathlib import Path

import pytest_asyncio

from wastewise_grocery_vlm.recipe_rag import PROJECT_ROOT, RECIPE_IMAGE_URLS, _image_for_recipe


@pytest_asyncio.fixture(autouse=True)
async def _clean_core_tables():
    """Override the integration suite's Postgres fixture for these unit tests."""

    yield


def test_generated_recipe_uses_bread_photo_instead_of_stale_dataset_photo():
    image = _image_for_recipe(
        "hf-my-no-manifest-bread",
        "Banana Kaya Toast",
        ["bread", "banana", "kaya"],
        "https://example.invalid/unrelated-rice.jpg",
    )

    assert image == RECIPE_IMAGE_URLS["bread"]


def test_generated_recipe_has_dedicated_milk_and_fruit_fallbacks():
    milk = _image_for_recipe(
        "hf-my-no-manifest-milk",
        "Fresh Milk Oats Bowl",
        ["milk", "oats"],
        "https://example.invalid/unrelated-rice.jpg",
    )
    fruit = _image_for_recipe(
        "hf-my-no-manifest-fruit",
        "Tropical Fruit Bowl",
        ["banana", "mango", "watermelon"],
        "https://example.invalid/unrelated-rice.jpg",
    )

    assert milk == RECIPE_IMAGE_URLS["milk"]
    assert fruit == RECIPE_IMAGE_URLS["fruit"]


def test_savoury_coconut_milk_recipe_stays_on_its_dish_family():
    image = _image_for_recipe(
        "hf-my-no-manifest-curry",
        "Chicken Coconut Milk Curry",
        ["chicken", "coconut milk", "curry powder"],
        "https://example.invalid/unrelated-toast.jpg",
    )

    assert image == RECIPE_IMAGE_URLS["curry"]


def test_new_project_owned_fallback_files_are_packaged():
    for category in ("bread", "milk", "fruit"):
        public_path = RECIPE_IMAGE_URLS[category]
        asset = PROJECT_ROOT / "app" / "static" / public_path.removeprefix("/static/")
        assert isinstance(asset, Path)
        assert asset.is_file()
        assert asset.stat().st_size > 100_000
