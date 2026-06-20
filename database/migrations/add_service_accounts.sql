-- Service accounts for machine-to-machine (M2M) auth via mTLS client certificates.
-- Each service account has a CA-signed cert; the serial is checked by middleware
-- before the admin_token cookie path, allowing automated callers to reach /api/admin/*.

CREATE TABLE IF NOT EXISTS service_accounts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name             TEXT NOT NULL UNIQUE,
  serial_number    TEXT NOT NULL UNIQUE,
  common_name      TEXT NOT NULL,
  allowed_scopes   TEXT[] NOT NULL DEFAULT '{}',
  is_revoked       BOOLEAN NOT NULL DEFAULT false,
  revoked_at       TIMESTAMPTZ,
  p12_data         BYTEA,
  p12_password     TEXT,
  p12_downloaded   BOOLEAN NOT NULL DEFAULT false,
  created_by       UUID REFERENCES admins(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_service_accounts_serial    ON service_accounts (serial_number);
CREATE INDEX IF NOT EXISTS idx_service_accounts_revoked   ON service_accounts (is_revoked);
CREATE INDEX IF NOT EXISTS idx_service_accounts_created_by ON service_accounts (created_by);
