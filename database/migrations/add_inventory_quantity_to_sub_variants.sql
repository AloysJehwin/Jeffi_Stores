ALTER TABLE product_sub_variants ADD COLUMN IF NOT EXISTS inventory_quantity integer NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE indexname = 'idx_product_sub_variants_inventory_quantity'
  ) THEN
    CREATE INDEX idx_product_sub_variants_inventory_quantity ON product_sub_variants (inventory_quantity);
  END IF;
END $$;

UPDATE product_sub_variants SET inventory_quantity = stock_quantity WHERE inventory_quantity = 0 AND stock_quantity > 0;
