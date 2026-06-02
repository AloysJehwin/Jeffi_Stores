-- Auto-task additions: source tracking for idempotency + auto-completion
-- Plus failed_login_attempts table for login anomaly trigger

ALTER TABLE customer_tasks
  ADD COLUMN IF NOT EXISTS source_kind   VARCHAR(64),
  ADD COLUMN IF NOT EXISTS source_ref_id VARCHAR(128),
  ADD COLUMN IF NOT EXISTS auto_created  BOOLEAN NOT NULL DEFAULT FALSE;

-- Make created_by nullable so cron-triggered (no admin actor) tasks work
ALTER TABLE customer_tasks ALTER COLUMN created_by DROP NOT NULL;

-- Prevent duplicate open auto-tasks for the same source event
CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_tasks_source_open
  ON customer_tasks (source_kind, source_ref_id)
  WHERE source_kind IS NOT NULL
    AND status IN ('pending', 'in_progress');

CREATE INDEX IF NOT EXISTS idx_customer_tasks_source
  ON customer_tasks (source_kind, source_ref_id);


CREATE TABLE IF NOT EXISTS failed_login_attempts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email       VARCHAR(255),
  user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
  ip_address  VARCHAR(64),
  user_agent  TEXT,
  reason      VARCHAR(64),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_failed_login_email_time
  ON failed_login_attempts (email, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_failed_login_user_time
  ON failed_login_attempts (user_id, created_at DESC)
  WHERE user_id IS NOT NULL;

