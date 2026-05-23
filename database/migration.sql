-- Single migration file. Overwrite this file with the next migration before deploying.
-- This file is run by the CI/CD pipeline on every deploy to main.
-- Use IF NOT EXISTS / ADD COLUMN IF NOT EXISTS so it is safe to re-run.

-- Add sub_variant_id to cart_items to support sub-variant selection
ALTER TABLE cart_items ADD COLUMN IF NOT EXISTS sub_variant_id UUID REFERENCES product_sub_variants(id) ON DELETE SET NULL;

-- Drop the old unique constraint (doesn't include sub_variant_id)
ALTER TABLE cart_items DROP CONSTRAINT IF EXISTS cart_items_user_id_product_id_variant_id_key;

-- Add a new unique constraint that includes sub_variant_id
ALTER TABLE cart_items ADD CONSTRAINT IF NOT EXISTS cart_items_user_product_variant_subvariant_key
  UNIQUE (user_id, product_id, variant_id, sub_variant_id);
