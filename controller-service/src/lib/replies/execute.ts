import 'server-only'
import { query, queryOne } from '@/lib/shared/db'
import { runWithAuditActor } from '@/lib/auth/audit-context'
import { markAnswered } from './context'
import { scenarioFor } from './scenarios'
import type { ExecResult, ReplyContextRow } from './types'

// Running what the customer asked for. Their own decision (applied automatically or confirmed with
// YES) is credited to them in the change log; an admin's approval runs as that admin.

export interface ReplyAction {
  id: string
  session_id: string
  message_id: string | null
  kind: 'reply'
  args: { scenario: string; intent: string; args: Record<string, unknown>; title?: string }
  status: string
  awaiting: 'customer' | 'admin' | 'none'
  context_id: string | null
  entity_type: string | null
  entity_id: string | null
  confidence: string | null
  reading: string | null
  created_at: string
}

export async function runReplyAction(a: ReplyAction, by: { userId: string | null; adminId?: string | null; auto?: boolean }): Promise<ExecResult> {
  const ctx = a.context_id ? await queryOne<ReplyContextRow>(`SELECT * FROM reply_contexts WHERE id = $1`, [a.context_id]) : null
  const scenario = ctx ? scenarioFor(ctx.scenario) : null
  const finish = async (status: 'done' | 'failed', r: ExecResult) => {
    await query(
      `UPDATE support_ai_actions SET status = $2, result = $3, decided_at = COALESCE(decided_at, now()), auto_applied = $4,
              decided_by_admin_id = COALESCE($5, decided_by_admin_id) WHERE id = $1`,
      [a.id, status, JSON.stringify(r), !!by.auto, by.adminId ?? null]
    )
    return r
  }
  if (!ctx || !scenario) return finish('failed', { ok: false, text: 'This request is no longer open.' })
  const snapshot = await scenario.snapshot(ctx).catch(() => null)
  if (!snapshot) return finish('failed', { ok: false, text: 'This was already settled.' })

  const userId = ctx.user_id ?? by.userId
  const run = () => scenario.execute(a.args.intent, a.args.args ?? {}, snapshot, { context: ctx, userId, adminId: by.adminId ?? null })
  let r: ExecResult
  try {
    r = by.adminId ? await run() : userId ? await runWithAuditActor(`customer:${userId}`, run) : await runWithAuditActor('assistant', run)
  } catch (err) {
    r = { ok: false, text: err instanceof Error ? err.message : 'Something went wrong' }
  }
  if (r.ok && (r.close ?? !scenario.intents[a.args.intent]?.manual)) await markAnswered(ctx.id)
  return finish(r.ok ? 'done' : 'failed', r)
}
