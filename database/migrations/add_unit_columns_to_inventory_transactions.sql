-- Add unit-aware columns to inventory_transactions so adjustments can record
-- what unit the operator entered (e.g. "50 pair") alongside the base-unit change.
ALTER TABLE inventory_transactions
  ADD COLUMN IF NOT EXISTS unit_id     UUID          REFERENCES product_units(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS unit_label  VARCHAR(80),
  ADD COLUMN IF NOT EXISTS unit_factor NUMERIC(14,6),
  ADD COLUMN IF NOT EXISTS quantity_in_unit NUMERIC(14,6);

CREATE INDEX IF NOT EXISTS idx_inv_unit_id ON inventory_transactions(unit_id);
