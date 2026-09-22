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
-- Where the household chose to KEEP the item. Distinct from the storage
-- *guidance* served by /v1/reference/foodkeeper, which is reference data
-- about how a food SHOULD be stored and is deliberately not duplicated here.
CREATE TYPE storage_type AS ENUM ('refrigerated', 'frozen', 'room_temp');

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
    storage             storage_type,         -- nullable: 'not specified'
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

-- ref_foodkeeper_storage  <-  core_data_v2/foodkeeper_storage.csv
-- Rebuilt 2026-08-25 from the official USDA JSON (see DATA_AUDIT.md).
--   * foodkeeper_id is now the UPSTREAM USDA numeric ID, not a locally
--     invented FK#### key -- rows can be traced back to the source.
--   * category_name is joined from the Category sheet, which the previous
--     build ignored (leaving category_id as an unresolvable number).
--   * canonical_food_name now includes Name_subtitle. Building it from Name
--     alone collapsed 661 products into 466 names, so "canned ham" and
--     "glazed ham" -- with very different storage lives -- shared a key.
--     With the subtitle it's 658 distinct names.
CREATE TABLE ref_foodkeeper_storage (
    foodkeeper_id           INT PRIMARY KEY,     -- upstream USDA product ID
    category_id             INT,
    category_name           TEXT,
    name                    TEXT,
    name_subtitle           TEXT,
    keywords                TEXT,
    canonical_food_name     TEXT NOT NULL,       -- includes subtitle
    canonical_name_base     TEXT,                -- name only; for broad fallback matching
    pantry_min              NUMERIC,
    pantry_max              NUMERIC,
    pantry_metric           TEXT,
    pantry_tips             TEXT,
    dop_pantry_min          NUMERIC,
    dop_pantry_max          NUMERIC,
    dop_pantry_metric       TEXT,
    pantry_after_opening_min      NUMERIC,
    pantry_after_opening_max      NUMERIC,
    pantry_after_opening_metric   TEXT,
    refrigerate_min         NUMERIC,
    refrigerate_max         NUMERIC,
    refrigerate_metric      TEXT,
    refrigerate_tips        TEXT,
    dop_refrigerate_min     NUMERIC,
    dop_refrigerate_max     NUMERIC,
    dop_refrigerate_metric  TEXT,
    refrigerate_after_opening_min     NUMERIC,
    refrigerate_after_opening_max     NUMERIC,
    refrigerate_after_opening_metric  TEXT,
    refrigerate_after_thawing_min     NUMERIC,
    refrigerate_after_thawing_max     NUMERIC,
    refrigerate_after_thawing_metric  TEXT,
    freeze_min              NUMERIC,
    freeze_max              NUMERIC,
    freeze_metric           TEXT,
    freeze_tips             TEXT,
    dop_freeze_min          NUMERIC,
    dop_freeze_max          NUMERIC,
    dop_freeze_metric       TEXT,
    source_dataset          TEXT,
    source_url              TEXT,
    license                 TEXT,
    fetched_at_utc          TIMESTAMPTZ
);

CREATE INDEX idx_ref_foodkeeper_canonical_name ON ref_foodkeeper_storage(canonical_food_name);
CREATE INDEX idx_ref_foodkeeper_canonical_base ON ref_foodkeeper_storage(canonical_name_base);

-- ref_price_reference  <-  core_data_v2/price_reference_item_monthly.csv
-- Rebuilt 2026-08-25 by re-aggregating the RAW PriceCatcher feed
-- (5,155,768 records across 2026-06..08) with percentile trimming.
--
-- Why this table changed shape
-- ---------------------------------------------------------------
-- The previous version published raw min/max straight off the feed with no
-- filtering, so single data-entry errors surfaced as real prices: chicken at
-- RM0.12/kg, chilli at RM1000/kg, carrot at RM718/kg. Re-aggregating from raw
-- showed 287 of 1,036 item-months had a contaminated minimum and 68 a
-- contaminated maximum.
--
-- So the published range is now p05..p95, which answers "what's a cheap or
-- expensive price for this item" without one fat-fingered record moving it.
-- raw_min_rm / raw_max_rm are retained ONLY so the contamination stays
-- auditable -- never display them. price_quality flags affected rows.
CREATE TABLE ref_price_reference (
    item_code               TEXT NOT NULL,
    month                   DATE NOT NULL,          -- first-of-month
    item                    TEXT,
    unit                    TEXT,
    item_group              TEXT,
    item_category           TEXT,
    canonical_food_name     TEXT NOT NULL,
    price_p05_rm            NUMERIC(10,2),          -- published low end
    price_p25_rm            NUMERIC(10,2),
    median_price_rm         NUMERIC(10,2),          -- the headline figure
    price_p75_rm            NUMERIC(10,2),
    price_p95_rm            NUMERIC(10,2),          -- published high end
    raw_min_rm              NUMERIC(10,2),          -- AUDIT ONLY -- do not display
    raw_max_rm              NUMERIC(10,2),          -- AUDIT ONLY -- do not display
    observations            INT,
    -- 'ok' | 'raw_min_contaminated' | 'raw_max_contaminated' | 'low_sample'
    price_quality           TEXT NOT NULL DEFAULT 'ok',
    aggregation_method      TEXT,
    source_dataset          TEXT,
    source_url              TEXT,
    license                 TEXT,
    fetched_at_utc          TIMESTAMPTZ,
    PRIMARY KEY (item_code, month)
);

