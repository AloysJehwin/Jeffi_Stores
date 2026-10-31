import 'server-only'
import { query, queryOne } from '@/lib/shared/db'
import { actionDenial, type AgentActor } from '@/lib/admin-agent/permissions'
import { executeAction } from './execute'
import type { AgentAction } from './shared'

export type DecidedVia = 'web' | 'whatsapp'

export type ApproveOutcome =
  | { ok: true; status: 'executed'; result: any }
  | { ok: false; status: 'failed' | 'refused'; error: string; code: number }

// The conditional UPDATE is the claim: a retried request or a second YES can't run an action twice.
async function claim(id: string, actor: AgentActor, to: 'approved' | 'rejected', via: DecidedVia) {
  const row = await queryOne<AgentAction>(
    `SELECT id::text, admin_id::text, conversation_id::text, kind, payload, status
       FROM admin_agent_actions WHERE id = $1::uuid LIMIT 1`,
    [id]
  )
  if (!row) return { error: 'Action not found', code: 404 }
  if (row.admin_id !== actor.adminId) return { error: 'Not your action', code: 403 }
  if (row.status !== 'proposed') return { error: `Action already ${row.status}`, code: 400 }
  const r = await query(
    `UPDATE admin_agent_actions SET status = '${to}', decided_at = NOW(), decided_by_admin_id = $2, decided_via = $3
      WHERE id = $1::uuid AND status = 'proposed'`,
    [id, actor.adminId, via]
  )
  if (!r?.rowCount) return { error: 'Action already decided', code: 400 }
  return { row }
}

/** The agent acts with the approver's own permissions; cookieHeader is the session its API calls carry. */
export async function approveAgentAction(
  id: string,
  actor: AgentActor,
  opts: { via: DecidedVia; cookieHeader: string }
): Promise<ApproveOutcome> {
  const c = await claim(id, actor, 'approved', opts.via)
  if (!c.row) return { ok: false, status: 'refused', error: c.error!, code: c.code! }

  const denial = actionDenial(c.row.kind, c.row.payload, actor)
  if (denial) {
    await query(
      `UPDATE admin_agent_actions SET status = 'failed', decided_by_admin_id = $1, error = $2 WHERE id = $3::uuid`,
      [actor.adminId, denial, id]
    )
    return { ok: false, status: 'failed', error: denial, code: 403 }
  }

  const { result, error } = await executeAction(c.row, opts.cookieHeader)
  await query(
    `UPDATE admin_agent_actions SET status = $1, executed_at = NOW(), result = $2::jsonb, error = $3 WHERE id = $4::uuid`,
    [error ? 'failed' : 'executed', JSON.stringify(result || {}), error, id]
  )
  return error ? { ok: false, status: 'failed', error, code: 500 } : { ok: true, status: 'executed', result }
}

export async function rejectAgentAction(id: string, actor: AgentActor, via: DecidedVia) {
  const c = await claim(id, actor, 'rejected', via)
  return c.row ? { ok: true as const } : { ok: false as const, error: c.error!, code: c.code! }
}
