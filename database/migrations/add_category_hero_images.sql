ALTER TABLE categories
  ADD COLUMN IF NOT EXISTS hero_image_mobile  TEXT,
  ADD COLUMN IF NOT EXISTS hero_image_desktop TEXT;
