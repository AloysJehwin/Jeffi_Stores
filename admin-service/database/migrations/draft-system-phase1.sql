-- Draft/Active System — Phase 1
-- Adds draft_of_id self-reference to products and orders tables.
-- A non-NULL draft_of_id marks the row as a draft copy of the referenced live row.
-- Deleting the live row cascades and removes its drafts.

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS draft_of_id uuid REFERENCES products(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_products_draft_of_id ON products(draft_of_id);

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS draft_of_id uuid REFERENCES orders(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_orders_draft_of_id ON orders(draft_of_id);
