-- Idempotent production migration for Epic 7 / Epic 8 shopping-list linkage.
-- Safe to run during every AUTO_APPLY_SCHEMA startup.

CREATE TABLE IF NOT EXISTS shopping_list_item (
    list_item_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           UUID NOT NULL REFERENCES user_profile(user_id) ON DELETE CASCADE,
    name              VARCHAR(100) NOT NULL,
    category          VARCHAR(50),
    unit              VARCHAR(20),
    quantity          DECIMAL(10,2) NOT NULL DEFAULT 1,
    remaining_qty     DECIMAL(10,2) NOT NULL DEFAULT 1,
    source            VARCHAR(10) NOT NULL DEFAULT 'manual',
    rec_state         VARCHAR(20),
    have_at_home_qty  DECIMAL(10,2),
    status            VARCHAR(10) NOT NULL DEFAULT 'to_buy',
    bought_at         TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT shopping_list_item_source_check CHECK (source IN ('suggested', 'manual')),
    CONSTRAINT shopping_list_item_status_check CHECK (status IN ('to_buy', 'bought')),
    CONSTRAINT shopping_list_item_quantity_check CHECK (quantity > 0 AND remaining_qty >= 0)
);

CREATE INDEX IF NOT EXISTS idx_shopping_list_item_user ON shopping_list_item(user_id);

CREATE TABLE IF NOT EXISTS dismissed_suggestion (
    user_id       UUID NOT NULL REFERENCES user_profile(user_id) ON DELETE CASCADE,
    name_key      VARCHAR(100) NOT NULL,
    dismissed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, name_key)
);
