CREATE TABLE IF NOT EXISTS back_in_stock_notify (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  email      TEXT NOT NULL,
  notified   BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notified_at TIMESTAMPTZ,
  UNIQUE (product_id, email)
);
CREATE INDEX IF NOT EXISTS idx_back_in_stock_notify_product ON back_in_stock_notify (product_id) WHERE notified = false;
