CREATE TABLE IF NOT EXISTS ai_feedback (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ai_query_id     UUID REFERENCES ai_queries(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id      UUID REFERENCES products(id) ON DELETE SET NULL,
  signal          VARCHAR(32) NOT NULL,
  comment         TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_feedback_query
  ON ai_feedback (ai_query_id);

CREATE INDEX IF NOT EXISTS idx_ai_feedback_user_recent
  ON ai_feedback (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_feedback_signal
  ON ai_feedback (signal, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_feedback_dedupe
  ON ai_feedback (ai_query_id, COALESCE(product_id::text, ''), signal);
-- migrated
