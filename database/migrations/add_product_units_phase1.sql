-- Multi-unit selling — Phase 1
-- Adds per-variant alternate selling units + rule engine + order_items snapshot.
-- Backwards-compatible: products/variants without product_units rows keep their
-- existing single-unit behaviour. The pricing engine only kicks in when at least
-- one row exists for the variant.

CREATE TABLE IF NOT EXISTS product_units (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  -- variant_id is REQUIRED in Phase 1 because the user chose per-variant granularity.
  -- Products without variants will get a synthetic single variant row when the
  -- migration runs (covered in the seed step below).
  variant_id UUID NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  unit VARCHAR(20) NOT NULL,                    -- 'pc', 'box', 'roll', 'case', 'kg', 'm' etc.
  factor NUMERIC(14,6) NOT NULL CHECK (factor > 0),  -- how many BASE units this unit equals
  is_base BOOLEAN NOT NULL DEFAULT FALSE,       -- exactly one row per variant must be base
  is_purchase_default BOOLEAN NOT NULL DEFAULT FALSE,
  is_sell_default BOOLEAN NOT NULL DEFAULT FALSE,
  price_override NUMERIC(14,4),                 -- explicit price for this unit; else base × factor
  display_label VARCHAR(80),                    -- e.g. 'Box of 100 pcs' shown in UI
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (variant_id, unit)
);

CREATE INDEX IF NOT EXISTS idx_product_units_variant ON product_units (variant_id);
CREATE INDEX IF NOT EXISTS idx_product_units_product ON product_units (product_id);
CREATE INDEX IF NOT EXISTS idx_product_units_base ON product_units (variant_id) WHERE is_base = TRUE;
CREATE INDEX IF NOT EXISTS idx_product_units_sell_default ON product_units (variant_id) WHERE is_sell_default = TRUE;

-- Enforce exactly one base unit per variant.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_product_units_one_base_per_variant
  ON product_units (variant_id) WHERE is_base = TRUE;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_product_units_one_sell_default_per_variant
  ON product_units (variant_id) WHERE is_sell_default = TRUE;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_product_units_one_purchase_default_per_variant
  ON product_units (variant_id) WHERE is_purchase_default = TRUE;

-- Rules engine attached to a unit row. JSON config keeps the schema flexible
-- while we evolve the rule types in Phase 3+.
CREATE TABLE IF NOT EXISTS product_unit_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_unit_id UUID NOT NULL REFERENCES product_units(id) ON DELETE CASCADE,
  rule_type TEXT NOT NULL CHECK (rule_type IN (
    'tiered_price',
    'gst_threshold',
    'bonus_qty',
    'bundle_split',
    'physical_variance'
  )),
  config JSONB NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  priority INT NOT NULL DEFAULT 100,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_product_unit_rules_unit ON product_unit_rules (product_unit_id) WHERE is_active = TRUE;

-- Allow fractional stock for length/weight variants. Default 0 (integer) so
-- existing rows keep current behaviour.
ALTER TABLE product_variants
  ADD COLUMN IF NOT EXISTS stock_decimal_precision SMALLINT NOT NULL DEFAULT 0;

-- Order_items snapshot: store the unit the customer bought in plus the
-- factor at the time of sale (so a future change to product_units doesn't
-- rewrite history).
ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS sold_unit VARCHAR(20),
  ADD COLUMN IF NOT EXISTS sold_unit_factor NUMERIC(14,6),
  ADD COLUMN IF NOT EXISTS base_quantity NUMERIC(14,4),
  ADD COLUMN IF NOT EXISTS applied_rules JSONB;

-- Quotation_items: same snapshot
ALTER TABLE quotation_items
  ADD COLUMN IF NOT EXISTS sold_unit VARCHAR(20),
  ADD COLUMN IF NOT EXISTS sold_unit_factor NUMERIC(14,6),
  ADD COLUMN IF NOT EXISTS base_quantity NUMERIC(14,4),
  ADD COLUMN IF NOT EXISTS applied_rules JSONB;

-- Backfill: every existing variant gets ONE base unit row matching the variant's
-- current `unit`. Skips variants that already have rows. Stock and pricing
-- behaviour unchanged because factor=1.
INSERT INTO product_units (product_id, variant_id, unit, factor, is_base, is_sell_default)
SELECT pv.product_id, pv.id, COALESCE(NULLIF(pv.unit, ''), 'pc'), 1, TRUE, TRUE
FROM product_variants pv
LEFT JOIN product_units pu ON pu.variant_id = pv.id
WHERE pu.id IS NULL;

INSERT INTO schema_migrations (filename, applied_at)
VALUES ('add_product_units_phase1.sql', NOW())
ON CONFLICT (filename) DO NOTHING;
