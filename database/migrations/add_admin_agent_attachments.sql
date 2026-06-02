CREATE TABLE IF NOT EXISTS admin_agent_attachments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id    uuid NOT NULL,
  filename    varchar(255),
  mime_type   varchar(64) NOT NULL,
  byte_size   integer NOT NULL,
  data        bytea NOT NULL,
  extracted_text text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL DEFAULT (now() + INTERVAL '2 hours')
);

CREATE INDEX IF NOT EXISTS idx_admin_agent_attachments_expiry ON admin_agent_attachments(expires_at);
CREATE INDEX IF NOT EXISTS idx_admin_agent_attachments_admin ON admin_agent_attachments(admin_id, created_at DESC);

