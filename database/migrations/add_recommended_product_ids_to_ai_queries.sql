ALTER TABLE ai_queries
  ADD COLUMN IF NOT EXISTS recommended_product_ids UUID[] NOT NULL DEFAULT '{}'::uuid[];

CREATE INDEX IF NOT EXISTS idx_ai_queries_recommended_user
  ON ai_queries USING GIN (recommended_product_ids)
  WHERE recommended_count > 0;

