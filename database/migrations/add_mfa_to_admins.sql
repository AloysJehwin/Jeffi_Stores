ALTER TABLE admins
  ADD COLUMN IF NOT EXISTS mfa_secret_enc text,
  ADD COLUMN IF NOT EXISTS mfa_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS mfa_enrolled_at timestamptz;

CREATE TABLE IF NOT EXISTS admin_mfa_recovery_codes (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  admin_id uuid NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  code_hash text NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_mfa_recovery_codes_admin_id
  ON admin_mfa_recovery_codes (admin_id) WHERE used_at IS NULL;

