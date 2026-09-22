# FreshWise Malaysian Recipe RAG

The runtime knowledge base currently contains 530 Malaysian recipe records. Every
recipe has ingredient quantities, preparation and cooking times, at least six
numbered cooking instructions, an HTTPS image URL, and alternative text.

## Image databases

Primary dataset for future expansion:

```text
https://huggingface.co/datasets/lowyisan/malaysian_food_images
```

- Size verified through the Dataset Viewer API: 11,000 images.
- Classes: fish and chips, fried noodles, fried rice, hamburger, kaya toast,
  laksa, mixed rice, nasi lemak, popiah, roti canai, and satay.
- FreshWise uses the first 500 row labels and row IDs as reproducible grounding
  metadata for 500 structured recipe variants.
- The dataset card does not currently declare a redistribution licence, so its
  binary image files are not copied into this public repository. FreshWise uses
  separately licensed representative display images instead.

Smaller Apache-2.0 reference dataset:

```text
https://huggingface.co/datasets/ychwodhrey/malaysian-cuisine
```

- Name: Malaysian Cuisine Image Dataset
- Licence: Apache-2.0
- Format: imagefolder
- Coverage: Malaysian dishes such as nasi lemak, roti telur, murtabak, gulai
  ikan, and lemang

Supplementary open-media catalogue:

```text
https://commons.wikimedia.org/wiki/Category:Cuisine_of_Malaysia
```

Wikimedia Commons provides hundreds of Malaysian cuisine images. Licences vary
by file, so the individual file page must be retained for attribution and
licence checking. The exact images integrated into FreshWise are recorded in
`recipe_image_sources.json`.

Additional classification dataset:

```text
https://www.kaggle.com/datasets/karkengchan/malaysia-food-11
```

Check the current Kaggle dataset licence before redistributing its files.

## Data files

- `mini_recipes.json`: original 18 detailed recipes.
- `malaysian_recipes_expanded.json`: 12 additional detailed recipes.
- `generated_recipes_500.json`: 500 deterministic, image-grounded Malaysian
  recipe variants generated from verified dataset row metadata.
- `recipe_image_sources.json`: dataset references, image source pages, and
  per-image licences.
- `../../scripts/build_malaysian_recipe_rag_500.py`: reproducible build script.
