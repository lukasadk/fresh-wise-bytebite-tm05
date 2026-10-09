-- 006_planned_recipe.sql
-- "Planned" recipes: dishes the household plans to cook later.
-- Planning a recipe also adds its missing ingredients to the shopping list;
-- shopping_item_ids remembers which rows it added so they can be removed
-- again if the plan is cancelled.
--
-- The API also creates this table on first use (CREATE TABLE IF NOT EXISTS),
-- so running this file by hand is optional and safe to repeat.

CREATE TABLE IF NOT EXISTS planned_recipe (
    planned_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id            UUID NOT NULL REFERENCES user_profile(user_id) ON DELETE CASCADE,
    recipe_key         VARCHAR(160) NOT NULL,
    title              VARCHAR(160) NOT NULL,
    -- Copy of the recipe as shown when it was planned (AI recipes are not
    -- stored anywhere else, so this is what the Planned tab displays).
    recipe             JSONB NOT NULL DEFAULT '{}'::jsonb,
    shopping_item_ids  JSONB NOT NULL DEFAULT '[]'::jsonb,
    planned_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT planned_recipe_user_key_unique UNIQUE (user_id, recipe_key)
);

CREATE INDEX IF NOT EXISTS idx_planned_recipe_user ON planned_recipe(user_id);
