CREATE TABLE IF NOT EXISTS ai_briefing_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  briefing_date   DATE NOT NULL UNIQUE,
  sent_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  recipient_count INTEGER NOT NULL DEFAULT 0,
  sections        JSONB DEFAULT '{}'::jsonb,
  error           TEXT
);

CREATE INDEX IF NOT EXISTS idx_ai_briefing_log_date
  ON ai_briefing_log (briefing_date DESC);

