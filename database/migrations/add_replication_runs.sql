-- Replication runs log — populated by the Razer ML box when it pulls the
-- nightly RDS dump into its local jeffi_replica. Visible in /admin/replication.

CREATE TABLE IF NOT EXISTS replication_runs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id            TEXT NOT NULL UNIQUE,             -- e.g. repl-20260616T034000Z
  source            TEXT NOT NULL DEFAULT 'razer',    -- which box ran it
  status            TEXT NOT NULL CHECK (status IN ('ok', 'failed', 'partial', 'started')),
  started_at        TIMESTAMPTZ,                      -- best-effort: derived from run_id when omitted
  duration_seconds  INTEGER,
  row_count         BIGINT,
  dump_bytes        BIGINT,
  message           TEXT,
  recorded_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_replication_runs_recorded_at ON replication_runs (recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_replication_runs_status ON replication_runs (status);

INSERT INTO schema_migrations (filename) VALUES ('add_replication_runs.sql') ON CONFLICT DO NOTHING;
