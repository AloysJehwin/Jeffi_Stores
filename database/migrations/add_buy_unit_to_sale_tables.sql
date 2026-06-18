-- Add buy_unit/buy_mode to cash_sale_items and buy_unit to quotation_items
-- so selling-unit context is persisted alongside the line item for audit/reprint.

ALTER TABLE cash_sale_items
  ADD COLUMN IF NOT EXISTS buy_unit VARCHAR(20),
  ADD COLUMN IF NOT EXISTS buy_mode VARCHAR(10) DEFAULT 'unit';

ALTER TABLE quotation_items
  ADD COLUMN IF NOT EXISTS buy_unit VARCHAR(20);

INSERT INTO schema_migrations (filename, applied_at)
VALUES ('add_buy_unit_to_sale_tables.sql', NOW())
ON CONFLICT (filename) DO NOTHING;
