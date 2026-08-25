-- ---------------------------------------------------------------
-- FreshWise -- drop every object erd-schema.sql creates, so the
-- schema can be applied cleanly onto an existing database.
--
-- DESTRUCTIVE. Every row in these tables is deleted. Only run this
-- when you intend to rebuild from scratch.
--
-- Usage:
--   1. run this file
--   2. run erd-schema.sql
--   3. re-apply grants.sql (privileges do not survive a DROP TABLE)
-- ---------------------------------------------------------------

BEGIN;

DROP VIEW IF EXISTS weekly_waste_summary;

DROP TABLE IF EXISTS
    consumption_waste_log,
    diet_preference,
    food_item,
    recipe,
    user_profile,
    ref_recipe_detail,
    ref_recipe_index,
    ref_openfoodfacts_product,
    ref_price_reference_state,
    ref_price_reference,
    ref_foodkeeper_storage
CASCADE;

DROP TYPE IF EXISTS
    risk_level,
    food_item_status,
    food_item_source,
    log_status,
    waste_reason
CASCADE;

COMMIT;
