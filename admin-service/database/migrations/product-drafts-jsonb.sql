-- Drop the old shadow-copy draft system
-- First clean any existing draft rows (is_active=false AND draft_of_id IS NOT NULL)
DO $$
DECLARE draft_id uuid;
BEGIN
  FOR draft_id IN SELECT id FROM products WHERE draft_of_id IS NOT NULL LOOP
    DELETE FROM product_units WHERE product_id = draft_id;
    DELETE FROM product_sub_variants WHERE product_id = draft_id;
    DELETE FROM product_images WHERE product_id = draft_id;
    DELETE FROM product_variants WHERE product_id = draft_id;
    DELETE FROM products WHERE id = draft_id;
  END LOOP;
END$$;

-- Drop the draft_of_id column (no longer needed)
ALTER TABLE products DROP COLUMN IF EXISTS draft_of_id;

-- Create the JSONB draft table (one draft per product, CASCADE deletes on product delete)
CREATE TABLE IF NOT EXISTS product_drafts (
  product_id    uuid PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
  fields        jsonb NOT NULL DEFAULT '{}',
  variants      jsonb NOT NULL DEFAULT '[]',
  images        jsonb NOT NULL DEFAULT '[]',
  sub_variants  jsonb NOT NULL DEFAULT '[]',
  units         jsonb NOT NULL DEFAULT '[]',
  created_by    uuid,
  created_at    timestamptz DEFAULT NOW(),
  updated_at    timestamptz DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_product_drafts_updated ON product_drafts(updated_at DESC);
