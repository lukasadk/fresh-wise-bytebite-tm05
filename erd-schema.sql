-- ============================================================
-- FreshWise Database Schema  (No-PII revision)
-- Covers: Consumption/Waste Recording, Waste Insights Dashboard,
--         AI Expiry-Aware Recipe Recommendation & Diet Filtering
-- Target: PostgreSQL 18 (private Synology NAS, reached over Tailscale)
--
-- Privacy design note
-- --------------------
-- This schema intentionally stores NO directly identifying
-- personal information: no name, email, phone number, street
-- address, or password/credential material anywhere below.
--
--   * There is no login, account, email, or password anywhere in
--     this app at all -- not even held by an external identity
--     provider. `user_profile.user_id` is a random UUID the client
--     device generates itself on first launch (e.g. a locally
--     generated crypto.randomUUID()) and persists on-device; the
--     backend simply accepts whatever UUID the device presents.
--     No signup flow and no credential of any kind is collected or
--     stored, on this DB or anywhere else in the app.
--     NOTE: this is a device-only identity by design -- it is not
--     synced across devices or reinstalls. A reinstall or a new
--     device gets a fresh UUID and starts an unrelated profile.
--     If cross-device recovery is ever wanted later, it should use
--     a random, non-identifying recovery code -- not an email- or
--     phone-based one.
--   * `location` is a coarse, self-selected, OPTIONAL region string
--     (e.g. a Malaysian state/city, "Selangor"), not a street
--     address or GPS coordinate -- keep it to a controlled list
--     in the application layer so it can't drift into a free-text
--     quasi-identifier.
--   * `risk_score` is a derived label computed from a household's
--     own consumption/waste history (see DATA_RELATIONSHIPS.md,
--     section 5 -- days_to_expiry, consumption_rate_30d, etc.),
--     not anything collected about the person directly.
--   * No IP addresses, device identifiers, or precise timest-
--     amped geolocation are logged anywhere in this schema.
--
-- This file matches the 3-table ERD already shared with the
-- mentor/IM (User_Profile / Food_Item / Consumption_Waste_Log),
-- then extends it with the tables needed for the Diet Filtering
-- and Recipe Recommendation epic, plus read-only reference tables
-- that mirror the public datasets already sitting in
-- freshwise-docs/core_data (FoodKeeper, Open Food Facts MY,
-- PriceCatcher, Food.com recipes). Reference tables carry no user
-- data at all -- they're just lookups the app joins against.
-- ============================================================


-- ============================================================
-- SECTION 1 -- Core app tables (matches the mentor/IM ERD)
-- ============================================================

-- gen_random_uuid() has been built into PostgreSQL core since v13, so no
-- pgcrypto extension is required here -- one less contrib module to worry
-- about having available on the NAS's Postgres package.

CREATE TYPE risk_level AS ENUM ('low', 'med', 'high');

