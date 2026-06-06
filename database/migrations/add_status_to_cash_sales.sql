-- Add status column to cash_sales for cancellation support
ALTER TABLE cash_sales ADD COLUMN IF NOT EXISTS status varchar NOT NULL DEFAULT 'active';

-- Backfill: any row already marked payment_status='cancelled' should get status='cancelled'
UPDATE cash_sales SET status = 'cancelled' WHERE payment_status = 'cancelled';

-- Add sub_variant_id to cash_sale_items (needed for sub-variant stock restock)
ALTER TABLE cash_sale_items ADD COLUMN IF NOT EXISTS sub_variant_id uuid;
