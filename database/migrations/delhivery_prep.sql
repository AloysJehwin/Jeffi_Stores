-- Delhivery integration prep: add weight and dimensions to products
-- weight_grams: used for shipping rate calculation (required by Delhivery API)
-- length_cm, breadth_cm, height_cm: volumetric weight calculation (optional but recommended)

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS weight_grams INTEGER DEFAULT 500,
  ADD COLUMN IF NOT EXISTS length_cm NUMERIC(6,2) DEFAULT 10,
  ADD COLUMN IF NOT EXISTS breadth_cm NUMERIC(6,2) DEFAULT 10,
  ADD COLUMN IF NOT EXISTS height_cm NUMERIC(6,2) DEFAULT 10;

COMMENT ON COLUMN products.weight_grams IS 'Actual product weight in grams for Delhivery shipping rate calculation';
COMMENT ON COLUMN products.length_cm IS 'Package length in cm for volumetric weight';
COMMENT ON COLUMN products.breadth_cm IS 'Package breadth in cm for volumetric weight';
COMMENT ON COLUMN products.height_cm IS 'Package height in cm for volumetric weight';
