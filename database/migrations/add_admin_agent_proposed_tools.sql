CREATE TABLE IF NOT EXISTS admin_agent_proposed_tools (
  id                    uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  proposed_by_admin_id  uuid NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  source_prompt         text NOT NULL,
  name                  text NOT NULL,
  description           text NOT NULL,
  args_schema           jsonb NOT NULL DEFAULT '{}'::jsonb,
  kind                  text NOT NULL,
  sql_template          text,
  email_template        jsonb,
  status                text NOT NULL DEFAULT 'proposed',
  created_at            timestamptz NOT NULL DEFAULT NOW(),
  decided_at            timestamptz,
  decided_by_admin_id   uuid REFERENCES admins(id) ON DELETE SET NULL,
  rejection_reason      text,
  invocation_count      integer NOT NULL DEFAULT 0,
  last_invoked_at       timestamptz,
  CONSTRAINT admin_agent_proposed_tools_kind_chk
    CHECK (kind IN ('readonly_sql', 'templated_email')),
  CONSTRAINT admin_agent_proposed_tools_status_chk
    CHECK (status IN ('proposed', 'approved', 'rejected', 'retired'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_aapt_name_active
  ON admin_agent_proposed_tools (name)
  WHERE status = 'approved';

CREATE INDEX IF NOT EXISTS idx_aapt_status
  ON admin_agent_proposed_tools (status, created_at DESC);