-- User_Profile
-- One row per anonymous device identity -- not an "account" in the
-- login sense. user_id is a UUID the client app generates itself on
-- first launch and sends as-is; the DEFAULT below is only a safety
-- net for a server-side insert that omits it, not the normal path.
-- No name, email, password, or any credential exists anywhere.
CREATE TABLE user_profile (
    user_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    household_size  INT NOT NULL CHECK (household_size > 0),
    location        VARCHAR(50),        -- optional, self-selected coarse region (state/city)
    risk_score      risk_level NOT NULL DEFAULT 'low',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Food_Item
-- What a household currently has (or had) and when it expires.
CREATE TYPE food_item_status AS ENUM ('active', 'consumed', 'wasted', 'partially_used');
CREATE TYPE food_item_source AS ENUM ('manual', 'barcode', 'photo');

CREATE TABLE food_item (
    item_id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES user_profile(user_id) ON DELETE CASCADE,
    name                VARCHAR(100) NOT NULL,
    category            VARCHAR(50),          -- e.g. 'produce', 'dairy', 'meat'
    canonical_food_name TEXT,                 -- normalized name for joining ref_* lookups
    barcode             TEXT,                 -- optional, joins ref_openfoodfacts_product
    quantity            DECIMAL(10,2) NOT NULL DEFAULT 1,
    unit                VARCHAR(20),           -- 'g', 'kg', 'pcs', 'ml', etc.
    purchase_date       DATE NOT NULL DEFAULT CURRENT_DATE,
    expiry_date         DATE,
    source              food_item_source NOT NULL DEFAULT 'manual',
    status              food_item_status NOT NULL DEFAULT 'active',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_food_item_user ON food_item(user_id);
CREATE INDEX idx_food_item_expiry ON food_item(expiry_date);
CREATE INDEX idx_food_item_status ON food_item(status);
CREATE INDEX idx_food_item_canonical_name ON food_item(canonical_food_name);

-- Consumption_Waste_Log
-- "Record whether purchased food was consumed or wasted and why" (Epic 1),
-- and the raw event feed the Waste Insights Dashboard (Epic 2) aggregates.
CREATE TYPE log_status AS ENUM ('consumed', 'wasted');
CREATE TYPE waste_reason AS ENUM (
    'expired',
    'spoiled',
    'cooked_too_much',
    'forgot_about_it',
    'didnt_like_taste',
    'changed_plans',
    'bought_too_much',
    'other'
);

CREATE TABLE consumption_waste_log (
    log_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    item_id         UUID NOT NULL REFERENCES food_item(item_id) ON DELETE CASCADE,
    status          log_status NOT NULL,
    quantity        DECIMAL(10,2) NOT NULL,
    waste_reason    waste_reason,   -- only meaningful when status = 'wasted'
    notes           VARCHAR(100),
    logged_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_log_item ON consumption_waste_log(item_id);
CREATE INDEX idx_log_status ON consumption_waste_log(status);
CREATE INDEX idx_log_reason ON consumption_waste_log(waste_reason);
CREATE INDEX idx_log_logged_at ON consumption_waste_log(logged_at);


-- ============================================================
-- SECTION 2 -- Diet Filtering & Recipe Recommendation epic
-- ============================================================

-- Diet_Preference
-- "someone wants more protein, others don't" -- per-user filter,
-- identified only by the anonymous user_id. Nutrient/macro and general
-- lifestyle tags (high-protein, low-carb, vegetarian, gluten-free, ...)
-- are fine here. Religion-linked dietary-law tags (halal, kosher, ...)
-- are deliberately NOT allowed to be saved against a user_id -- doing so
-- would persist a proxy for religious affiliation tied to an identifier,
-- which this project's PII policy rules out under "Private: religion",
-- even though the identifier itself is anonymous. Those filters can
-- still be applied ad hoc in the app UI by querying recipe.diet_tags
-- directly (recipes ARE fine to tag halal-friendly -- that's a property
-- of the food, not a fact about a person) -- they just never get written
-- to this table. The CHECK below enforces that at the DB level so it
-- can't be violated by a future app-layer bug; extend the list if more
-- religion/ethnicity-linked tags come up.
CREATE TABLE diet_preference (
    preference_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES user_profile(user_id) ON DELETE CASCADE,
    tag             TEXT NOT NULL,       -- e.g. 'high-protein', 'vegetarian', 'low-sodium'
    target_value    NUMERIC,             -- optional, e.g. grams of protein/day
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, tag),
    CONSTRAINT diet_preference_tag_not_religion_linked
        CHECK (lower(tag) NOT IN ('halal', 'kosher', 'jain', 'hindu-vegetarian', 'buddhist-vegetarian'))
);

-- Recipe
-- Cached/curated recipes used for ingredient-based matching and
-- diet-tag filtering. Populated from Spoonacular/Edamam calls
-- and/or the local Food.com reference tables below.
CREATE TABLE recipe (
    recipe_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    external_id     TEXT,                        -- ID from the source API/dataset
    source          TEXT NOT NULL,               -- 'spoonacular', 'edamam', 'foodcom', 'local'
    title           TEXT NOT NULL,
    image_url       TEXT,
    ingredients     JSONB NOT NULL DEFAULT '[]',
    instructions    TEXT,
    nutrients       JSONB,                        -- raw nutrient breakdown
    diet_tags       TEXT[] NOT NULL DEFAULT '{}', -- e.g. {'vegetarian','high-protein','halal'}
    cached_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (source, external_id)
);

CREATE INDEX idx_recipe_diet_tags ON recipe USING GIN (diet_tags);
CREATE INDEX idx_recipe_ingredients ON recipe USING GIN (ingredients);


-- ============================================================
-- SECTION 3 -- Reference data (read-only, public datasets)
-- Mirrors freshwise-docs/core_data/core_data/*.csv. No user data
-- lives in this section -- it's food/price/recipe knowledge the
-- app joins against via canonical_food_name / barcode / recipe_id.
-- ============================================================

-- ref_foodkeeper_storage  <-  foodkeeper_storage_clean.csv
CREATE TABLE ref_foodkeeper_storage (
    foodkeeper_id           TEXT PRIMARY KEY,
    canonical_food_name     TEXT NOT NULL,
    name                    TEXT,
    category_id             TEXT,
    pantry_min              NUMERIC,
    pantry_max              NUMERIC,
    pantry_metric           TEXT,
    refrigerate_min         NUMERIC,
    refrigerate_max         NUMERIC,
    refrigerate_metric      TEXT,
    freeze_min              NUMERIC,
    freeze_max              NUMERIC,
    freeze_metric           TEXT,
    extra_guidance          JSONB,   -- DOP_* / *_tips columns from the CSV, kept as-is
    source_dataset          TEXT,
    source_url              TEXT,
    license                 TEXT
);

CREATE INDEX idx_ref_foodkeeper_canonical_name ON ref_foodkeeper_storage(canonical_food_name);

-- ref_price_reference  <-  price_reference_item_monthly_clean.csv
CREATE TABLE ref_price_reference (
    item_code               TEXT NOT NULL,
    month                   DATE NOT NULL,        -- first-of-month for the RM reference price
    item                    TEXT,
    unit                    TEXT,
    item_group              TEXT,
    item_category            TEXT,
    canonical_food_name     TEXT NOT NULL,
    min_price_rm            NUMERIC(10,2),
    median_price_rm         NUMERIC(10,2),
    mean_price_rm           NUMERIC(10,2),
    max_price_rm            NUMERIC(10,2),
    observations            INT,
    premise_count           INT,
    source_dataset          TEXT,
    source_url              TEXT,
    license                 TEXT,
    PRIMARY KEY (item_code, month)
);

CREATE INDEX idx_ref_price_canonical_name ON ref_price_reference(canonical_food_name);

-- ref_openfoodfacts_product  <-  openfoodfacts_malaysia_products_clean.csv
CREATE TABLE ref_openfoodfacts_product (
    barcode                 TEXT PRIMARY KEY,
    canonical_food_name     TEXT NOT NULL,
    product_name            TEXT,
    product_name_en         TEXT,
    brands                  TEXT,
    categories              TEXT,
    ingredients_text        TEXT,
    quantity                TEXT,
    energy_kcal_100g        NUMERIC,
    fat_100g                NUMERIC,
    saturated_fat_100g      NUMERIC,
    carbohydrates_100g      NUMERIC,
    sugars_100g             NUMERIC,
    proteins_100g           NUMERIC,
    salt_100g               NUMERIC,
    image_url               TEXT,
    source_dataset          TEXT,
    source_url              TEXT
);

CREATE INDEX idx_ref_off_canonical_name ON ref_openfoodfacts_product(canonical_food_name);

-- ref_recipe_index  <-  foodcom_recipe_index_clean.csv
-- Lightweight index used for fast ingredient-coverage matching.
CREATE TABLE ref_recipe_index (
    recipe_id               TEXT PRIMARY KEY,   -- Food.com recipe_id (joins ref_recipe_detail)
    source_recipe_id        TEXT,
    recipe_name              TEXT,
    recipe_name_canonical    TEXT,
    ingredient_tokens        TEXT[],
    tags                      TEXT[],
    servings                  INT,
    serving_size              TEXT
);

CREATE INDEX idx_ref_recipe_index_tokens ON ref_recipe_index USING GIN (ingredient_tokens);
CREATE INDEX idx_ref_recipe_index_tags ON ref_recipe_index USING GIN (tags);

-- ref_recipe_detail  <-  foodcom_recipe_ingredients_clean.csv
-- Full ingredients + steps, fetched by recipe_id only after a
-- user picks a recipe from the ref_recipe_index shortlist.
CREATE TABLE ref_recipe_detail (
    recipe_id           TEXT PRIMARY KEY REFERENCES ref_recipe_index(recipe_id) ON DELETE CASCADE,
    ingredients          JSONB,
    ingredients_raw      TEXT,
    steps                TEXT,
    servings             INT,
    serving_size         TEXT
);


-- ============================================================
-- SECTION 4 -- Waste Insights Dashboard  (Epic 2)
-- "what I waste, how much, why, and how it changes over time."
-- ============================================================

CREATE VIEW weekly_waste_summary AS
SELECT
    fi.user_id,
    date_trunc('week', cwl.logged_at) AS week_start,
    cwl.waste_reason,
    COUNT(*)                AS waste_events,
    SUM(cwl.quantity)       AS total_quantity_wasted
FROM consumption_waste_log cwl
JOIN food_item fi ON fi.item_id = cwl.item_id
WHERE cwl.status = 'wasted'
GROUP BY fi.user_id, date_trunc('week', cwl.logged_at), cwl.waste_reason
ORDER BY week_start DESC;
