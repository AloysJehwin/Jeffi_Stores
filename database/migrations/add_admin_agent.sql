CREATE TABLE IF NOT EXISTS admin_agent_messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id        UUID NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL,
  role            VARCHAR(20) NOT NULL,
  content         TEXT,
  tool_calls      JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_agent_messages_conv
  ON admin_agent_messages (conversation_id, created_at);

CREATE INDEX IF NOT EXISTS idx_admin_agent_messages_admin
  ON admin_agent_messages (admin_id, created_at DESC);

CREATE TABLE IF NOT EXISTS admin_agent_actions (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id             UUID NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  conversation_id      UUID NOT NULL,
  message_id           UUID REFERENCES admin_agent_messages(id) ON DELETE SET NULL,
  kind                 VARCHAR(64) NOT NULL,
  payload              JSONB NOT NULL DEFAULT '{}'::jsonb,
  status               VARCHAR(20) NOT NULL DEFAULT 'proposed',
  proposed_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_at           TIMESTAMPTZ,
  decided_by_admin_id  UUID REFERENCES admins(id) ON DELETE SET NULL,
  executed_at          TIMESTAMPTZ,
  result               JSONB,
  error                TEXT
);

CREATE INDEX IF NOT EXISTS idx_admin_agent_actions_conv
  ON admin_agent_actions (conversation_id, proposed_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_agent_actions_status
  ON admin_agent_actions (status, proposed_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_agent_actions_admin
  ON admin_agent_actions (admin_id, proposed_at DESC);
-- migrated
