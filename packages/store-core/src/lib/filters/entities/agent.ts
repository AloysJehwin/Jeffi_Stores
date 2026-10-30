import type { FieldKeys, FieldSql, FilterEntity } from '@jeffi/list-filters'
import { AGENT_LOG_DEFAULT_DAYS, AGENT_LOG_FIELDS } from '../fields/agent'

// Agent tool log: assistant responses in admin_agent_messages that called tools. The actions a
// response proposed are admin_agent_actions rows whose ids it lists in proposed_actions
// (admin_agent_actions.message_id is never set).

type AgentKey = FieldKeys<typeof AGENT_LOG_FIELDS>

const IST = (col: string) => `to_char(${col} AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI:SS')`
const ADMIN_NAME = "COALESCE(NULLIF(btrim(concat_ws(' ', u.first_name, u.last_name)), ''), u.email)"
const CALLS = 'jsonb_array_elements(am.tool_calls) t'
const PROPOSED = 'jsonb_array_elements(am.proposed_actions) pa'
const ACTIONS = {
  from: 'admin_agent_actions aa',
  link: `aa.id::text IN (SELECT pa->>'id' FROM ${PROPOSED})`,
}
const ERRORED = `EXISTS (SELECT 1 FROM ${CALLS} WHERE t->>'isError' = 'true')`

const SQL: Record<AgentKey, FieldSql> = {
  has_error: { kind: 'bool', expr: ERRORED },
  tool: { kind: 'values', lateral: { from: CALLS, link: "t ? 'tool'", expr: "t->>'tool'" } },
  created: { kind: 'date', expr: 'am.created_at' },
  admin: {
    kind: 'values',
    lateral: { from: 'admins a JOIN users u ON u.id = a.user_id', link: 'a.id = am.admin_id', expr: ADMIN_NAME },
  },
  status: { kind: 'enum', expr: 'aa.status', exists: ACTIONS },
  kind: { kind: 'values', lateral: { from: PROPOSED, link: "pa ? 'kind'", expr: "pa->>'kind'" } },
  has_action: { kind: 'bool', expr: 'jsonb_array_length(am.proposed_actions) > 0' },
}

export const AGENT_LOG_ENTITY: FilterEntity<AgentKey> = {
  key: 'agent.actions',
  scope: 'agent:read',
  exportScope: 'agent:write',
  noun: 'Responses',
  root: 'admin_agent_messages',
  alias: 'am',
  base: ["am.role = 'assistant'", 'jsonb_array_length(am.tool_calls) > 0'],
  fields: AGENT_LOG_FIELDS,
  sql: SQL,
  period: 'created',
  defaultWindowDays: AGENT_LOG_DEFAULT_DAYS,
  export: {
    columns: [
      { key: 'date', label: 'Date', sql: IST('am.created_at') },
      {
        key: 'member',
        label: 'Member',
        sql: `(SELECT ${ADMIN_NAME} FROM admins a JOIN users u ON u.id = a.user_id WHERE a.id = am.admin_id)`,
      },
      { key: 'tools', label: 'Tools', sql: `(SELECT string_agg(t->>'tool', ', ') FROM ${CALLS})` },
      { key: 'calls', label: 'Tool calls', sql: 'jsonb_array_length(am.tool_calls)' },
      {
        key: 'errors',
        label: 'Failed calls',
        sql: `(SELECT count(*) FROM ${CALLS} WHERE t->>'isError' = 'true')`,
      },
      {
        key: 'actions',
        label: 'Proposed actions',
        sql: `(SELECT string_agg(pa->>'kind', ', ') FROM ${PROPOSED})`,
      },
      {
        key: 'action_status',
        label: 'Action status',
        sql: `(SELECT string_agg(DISTINCT aa.status, ', ') FROM ${ACTIONS.from} WHERE ${ACTIONS.link})`,
      },
      { key: 'conversation', label: 'Conversation', sql: 'am.conversation_id::text' },
    ],
    keyset: ['am.created_at', 'am.id'],
    cap: 100_000,
  },
}
