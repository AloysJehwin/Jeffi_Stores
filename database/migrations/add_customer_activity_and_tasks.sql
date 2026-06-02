-- Wave 3: Customer activity log + admin tasks
-- Activity log: chronological feed of everything that happens to/around a customer
-- Tasks: admin-assignable follow-ups (call, check return, etc.)

CREATE TABLE IF NOT EXISTS customer_activity_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actor_id        UUID REFERENCES admins(id) ON DELETE SET NULL,
  kind            VARCHAR(64) NOT NULL,
  reference_id    UUID,
  reference_type  VARCHAR(64),
  summary         TEXT NOT NULL,
  metadata        JSONB DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customer_activity_user_created
  ON customer_activity_log (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_customer_activity_kind
  ON customer_activity_log (kind, created_at DESC);


CREATE TABLE IF NOT EXISTS customer_tasks (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_by    UUID NOT NULL REFERENCES admins(id) ON DELETE RESTRICT,
  assigned_to   UUID REFERENCES admins(id) ON DELETE SET NULL,
  title         VARCHAR(255) NOT NULL,
  description   TEXT,
  due_date      DATE,
  priority      VARCHAR(16) NOT NULL DEFAULT 'medium'
                CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  status        VARCHAR(16) NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'in_progress', 'completed', 'cancelled')),
  completed_at  TIMESTAMPTZ,
  completed_by  UUID REFERENCES admins(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customer_tasks_user_status
  ON customer_tasks (user_id, status);

CREATE INDEX IF NOT EXISTS idx_customer_tasks_assigned_status_due
  ON customer_tasks (assigned_to, status, due_date)
  WHERE status IN ('pending', 'in_progress');

CREATE INDEX IF NOT EXISTS idx_customer_tasks_status_due
  ON customer_tasks (status, due_date)
  WHERE status IN ('pending', 'in_progress');


