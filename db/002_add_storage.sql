-- ---------------------------------------------------------------
-- Migration 002 -- add food_item.storage
--
-- Adds the user's own storage choice (Refrigerated / Frozen / Room temp)
-- collected by AddFoodScreen. Storage *guidance* text is deliberately NOT
-- stored: it is reference data, served from /v1/reference/foodkeeper.
--
-- Safe to run on a database that already has rows: the column is nullable,
-- so existing food_item rows simply get NULL ("not specified").
--
-- Run this INSTEAD of rebuilding, if your database is already populated.
-- A database rebuilt from erd-schema.sql already has the column.
-- ---------------------------------------------------------------

BEGIN;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'storage_type') THEN
        CREATE TYPE storage_type AS ENUM ('refrigerated', 'frozen', 'room_temp');
    END IF;
END
$$;

ALTER TABLE food_item ADD COLUMN IF NOT EXISTS storage storage_type;

COMMIT;
