ALTER TABLE products
  ADD COLUMN IF NOT EXISTS ai_keywords      text[],
  ADD COLUMN IF NOT EXISTS ai_who_uses_it   text,
  ADD COLUMN IF NOT EXISTS ai_application   text,
  ADD COLUMN IF NOT EXISTS ai_product_type  text,
  ADD COLUMN IF NOT EXISTS ai_features      text[],
  ADD COLUMN IF NOT EXISTS ai_search_tags   text[];

CREATE INDEX IF NOT EXISTS idx_products_ai_keywords
  ON products USING gin (ai_keywords);

CREATE INDEX IF NOT EXISTS idx_products_ai_search_tags
  ON products USING gin (ai_search_tags);

ALTER TABLE product_ai_enrichment_log
  ADD COLUMN IF NOT EXISTS ai_keywords      text[],
  ADD COLUMN IF NOT EXISTS ai_who_uses_it   text,
  ADD COLUMN IF NOT EXISTS ai_application   text,
  ADD COLUMN IF NOT EXISTS ai_product_type  text,
  ADD COLUMN IF NOT EXISTS ai_features      text[],
  ADD COLUMN IF NOT EXISTS ai_search_tags   text[];
