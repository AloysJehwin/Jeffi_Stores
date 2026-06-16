-- Multi-unit Phase 2.5 — typed dimensions on product_units.
--
-- Each unit carries a 'dimension' so the form can render the right input shape
-- (length: single factor; area: length × width; volume: length × width × height;
-- count/weight: single factor) and reports can convert across SI-equivalent units.
--
-- conversion_meta is the original input the admin gave so the form can re-edit
-- without losing intent. e.g. for an 'area' unit "sheet (4'×8')":
--   conversion_meta = {"type":"area","length":4,"width":8,"dim_unit":"ft"}
--   factor          = 2.9729  (m² in the variant's base m²)

ALTER TABLE product_units
  ADD COLUMN IF NOT EXISTS dimension VARCHAR(20) NOT NULL DEFAULT 'count'
    CHECK (dimension IN ('count', 'length', 'area', 'volume', 'weight', 'custom')),
  ADD COLUMN IF NOT EXISTS conversion_meta JSONB;

CREATE INDEX IF NOT EXISTS idx_product_units_dimension ON product_units (dimension);

-- Backfill existing rows: infer dimension from the unit label so the existing
-- 14k+ backfilled rows pick a sensible default. Anything we don't recognise
-- stays 'count' (the column's default).
UPDATE product_units SET dimension = 'length'
  WHERE LOWER(unit) IN ('m', 'cm', 'mm', 'ft', 'in', 'meter', 'metre', 'centimeter', 'centimetre', 'millimeter', 'millimetre', 'foot', 'feet', 'inch', 'inches');

UPDATE product_units SET dimension = 'weight'
  WHERE LOWER(unit) IN ('kg', 'g', 'lb', 'oz', 'kilogram', 'gram', 'pound', 'ounce', 'mt', 'tonne', 'ton');

UPDATE product_units SET dimension = 'volume'
  WHERE LOWER(unit) IN ('l', 'ml', 'liter', 'litre', 'gal', 'gallon');

UPDATE product_units SET dimension = 'area'
  WHERE LOWER(unit) IN ('m2', 'sqm', 'sq m', 'm²', 'ft2', 'sqft', 'sq ft', 'ft²', 'cm2', 'cm²');

INSERT INTO schema_migrations (filename, applied_at)
VALUES ('add_dimension_to_product_units.sql', NOW())
ON CONFLICT (filename) DO NOTHING;
