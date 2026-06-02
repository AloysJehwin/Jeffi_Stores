ALTER TABLE cart_items ADD COLUMN IF NOT EXISTS sub_variant_id UUID REFERENCES product_sub_variants(id) ON DELETE SET NULL;

ALTER TABLE cart_items DROP CONSTRAINT IF EXISTS cart_items_user_id_product_id_variant_id_key;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'cart_items_user_product_variant_subvariant_key'
      AND conrelid = 'cart_items'::regclass
  ) THEN
    ALTER TABLE cart_items ADD CONSTRAINT cart_items_user_product_variant_subvariant_key
      UNIQUE (user_id, product_id, variant_id, sub_variant_id);
  END IF;
END $$;


