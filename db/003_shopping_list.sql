-- ---------------------------------------------------------------
-- Migration 003 -- Smart Shopping List (Epic 8)
--
-- Adds two tables:
--   shopping_list_item    -- one row per line on the user's list, whether it
--                            came from an Epic 7 recommendation ('suggested')
--                            or was typed in by the user ('manual').
--   dismissed_suggestion  -- names the user swiped away (AC 8.1.6). A name
--                            here is not suggested again until a new pantry
--                            entry with a matching name is saved, at which
--                            point the backend deletes the row.
--
-- The recommendation STATES themselves (BUY_MORE / KEEP_SAME / BUY_LESS /
-- DO_NOT_BUY_YET) are not stored as their own table here -- they belong to
-- Epic 7. `rec_state` only snapshots the state a suggested row was created
-- with, so the badge still shows if Epic 7's output changes later.
--
-- Plain VARCHAR + CHECK instead of new Postgres ENUM types, so adding a
-- value later is an ALTER on a constraint rather than an ALTER TYPE.
--
-- Safe to run on a populated database (IF NOT EXISTS everywhere).
-- A database rebuilt from erd-schema.sql already has these tables.
-- ---------------------------------------------------------------

BEGIN;

CREATE TABLE IF NOT EXISTS shopping_list_item (
    list_item_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           UUID NOT NULL REFERENCES user_profile(user_id) ON DELETE CASCADE,
    name              VARCHAR(100) NOT NULL,
    category          VARCHAR(50),
    unit              VARCHAR(20),
    quantity          DECIMAL(10,2) NOT NULL DEFAULT 1,  -- what the list asked for
    remaining_qty     DECIMAL(10,2) NOT NULL DEFAULT 1,  -- still to buy (AC 8.3.3 "1 of 3 left")
    source            VARCHAR(10)  NOT NULL DEFAULT 'manual',
    rec_state         VARCHAR(20),                       -- Epic 7 state, suggested rows only
    have_at_home_qty  DECIMAL(10,2),                     -- set by "Add anyway" (AC 8.2.2)
    status            VARCHAR(10)  NOT NULL DEFAULT 'to_buy',
    bought_at         TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT shopping_list_item_source_check CHECK (source IN ('suggested', 'manual')),
    CONSTRAINT shopping_list_item_status_check CHECK (status IN ('to_buy', 'bought')),
    CONSTRAINT shopping_list_item_quantity_check CHECK (quantity > 0 AND remaining_qty >= 0)
);

CREATE INDEX IF NOT EXISTS idx_shopping_list_item_user ON shopping_list_item(user_id);

CREATE TABLE IF NOT EXISTS dismissed_suggestion (
    user_id       UUID NOT NULL REFERENCES user_profile(user_id) ON DELETE CASCADE,
    name_key      VARCHAR(100) NOT NULL,   -- lower(trim(name))
    dismissed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, name_key)
);

COMMIT;
