"""Build 500 image-grounded Malaysian recipe records for the local RAG.

The source dataset supplies the class distribution and row provenance only.
Its image files are not copied because the dataset card does not declare a
redistribution licence. Runtime display images are separately licensed images
already recorded in ``recipe_image_sources.json``.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any
from urllib.parse import urlencode
from urllib.request import urlopen


DATASET_ID = "lowyisan/malaysian_food_images"
DATASET_SERVER = "https://datasets-server.huggingface.co/rows"
OUTPUT_PATH = Path(__file__).resolve().parents[1] / "data" / "recipe_rag" / "generated_recipes_500.json"
TARGET_COUNT = 500

LABEL_NAMES = [
    "fish_and_chips",
    "fried_noodles",
    "fried_rice",
    "hamburger",
    "kaya_toast",
    "laksa",
    "mixed_rice",
    "nasi_lemak",
    "popiah",
    "roti_canai",
    "satay",
]

IMAGE_BY_LABEL = {
    "fish_and_chips": "https://thumb.wikimedia.org/wikipedia/commons/thumb/e/ec/Gurame_bakar_kecap_2.JPG/1280px-Gurame_bakar_kecap_2.JPG",
    "fried_noodles": "https://thumb.wikimedia.org/wikipedia/commons/thumb/c/c3/Char_kway_teow_%28kuetiau_goreng%29_of_Dann_Char_Kuey_Teow_at_Permatang_Tok_Jaya%2C_SPU_20240915_183329.jpg/1280px-Char_kway_teow_%28kuetiau_goreng%29_of_Dann_Char_Kuey_Teow_at_Permatang_Tok_Jaya%2C_SPU_20240915_183329.jpg",
    "fried_rice": "https://images.unsplash.com/photo-1603133872878-684f208fb84b?auto=format&fit=crop&w=1200&q=80",
    "hamburger": "https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=1200&q=80",
    "kaya_toast": "https://images.unsplash.com/photo-1484723091739-30a097e8f929?auto=format&fit=crop&w=1200&q=80",
    "laksa": "https://upload.wikimedia.org/wikipedia/commons/c/c2/Laksa_Johor_Roza_Roslan_2.jpg",
    "mixed_rice": "https://thumb.wikimedia.org/wikipedia/commons/thumb/8/84/Nasi_Kerabu_J%26K_Restaurant.jpg/1280px-Nasi_Kerabu_J%26K_Restaurant.jpg",
    "nasi_lemak": "https://thumb.wikimedia.org/wikipedia/commons/thumb/0/02/Nasi_lemak_joh.jpg/1280px-Nasi_lemak_joh.jpg",
    "popiah": "https://thumb.wikimedia.org/wikipedia/commons/thumb/9/99/FRESH_SPRING_ROLLS_%28POPIAH%29.jpg/1280px-FRESH_SPRING_ROLLS_%28POPIAH%29.jpg",
    "roti_canai": "https://thumb.wikimedia.org/wikipedia/commons/thumb/d/dc/Roti_canai_and_Teh_Tarik%2C_a_typical_Malaysian_breakfast.jpg/1280px-Roti_canai_and_Teh_Tarik%2C_a_typical_Malaysian_breakfast.jpg",
    "satay": "https://upload.wikimedia.org/wikipedia/commons/d/d1/Satay_hawker.jpg",
}

PROTEINS = [
    ("Chicken", "chicken", "220 g chicken thigh, cut into 2 cm pieces", "the chicken reaches 75 C"),
    ("Prawn", "shrimp", "180 g peeled prawns", "the prawns are opaque and curled"),
    ("Tofu", "tofu", "200 g firm tofu, pressed and cubed", "the tofu is golden and hot through"),
    ("Egg", "egg", "3 eggs, beaten", "the egg is fully set"),
    ("Fish", "fish", "220 g firm white fish, cut into chunks", "the fish is opaque and flakes easily"),
    ("Tempeh", "tempeh", "200 g tempeh, sliced", "the tempeh is crisp at the edges"),
    ("Beef", "beef", "220 g thinly sliced beef", "the beef is browned and cooked to preference"),
    ("Mushroom", "mushroom", "200 g mushrooms, sliced", "the mushrooms are browned and no liquid remains"),
    ("Anchovy", "anchovy", "45 g dried anchovies", "the anchovies are crisp"),
    ("Sardine", "sardine", "200 g drained canned sardines", "the sardines are steaming hot"),
]

VEGETABLES = [
    ("Choy Sum", "choy sum", "1 cup choy sum, stems and leaves separated"),
    ("Bean Sprout", "bean sprouts", "1 cup bean sprouts"),
    ("Carrot", "carrot", "1 medium carrot, cut into matchsticks"),
    ("Long Bean", "long beans", "1 cup long beans, cut into 4 cm pieces"),
    ("Cabbage", "cabbage", "1 1/2 cups finely sliced cabbage"),
]

STYLES = [
    ("Sambal", "sambal", "1 tbsp sambal"),
    ("Garlic", "garlic", "3 garlic cloves, minced"),
    ("Ginger", "ginger", "2 cm ginger, grated"),
    ("Turmeric", "turmeric", "1 tsp ground turmeric"),
    ("Lime", "lime", "1 lime, halved"),
]


def fetch_source_rows(limit: int) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for offset in range(0, limit, 100):
        query = urlencode(
            {
                "dataset": DATASET_ID,
                "config": "default",
                "split": "train",
                "offset": offset,
                "length": min(100, limit - offset),
            }
        )
        with urlopen(f"{DATASET_SERVER}?{query}", timeout=30) as response:
            payload = json.load(response)
        rows.extend(payload["rows"])
    if len(rows) != limit:
        raise RuntimeError(f"Expected {limit} dataset rows, received {len(rows)}")
    return rows


def _option(index: int) -> tuple[tuple[str, str, str, str], tuple[str, str, str], tuple[str, str, str]]:
    protein = PROTEINS[index % len(PROTEINS)]
    vegetable = VEGETABLES[(index // len(PROTEINS)) % len(VEGETABLES)]
    style = STYLES[(index // (len(PROTEINS) * len(VEGETABLES))) % len(STYLES)]
    return protein, vegetable, style


def build_recipe(label: str, row_idx: int, ordinal: int) -> dict[str, Any]:
    protein, vegetable, style = _option(ordinal)
    protein_name, protein_token, protein_quantity, doneness = protein
    veg_name, veg_token, veg_quantity = vegetable
    style_name, style_token, style_quantity = style
    identity = f"{protein_name} {veg_name} {style_name}"

    common = {
        "recipe_id": f"hf-my-{row_idx:06d}",
        "image_url": IMAGE_BY_LABEL[label],
        "image_alt": f"Representative serving suggestion for a Malaysian {label.replace('_', ' ')} recipe",
        "image_dataset": DATASET_ID,
        "image_dataset_split": "train",
        "image_dataset_row": row_idx,
        "image_dataset_label": label,
        "tags": ["malaysian", "image-grounded", label.replace("_", "-")],
        "servings": 2,
    }

    if label == "fried_rice":
        return common | {
            "title": f"{identity} Nasi Goreng",
            "ingredients": ["rice", protein_token, veg_token, style_token, "egg", "soy sauce", "garlic"],
            "ingredient_quantities": ["2 cups cold cooked rice", protein_quantity, veg_quantity, style_quantity, "1 egg", "1 tbsp light soy sauce", "2 garlic cloves, minced", "1 tbsp cooking oil"],
            "steps": [
                "Separate the cold rice grains, prepare every measured ingredient, and keep raw protein on a separate board.",
                f"Heat 1 tablespoon oil in a wok over medium-high heat for 45 seconds; add {protein_name.lower()} and cook for 3 to 5 minutes until {doneness}.",
                f"Add garlic, {style_name.lower()}, and {veg_name.lower()} and stir-fry for 90 seconds so the vegetables remain bright.",
                "Push everything aside, add the egg, leave for 15 seconds, and scramble for 45 seconds until softly set.",
                "Add rice and soy sauce, increase to high heat, and toss continuously for 3 minutes until every grain is hot and separated.",
                "Check the protein doneness again, taste before adding salt, and serve immediately while the rice is steaming."
            ],
            "prep_minutes": 12,
            "cook_minutes": 10,
        }

    if label == "fried_noodles":
        return common | {
            "title": f"{identity} Mee Goreng",
            "ingredients": ["noodles", protein_token, veg_token, style_token, "egg", "soy sauce", "chilli sauce"],
            "ingredient_quantities": ["300 g yellow noodles", protein_quantity, veg_quantity, style_quantity, "1 egg", "1 tbsp soy sauce", "1 tbsp chilli sauce", "80 ml water", "1 tbsp cooking oil"],
            "steps": [
                "Loosen the noodles under warm water for 20 seconds, drain thoroughly, and mix soy sauce, chilli sauce, and water.",
                f"Heat oil in a wok over medium-high heat and cook the {protein_name.lower()} for 3 to 5 minutes until {doneness}.",
                f"Add {style_name.lower()} and {veg_name.lower()} and stir-fry for 60 to 90 seconds.",
                "Push the mixture aside, crack in the egg, and scramble for 45 seconds until softly set.",
                "Add noodles and sauce, turn the heat to high, and toss for 2 to 3 minutes until evenly coated and steaming.",
                "Taste one noodle, add 1 tablespoon water only if dry, and serve immediately before the noodles soften."
            ],
            "prep_minutes": 10,
            "cook_minutes": 10,
        }

    if label == "laksa":
        return common | {
            "title": f"{identity} Malaysian Laksa",
            "ingredients": ["noodles", protein_token, veg_token, style_token, "coconut milk", "stock", "lemongrass"],
            "ingredient_quantities": ["250 g rice noodles", protein_quantity, veg_quantity, style_quantity, "250 ml coconut milk", "500 ml low-salt stock", "1 lemongrass stalk, bruised", "1 tbsp cooking oil"],
            "steps": [
                "Soak or cook the rice noodles according to the packet until just tender, rinse briefly, and divide between two bowls.",
                f"Heat oil over medium heat and cook {style_name.lower()} with lemongrass for 2 minutes until fragrant.",
                "Pour in stock, bring to a gentle boil, and simmer uncovered for 6 minutes to develop the broth.",
                f"Add {protein_name.lower()} and cook for 4 to 7 minutes until {doneness}.",
                f"Add coconut milk and {veg_name.lower()}, lower the heat, and simmer gently for 3 minutes without a hard boil.",
                "Taste and balance with a little lime or salt, ladle over noodles, and serve while the broth is above 75 C."
            ],
            "prep_minutes": 15,
            "cook_minutes": 20,
        }

    if label == "nasi_lemak":
        return common | {
            "title": f"{identity} Nasi Lemak Plate",
            "ingredients": ["rice", "coconut milk", protein_token, veg_token, style_token, "cucumber", "peanut"],
            "ingredient_quantities": ["1 cup jasmine rice, rinsed", "180 ml coconut milk", protein_quantity, veg_quantity, style_quantity, "1/2 cucumber, sliced", "30 g roasted peanuts", "180 ml water", "1/2 tsp salt"],
            "steps": [
                "Combine rinsed rice, coconut milk, water, and salt; bring to a boil, cover, and cook on low heat for 14 minutes.",
                "Turn off the heat and rest the rice covered for 10 minutes before fluffing with a fork.",
                f"While the rice cooks, prepare {style_name.lower()} in a small pan over medium heat for 2 minutes until fragrant.",
                f"Cook the {protein_name.lower()} in the same pan for 4 to 7 minutes until {doneness}.",
                f"Blanch or stir-fry the {veg_name.lower()} for 2 minutes so it is tender but still colourful.",
                "Plate rice with the protein, vegetables, cucumber, and peanuts, keeping hot components above 60 C until served."
            ],
            "prep_minutes": 15,
            "cook_minutes": 28,
        }

    if label == "mixed_rice":
        return common | {
            "title": f"{identity} Nasi Campur",
            "ingredients": ["rice", protein_token, veg_token, style_token, "cucumber", "soy sauce"],
            "ingredient_quantities": ["2 cups cooked rice", protein_quantity, veg_quantity, style_quantity, "1/2 cucumber, sliced", "1 tbsp soy sauce", "1 tbsp cooking oil", "80 ml water"],
            "steps": [
                "Reheat the rice until steaming throughout and keep it covered while preparing the side dishes.",
                f"Heat oil over medium-high heat and cook the {protein_name.lower()} for 3 to 6 minutes until {doneness}.",
                f"Add {style_name.lower()}, soy sauce, and water and simmer for 2 minutes until the protein is lightly glazed.",
                f"In a clean pan, stir-fry the {veg_name.lower()} over high heat for 2 minutes so it remains slightly crisp.",
                "Taste each component separately and adjust only after the soy sauce has reduced.",
                "Arrange rice, protein, vegetables, and cucumber in separate sections and serve while the cooked components are hot."
            ],
            "prep_minutes": 12,
            "cook_minutes": 15,
        }

    if label == "popiah":
        return common | {
            "title": f"{identity} Fresh Popiah",
            "ingredients": ["popiah wrapper", protein_token, veg_token, style_token, "carrot", "cucumber", "peanut"],
            "ingredient_quantities": ["8 fresh popiah wrappers", protein_quantity, veg_quantity, style_quantity, "1 carrot, julienned", "1/2 cucumber, julienned", "30 g crushed peanuts", "1 tsp cooking oil"],
            "steps": [
                "Prepare all vegetables in thin, dry matchsticks and cover the wrappers with a damp clean towel.",
                f"Heat oil over medium heat and cook the {protein_name.lower()} for 3 to 6 minutes until {doneness}; cool for 5 minutes.",
                f"Briefly stir-fry {veg_name.lower()} with {style_name.lower()} for 90 seconds, then drain any liquid and cool.",
                "Place one wrapper on a board and arrange two tablespoons filling across the lower third, leaving a 2 cm border.",
                "Fold in both sides and roll firmly without tearing; repeat and keep finished rolls covered.",
                "Cut each roll in half and serve within 30 minutes; refrigerate promptly if the filling contains meat or seafood."
            ],
            "prep_minutes": 20,
            "cook_minutes": 10,
        }

    if label == "roti_canai":
        return common | {
            "title": f"{identity} Stuffed Roti Canai",
            "ingredients": ["flatbread", protein_token, veg_token, style_token, "egg", "curry sauce"],
            "ingredient_quantities": ["2 frozen roti canai", protein_quantity, veg_quantity, style_quantity, "2 eggs", "1/2 cup curry sauce", "1 tsp cooking oil"],
            "steps": [
                "Thaw the roti until flexible and prepare the measured filling before heating the pan.",
                f"Cook the {protein_name.lower()} over medium heat for 3 to 6 minutes until {doneness}, then cool for 3 minutes.",
                f"Mix the protein with beaten egg, {veg_name.lower()}, and {style_name.lower()}.",
                "Place half the filling in each roti, fold into a sealed square, and keep the seam underneath.",
                "Cook on a lightly oiled pan over medium-low heat for 3 to 4 minutes per side until golden and fully set in the centre.",
                "Rest for 2 minutes, cut into pieces, and serve with curry sauce heated to a gentle simmer."
            ],
            "prep_minutes": 12,
            "cook_minutes": 14,
        }

    if label == "satay":
        return common | {
            "title": f"{identity} Satay",
            "ingredients": [protein_token, veg_token, style_token, "peanut", "coconut milk", "cucumber"],
            "ingredient_quantities": [protein_quantity, veg_quantity, style_quantity, "80 g roasted peanuts, ground", "100 ml coconut milk", "1/2 cucumber, cubed", "8 bamboo skewers, soaked 20 minutes"],
            "steps": [
                f"Mix {style_name.lower()} with coconut milk and coat the {protein_name.lower()}; cover and refrigerate for 30 minutes.",
                "Thread evenly sized pieces onto soaked skewers without packing them tightly and discard used marinade.",
                "Heat a grill pan over medium-high heat for 3 minutes and lightly oil the surface.",
                "Grill the skewers for 8 to 12 minutes, turning every 2 minutes so all sides colour evenly.",
                f"Check {doneness}; continue cooking in 1-minute intervals if necessary.",
                "Simmer ground peanuts with 100 ml water for 4 minutes, then serve the hot satay with sauce, cucumber, and vegetables."
            ],
            "prep_minutes": 20,
            "cook_minutes": 16,
        }

    if label == "hamburger":
        return common | {
            "title": f"{identity} Ramly-Style Burger",
            "ingredients": ["burger bun", protein_token, veg_token, style_token, "egg", "onion", "chilli sauce"],
            "ingredient_quantities": ["2 burger buns", protein_quantity, veg_quantity, style_quantity, "2 eggs", "1/2 onion, sliced", "1 tbsp chilli sauce", "1 tsp cooking oil"],
            "steps": [
                "Split and toast the buns cut-side down over medium heat for 60 seconds, then set aside.",
                f"Shape or arrange the {protein_name.lower()} into two portions and cook for 3 to 6 minutes per side until {doneness}.",
                f"Add onion, {veg_name.lower()}, and {style_name.lower()} and cook for 2 minutes until softened.",
                "Beat one egg at a time, spread it thinly on the pan, place the cooked patty in the centre, and fold the egg around it.",
                "Cook each wrapped patty for 60 seconds per side until the egg is fully set.",
                "Assemble in toasted buns with vegetables and chilli sauce and serve immediately while the centre is hot."
            ],
            "prep_minutes": 12,
            "cook_minutes": 16,
        }

    if label == "kaya_toast":
        return common | {
            "title": f"{style_name} {veg_name} Kaya Toast Set",
            "ingredients": ["bread", "kaya", "butter", veg_token, style_token, "egg"],
            "ingredient_quantities": ["4 slices sandwich bread", "2 tbsp kaya", "20 g butter, softened", veg_quantity, style_quantity, "2 eggs", "500 ml water"],
            "steps": [
                "Bring 500 ml water to a boil, remove from heat, add the eggs, cover, and leave for 7 minutes for soft centres.",
                "Toast the bread over medium heat for 2 to 3 minutes per side until evenly golden and crisp.",
                "Spread butter on two hot slices so it melts, then spread one tablespoon kaya over each.",
                f"Add a very thin layer of {style_name.lower()} and a small amount of prepared {veg_name.lower()} only if using the savoury variation.",
                "Close each sandwich, trim if desired, and cut diagonally while still warm.",
                "Crack the eggs into a clean bowl, confirm the whites are softly set, and serve the toast immediately alongside them."
            ],
            "prep_minutes": 7,
            "cook_minutes": 8,
        }

    # fish_and_chips becomes a locally flavoured crispy fish plate.
    return common | {
        "title": f"{identity} Malaysian Crispy Fish Plate",
        "ingredients": ["fish", "potato", veg_token, style_token, "flour", "egg", "lime"],
        "ingredient_quantities": ["2 firm fish fillets, 180 g each", "2 medium potatoes, cut into wedges", veg_quantity, style_quantity, "1/2 cup plain flour", "1 egg, beaten", "1 lime", "2 tbsp cooking oil", "1/2 tsp salt"],
        "steps": [
            "Heat the oven to 220 C, toss potato wedges with half the oil and salt, and roast for 20 minutes.",
            f"Mix flour with {style_name.lower()}, pat the fish dry, dip it in egg, and coat it evenly in the seasoned flour.",
            "Turn the potatoes, move them to one side of the tray, and place the coated fish on the other side.",
            "Brush the fish with remaining oil and bake for 10 to 12 minutes, turning once after 6 minutes.",
            "Confirm the fish is opaque, flakes easily, and reaches about 63 C; roast the potatoes longer if their centres are still firm.",
            f"Serve immediately with lime and quickly blanched {veg_name.lower()}, keeping raw and cooked fish utensils separate."
        ],
        "prep_minutes": 15,
        "cook_minutes": 32,
    }


def main() -> None:
    source_rows = fetch_source_rows(TARGET_COUNT)
    ordinals = {label: 0 for label in LABEL_NAMES}
    recipes: list[dict[str, Any]] = []
    for source in source_rows:
        row = source["row"]
        label = LABEL_NAMES[int(row["label"])]
        ordinal = ordinals[label]
        ordinals[label] += 1
        recipes.append(build_recipe(label, int(source["row_idx"]), ordinal))

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(recipes, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {len(recipes)} recipes to {OUTPUT_PATH}")
    print("Class distribution:", json.dumps(ordinals, sort_keys=True))


if __name__ == "__main__":
    main()