CREATE INDEX idx_ref_price_canonical_name ON ref_price_reference(canonical_food_name);
CREATE INDEX idx_ref_price_month ON ref_price_reference(month);

-- ref_price_reference_state  <-  core_data_v2/price_reference_item_state_monthly.csv
-- NEW 2026-08-25. lookup_premise carries `state`, which the previous build
-- discarded entirely -- so prices could only ever be national. This makes
-- `user_profile.location` (a coarse Malaysian region) actually useful:
-- a household in Sabah can be shown Sabah prices, not a national average.
-- Item-months with fewer than 20 observations in a state are omitted rather
-- than published as a misleadingly precise figure.
CREATE TABLE ref_price_reference_state (
    item_code               TEXT NOT NULL,
    month                   DATE NOT NULL,
    state                   TEXT NOT NULL,
    canonical_food_name     TEXT NOT NULL,
    item                    TEXT,
    unit                    TEXT,
    median_price_rm         NUMERIC(10,2),
    price_p05_rm            NUMERIC(10,2),
    price_p95_rm            NUMERIC(10,2),
    observations            INT,
    source_url              TEXT,
    license                 TEXT,
    PRIMARY KEY (item_code, month, state)
);

CREATE INDEX idx_ref_price_state_canonical ON ref_price_reference_state(canonical_food_name);
CREATE INDEX idx_ref_price_state_state ON ref_price_reference_state(state);

-- ref_openfoodfacts_product  <-  core_data_v2/openfoodfacts_malaysia_products.csv
-- Rebuilt 2026-08-25 from the official OFF bulk export: 6,885 Malaysian
-- products, up from 88 in the previous build (which was a single unpaginated
-- API page).
--
-- COVERAGE WARNING -- matters for the diet-filtering epic
-- ---------------------------------------------------------------
-- Barcode -> product IDENTITY works well: 89% have a product name, and
-- allergen tags are present on 69%.
-- Barcode -> anything DIET-related does NOT work:
--     nutrients      6%  (393/6885 have energy_kcal)
--     NOVA group     6%  (404/6885 parse to a real 1-4 group)
--     Nutri-Score    4%  (303/6885 have a real grade)
-- So NO diet filter -- macro thresholds ("high protein") or processing level
-- ("avoid ultra-processed") -- can be served from this table. Those need USDA
-- FoodData Central (CC0) for ingredients, or MyFCD for Malaysian dishes.
-- NOTE: OFF stores absent NOVA/Nutri-Score as the literal strings "Unknown" /
-- "unknown", so a naive non-empty count reports ~99% coverage. It is 6%.
--
-- Missing nutrients are NULL and must never be coerced to 0 -- an absent
-- value means "unknown", not "contains none of it".
-- nutrition_source records whether a figure came from the product's own
-- label ('packaging_label') or OFF's own estimate ('off_estimate'), so an
-- estimated figure is never presented to a user as if it were label data.
CREATE TABLE ref_openfoodfacts_product (
    barcode                 TEXT PRIMARY KEY,
    product_name            TEXT,
    product_name_en         TEXT,
    product_name_ms         TEXT,
    canonical_food_name     TEXT,
    brands                  TEXT,
    categories              TEXT,
    categories_tags         TEXT,
    labels_tags             TEXT,
    allergens_tags          TEXT,
    ingredients_text        TEXT,
    quantity                TEXT,
    serving_size            TEXT,
    energy_kcal_100g        NUMERIC,
    energy_kj_100g          NUMERIC,
    fat_100g                NUMERIC,
    saturated_fat_100g      NUMERIC,
    carbohydrates_100g      NUMERIC,
    sugars_100g             NUMERIC,
    fiber_100g              NUMERIC,
    proteins_100g           NUMERIC,
    salt_100g               NUMERIC,
    sodium_100g             NUMERIC,
    -- 'packaging_label' | 'off_estimate' | 'none'
    nutrition_source        TEXT NOT NULL DEFAULT 'none',
    nutriscore_grade        TEXT,            -- NULL when OFF has no real grade
    nova_group              TEXT,            -- OFF's free-text label
    -- NOVA parsed to 1-4 so it can be filtered numerically. OFF stores this as
    -- free text ("4 - Ultra processed food and drink products", "Unknown"), so
    -- the numeric form is derived at build time rather than cast per query.
    nova_group_num          SMALLINT,
    image_url               TEXT,
    source_dataset          TEXT,
    source_url              TEXT,
    -- ODbL 1.0 -- attribution is legally REQUIRED wherever this is displayed.
    license                 TEXT,
    fetched_at_utc          TIMESTAMPTZ
);

CREATE INDEX idx_ref_off_canonical_name ON ref_openfoodfacts_product(canonical_food_name);
CREATE INDEX idx_ref_off_nova ON ref_openfoodfacts_product(nova_group_num);

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
