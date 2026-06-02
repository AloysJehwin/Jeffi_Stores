CREATE TABLE IF NOT EXISTS merchant_sync_log (
  id SERIAL PRIMARY KEY,
  status VARCHAR(20) NOT NULL,
  synced INTEGER NOT NULL DEFAULT 0,
  deleted INTEGER NOT NULL DEFAULT 0,
  errors JSONB,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_merchant_sync_log_started_at ON merchant_sync_log (started_at DESC);

