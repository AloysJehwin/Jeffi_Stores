-- Drop legacy weight/length sale columns now that multi-unit system replaces them.
-- order_items.buy_mode + buy_unit columns kept for historical invoice rendering.

ALTER TABLE products
  DROP COLUMN IF EXISTS weight_rate,
  DROP COLUMN IF EXISTS weight_unit,
  DROP COLUMN IF EXISTS length_rate,
  DROP COLUMN IF EXISTS length_unit;

ALTER TABLE product_variants
  DROP COLUMN IF EXISTS weight_rate,
  DROP COLUMN IF EXISTS weight_unit,
  DROP COLUMN IF EXISTS length_rate,
  DROP COLUMN IF EXISTS length_unit,
  DROP COLUMN IF EXISTS weight_rate_on,
  DROP COLUMN IF EXISTS length_rate_on;
