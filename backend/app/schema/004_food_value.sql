-- ---------------------------------------------------------------
-- Migration 004 -- Estimated Food Value (Epic 9)
--
-- Adds three nullable columns to food_item. Together they record the
-- estimated value of one of the item's OWN units (per carton, per g, per
-- egg ...), taken from the national median price in the PriceCatcher
-- snapshot (backend/app/data/price_snapshot.csv):
--
--   est_unit_value_rm    RM per 1 unit of food_item.unit. NULL = no
--                        PriceCatcher match, or the unit can't be
--                        converted (AC 9.1.2) -- such items are left out
--                        of every RM total. NUMERIC(12,5) rather than
--                        (10,2) because per-gram prices are fractions of
--                        a sen (chicken breast is RM 0.0135 per g).
--   est_price_item_code  PriceCatcher item_code the estimate came from,
--                        so any figure can be traced back to the source.
--   est_price_month      Snapshot month the item was estimated against.
--                        Set even when there was no match, which is how
--                        "tried, nothing matched" differs from "not yet
--                        estimated" for the startup backfill.
--
-- Nothing about what the user actually PAID is stored, here or anywhere.
--
-- Safe on a populated database (IF NOT EXISTS). The API also applies this
-- file on startup (backend/app/schema/004_food_value.sql), so a Railway
-- deploy picks it up without a manual step.
-- ---------------------------------------------------------------

BEGIN;

ALTER TABLE food_item ADD COLUMN IF NOT EXISTS est_unit_value_rm   NUMERIC(12,5);
ALTER TABLE food_item ADD COLUMN IF NOT EXISTS est_price_item_code TEXT;
ALTER TABLE food_item ADD COLUMN IF NOT EXISTS est_price_month     DATE;

COMMIT;
