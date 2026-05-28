ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS shipping_address_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS billing_address_snapshot JSONB;
