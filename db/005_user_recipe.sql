-- ---------------------------------------------------------------
-- Migration 005 -- Homemade recipes
--
-- Adds one table:
--   user_recipe -- a recipe the household wrote themselves ("My recipes").
--                  Ingredients and steps are JSONB lists so a recipe is one
--                  row: ingredients = [{"name": "Chicken", "amount": "500 g"}],
--                  steps = ["Marinate the chicken", "Fry until golden"].
--
-- The API also creates this table on first use (CREATE TABLE IF NOT EXISTS
-- in app/routers/user_recipes.py), so running this file by hand is optional.
-- Safe to run on a populated database (IF NOT EXISTS everywhere).
-- ---------------------------------------------------------------

BEGIN;

CREATE TABLE IF NOT EXISTS user_recipe (
    recipe_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID NOT NULL REFERENCES user_profile(user_id) ON DELETE CASCADE,
    title         VARCHAR(120) NOT NULL,
    servings      SMALLINT,
    prep_minutes  SMALLINT,
    cook_minutes  SMALLINT,
    ingredients   JSONB NOT NULL DEFAULT '[]'::jsonb,
    steps         JSONB NOT NULL DEFAULT '[]'::jsonb,
    notes         VARCHAR(500),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT user_recipe_servings_check CHECK (servings IS NULL OR servings BETWEEN 1 AND 50),
    CONSTRAINT user_recipe_minutes_check CHECK (
        (prep_minutes IS NULL OR prep_minutes BETWEEN 0 AND 1440)
        AND (cook_minutes IS NULL OR cook_minutes BETWEEN 0 AND 1440)
    )
);

CREATE INDEX IF NOT EXISTS idx_user_recipe_user ON user_recipe(user_id);

COMMIT;