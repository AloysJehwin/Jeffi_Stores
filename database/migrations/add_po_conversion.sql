ALTER TABLE purchase_order_items
  ADD COLUMN IF NOT EXISTS purchase_unit        VARCHAR(50),
  ADD COLUMN IF NOT EXISTS purchase_unit_factor NUMERIC(14,6) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS line_total_incl_gst  NUMERIC(14,4),
  ADD COLUMN IF NOT EXISTS gst_inclusive        BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE grn_items
  ADD COLUMN IF NOT EXISTS purchase_unit_factor NUMERIC(14,6) NOT NULL DEFAULT 1;
