-- Add public view tokens for email links (quotations, invoices, purchase orders)
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS view_token UUID DEFAULT gen_random_uuid();
ALTER TABLE orders ADD COLUMN IF NOT EXISTS view_token UUID DEFAULT gen_random_uuid();
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS view_token UUID DEFAULT gen_random_uuid();

-- Backfill existing rows that have NULL tokens
UPDATE quotations SET view_token = gen_random_uuid() WHERE view_token IS NULL;
UPDATE orders SET view_token = gen_random_uuid() WHERE view_token IS NULL;
UPDATE purchase_orders SET view_token = gen_random_uuid() WHERE view_token IS NULL;

-- Add indexes for token lookups
CREATE UNIQUE INDEX IF NOT EXISTS quotations_view_token_idx ON quotations(view_token);
CREATE UNIQUE INDEX IF NOT EXISTS orders_view_token_idx ON orders(view_token);
CREATE UNIQUE INDEX IF NOT EXISTS purchase_orders_view_token_idx ON purchase_orders(view_token);


