ALTER TABLE cart_items
  ADD COLUMN IF NOT EXISTS saved_for_later BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS saved_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_cart_items_user_saved ON cart_items (user_id, saved_for_later);


