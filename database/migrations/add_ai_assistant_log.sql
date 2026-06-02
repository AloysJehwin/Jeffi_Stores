-- AI Assistant query log: tracks usage, cost, performance per user.

CREATE TABLE IF NOT EXISTS ai_queries (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  query_text        TEXT NOT NULL,
  candidate_count   INTEGER NOT NULL DEFAULT 0,
  recommended_count INTEGER NOT NULL DEFAULT 0,
  response_ms       INTEGER,
  model             VARCHAR(64),
  prompt_tokens     INTEGER,
  completion_tokens INTEGER,
  cost_inr          NUMERIC(8, 4),
  error             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_queries_user_time
  ON ai_queries (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_queries_recent
  ON ai_queries (created_at DESC)
  WHERE error IS NULL;


