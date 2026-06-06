-- Add rich response fields to admin_agent_messages so full conversation state
-- (ui_blocks, proposed_actions, pickers) is persisted and restorable.
ALTER TABLE admin_agent_messages
  ADD COLUMN IF NOT EXISTS ui_blocks       jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS proposed_actions jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS pickers         jsonb NOT NULL DEFAULT '[]'::jsonb;
