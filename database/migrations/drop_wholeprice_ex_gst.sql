-- Remove wholesale price column from all three catalog tables
ALTER TABLE products             DROP COLUMN IF EXISTS wholeprice_ex_gst;
ALTER TABLE product_variants     DROP COLUMN IF EXISTS wholeprice_ex_gst;
ALTER TABLE product_sub_variants DROP COLUMN IF EXISTS wholeprice_ex_gst;
