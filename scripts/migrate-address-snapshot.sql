ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS shipping_address_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS billing_address_snapshot JSONB;

-- Backfill existing orders: copy the current address rows as JSONB snapshots
UPDATE orders o
SET
  shipping_address_snapshot = row_to_json(sa.*)::jsonb,
  billing_address_snapshot  = row_to_json(ba.*)::jsonb
FROM
  addresses sa,
  addresses ba
WHERE sa.id = o.shipping_address_id
  AND ba.id = o.billing_address_id
  AND o.shipping_address_snapshot IS NULL;

-- Orders that have only a shipping address (billing_address_id is null or same)
UPDATE orders o
SET
  shipping_address_snapshot = row_to_json(sa.*)::jsonb,
  billing_address_snapshot  = row_to_json(sa.*)::jsonb
FROM addresses sa
WHERE sa.id = o.shipping_address_id
  AND o.billing_address_id IS NULL
  AND o.shipping_address_snapshot IS NULL;
