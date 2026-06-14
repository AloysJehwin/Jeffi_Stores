-- Add policy-acceptance tracking to users.
-- Allows asking users to re-accept on each policy update.

BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS policies_accepted_version text,
  ADD COLUMN IF NOT EXISTS policies_accepted_at      timestamptz;

CREATE INDEX IF NOT EXISTS idx_users_policies_accepted_version
  ON users (policies_accepted_version);

INSERT INTO schema_migrations (filename)
VALUES ('add_user_policy_acceptance.sql')
ON CONFLICT DO NOTHING;

COMMIT;
