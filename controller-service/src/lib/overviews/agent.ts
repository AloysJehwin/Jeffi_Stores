import { queryMany, queryOne } from '@/lib/shared/db'
import { ratio, type Period } from '@/lib/overview/period'
import type { AttentionItem } from '@/lib/overview/attention'
import { kpi, n, periodSql, plural, snapshot, type OverviewKpi } from './ops-kpi'

// AI agent strip. Conversations and tool calls come from admin_agent_messages, actions from
// admin_agent_actions. The agent's own model cost is not logged; AI spend is the storefront AI
// search (ai_queries.cost_inr), the only AI cost the store records.

export const TOOL_ERROR_RATE = 0.2

export function agentAttention(s: {
  pending: number
  failed: number
  proposed_tools: number
  tool_calls: number
  tool_errors: number
}): AttentionItem[] {
  const out: AttentionItem[] = []
  if (s.pending)
    out.push({
      key: 'pending',
      severity: 'warning',
      title: `${plural(s.pending, 'agent action')} waiting for approval`,
      href: '/admin/agent',
    })
  if (s.failed)
    out.push({
      key: 'failed',
      severity: 'warning',
      title: `${plural(s.failed, 'approved action')} failed in this period`,
      href: '/admin/agent/logs?status=failed',
    })
  if (s.proposed_tools)
    out.push({
      key: 'tools',
      severity: 'info',
      title: `${plural(s.proposed_tools, 'proposed tool')} to review`,
      href: '/admin/agent/proposed-tools',
    })
  const rate = ratio(s.tool_errors, s.tool_calls)
  if (rate != null && rate >= TOOL_ERROR_RATE && s.tool_errors >= 5)
    out.push({
      key: 'errors',
      severity: 'info',
      title: `${Math.round(rate * 100)}% of tool calls errored`,
      sub: `${s.tool_errors} of ${s.tool_calls}`,
      href: '/admin/agent/logs?has_error=true',
    })
  return out
}

export async function getAgentOverview(period: Period) {
  const ps = periodSql(period)
  const [msgs, tools, actions, snap, spend, topTools] = await Promise.all([
    queryOne<Record<string, unknown>>(
      `SELECT COUNT(DISTINCT conversation_id) FILTER (WHERE ${ps.cur('created_at')}) AS conversations,
              COUNT(DISTINCT conversation_id) FILTER (WHERE ${ps.prev('created_at')}) AS prev_conversations,
              COUNT(*) FILTER (WHERE role = 'user' AND ${ps.cur('created_at')}) AS prompts,
              COUNT(*) FILTER (WHERE role = 'user' AND ${ps.prev('created_at')}) AS prev_prompts,
              COUNT(DISTINCT admin_id) FILTER (WHERE ${ps.cur('created_at')}) AS admins
       FROM admin_agent_messages WHERE ${ps.span('created_at')}`,
      ps.params
    ),
    queryOne<Record<string, unknown>>(
      `SELECT COUNT(*) FILTER (WHERE ${ps.cur('m.created_at')}) AS calls,
              COUNT(*) FILTER (WHERE ${ps.prev('m.created_at')}) AS prev_calls,
              COUNT(*) FILTER (WHERE ${ps.cur('m.created_at')} AND (t->>'isError')::boolean IS TRUE) AS errors
       FROM admin_agent_messages m, jsonb_array_elements(m.tool_calls) t
       WHERE ${ps.span('m.created_at')}`,
      ps.params
    ),
    queryOne<Record<string, unknown>>(
      `SELECT COUNT(*) FILTER (WHERE ${ps.cur('proposed_at')}) AS proposed,
              COUNT(*) FILTER (WHERE ${ps.cur('executed_at')} AND status = 'executed') AS executed,
              COUNT(*) FILTER (WHERE ${ps.prev('executed_at')} AND status = 'executed') AS prev_executed,
              COUNT(*) FILTER (WHERE ${ps.cur('COALESCE(decided_at, proposed_at)')} AND status = 'failed') AS failed
       FROM admin_agent_actions`,
      ps.params
    ),
    queryOne<Record<string, unknown>>(
      `SELECT (SELECT COUNT(*) FROM admin_agent_actions WHERE status = 'proposed') AS pending,
              (SELECT COUNT(*) FROM admin_agent_proposed_tools WHERE status = 'proposed') AS proposed_tools`
    ),
    queryOne<Record<string, unknown>>(
      `SELECT COALESCE(SUM(cost_inr) FILTER (WHERE ${ps.cur('created_at')}), 0) AS spend,
              COALESCE(SUM(cost_inr) FILTER (WHERE ${ps.prev('created_at')}), 0) AS prev_spend,
              COUNT(*) FILTER (WHERE ${ps.cur('created_at')}) AS queries
       FROM ai_queries WHERE ${ps.span('created_at')}`,
      ps.params
    ),
    queryMany<Record<string, unknown>>(
      `SELECT t->>'tool' AS tool, COUNT(*) AS calls, COUNT(*) FILTER (WHERE (t->>'isError')::boolean IS TRUE) AS errors
       FROM admin_agent_messages m, jsonb_array_elements(m.tool_calls) t
       WHERE ${ps.cur('m.created_at')} AND t ? 'tool'
       GROUP BY 1 ORDER BY 2 DESC LIMIT 8`,
      ps.params.slice(0, 2)
    ),
  ])
  const s = {
    pending: n(snap?.pending),
    failed: n(actions?.failed),
    proposed_tools: n(snap?.proposed_tools),
    tool_calls: n(tools?.calls),
    tool_errors: n(tools?.errors),
  }
  const kpis: OverviewKpi[] = [
    kpi('conversations', 'Conversations', n(msgs?.conversations), n(msgs?.prev_conversations), 'count', {
      sub: plural(n(msgs?.admins), 'member'),
    }),
    kpi('prompts', 'Questions asked', n(msgs?.prompts), n(msgs?.prev_prompts), 'count'),
    kpi('tools', 'Tool calls', s.tool_calls, n(tools?.prev_calls), 'count', { sub: `${s.tool_errors} errored` }),
    kpi('actions', 'Actions taken', n(actions?.executed), n(actions?.prev_executed), 'count', {
      sub: `${n(actions?.proposed)} proposed`,
    }),
    snapshot('pending', 'Awaiting approval', s.pending, 'count', { invert: true }),
    kpi('spend', 'AI search spend', n(spend?.spend), n(spend?.prev_spend), 'money', {
      invert: true,
      sub: plural(n(spend?.queries), 'query', 'queries'),
    }),
  ]
  return {
    range: period,
    previous_range: ps.previous,
    kpis,
    top_tools: topTools.map(r => ({ tool: String(r.tool), calls: n(r.calls), errors: n(r.errors) })),
    attention: agentAttention(s),
  }
}
