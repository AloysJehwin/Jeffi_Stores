-- Custom scenarios: admin-created behavioral triggers (AI-generated SQL).
-- Lives alongside the code-defined registry (scenarios table). The runner
-- prefers built-in modules when scenario_kind matches one; otherwise it
-- looks here.

CREATE TABLE IF NOT EXISTS custom_scenarios (
  kind             VARCHAR(64) PRIMARY KEY REFERENCES scenarios(kind) ON DELETE CASCADE,
  name             VARCHAR(128) NOT NULL,
  description      TEXT,
  ai_prompt        TEXT NOT NULL,
  generated_sql    TEXT NOT NULL,
  dry_run_count    INTEGER,
  dry_run_at       TIMESTAMPTZ,
  approved_by      UUID REFERENCES admins(id) ON DELETE SET NULL,
  approved_at      TIMESTAMPTZ,
  enabled          BOOLEAN NOT NULL DEFAULT FALSE,
  parameters       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_custom_scenarios_enabled
  ON custom_scenarios (enabled) WHERE enabled = TRUE;

CREATE TABLE IF NOT EXISTS scenario_audit_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario_kind   VARCHAR(64),
  admin_id        UUID REFERENCES admins(id) ON DELETE SET NULL,
  action          VARCHAR(32) NOT NULL,
  ai_prompt       TEXT,
  ai_response     TEXT,
  generated_sql   TEXT,
  validation      JSONB,
  result          JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scenario_audit_kind
  ON scenario_audit_log (scenario_kind, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_scenario_audit_admin
  ON scenario_audit_log (admin_id, created_at DESC);

