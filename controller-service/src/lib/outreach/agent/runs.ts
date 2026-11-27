import { outreachPool, type Queryable } from '../db'
import { recordEvent } from '../events'
import type { AgentChannel, AgentRunRow, AgentRunStatus, AgentTaskKind, AgentTaskRow } from './types'

// outreach_agent_runs / outreach_agent_tasks: one open run per contact (partial unique index), tasks the agent leaves
// itself (a follow-up call, a WhatsApp turn). Plain SQL; every function takes the flagship pool.

const OPEN = `status IN ('active', 'handed_off')`

export async function getOpenRun(contactId: string, db: Queryable = outreachPool()): Promise<AgentRunRow | null> {
  const r = await db.query(`SELECT * FROM outreach_agent_runs WHERE contact_id = $1 AND ${OPEN} ORDER BY started_at DESC LIMIT 1`, [contactId])
  return r.rows[0] ?? null
}

/** A new run, or the contact's existing open one when another process won the race. */
export async function createRun(input: { contactId: string; skillVersionId: string | null; skillRef: string }): Promise<AgentRunRow> {
  const pool = outreachPool()
  await pool.query(
    `INSERT INTO outreach_agent_runs (contact_id, skill_version_id, skill_ref) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
    [input.contactId, input.skillVersionId, input.skillRef]
  )
  const run = await getOpenRun(input.contactId, pool)
  if (!run) throw new Error(`No open agent run for contact ${input.contactId}`)
  return run
}

export async function recordTurn(runId: string, channel: AgentChannel, costPaise: number, now: Date): Promise<void> {
  const cost = Number.isFinite(costPaise) && costPaise > 0 ? Math.round(costPaise) : 0
  await outreachPool().query(
    `UPDATE outreach_agent_runs SET turns = turns + 1, spend_paise = spend_paise + $3, last_channel = $2, last_turn_at = $4, updated_at = $4 WHERE id = $1`,
    [runId, channel, cost, now]
  )
}

export async function setRunStatus(runId: string, status: AgentRunStatus, now: Date): Promise<void> {
  await outreachPool().query(
    `UPDATE outreach_agent_runs SET status = $2::text, updated_at = $3, ended_at = CASE WHEN $2::text IN ('completed', 'stopped') THEN $3::timestamptz ELSE NULL END WHERE id = $1`,
    [runId, status, now]
  )
}

/** The agent stops: the contact is flagged, the open run is handed off, pending tasks are cancelled. Status unchanged. */
export async function handOff(input: { contactId: string; reason: string; channel: AgentChannel; actor: string; now: Date }): Promise<void> {
  const pool = outreachPool()
  await pool.query(`UPDATE outreach_contacts SET handoff_at = $2, handoff_reason = $3, updated_at = now() WHERE id = $1`, [input.contactId, input.now, input.reason])
  await pool.query(`UPDATE outreach_agent_runs SET status = 'handed_off', updated_at = $2 WHERE contact_id = $1 AND status = 'active'`, [input.contactId, input.now])
  await cancelTasks(input.contactId, 'handoff')
  await recordEvent(input.contactId, 'handoff', { actor: input.actor, data: { reason: input.reason, channel: input.channel } })
}

/** An admin resumes the agent. False when nothing was handed off. */
export async function resume(contactId: string, actor: string, now: Date): Promise<boolean> {
  const pool = outreachPool()
  const c = await pool.query(
    `UPDATE outreach_contacts SET handoff_at = NULL, handoff_reason = NULL, updated_at = now() WHERE id = $1 AND handoff_at IS NOT NULL RETURNING id`,
    [contactId]
  )
  const r = await pool.query(`UPDATE outreach_agent_runs SET status = 'active', updated_at = $2 WHERE contact_id = $1 AND status = 'handed_off' RETURNING id`, [contactId, now])
  const did = (c.rows?.length ?? 0) > 0 || (r.rows?.length ?? 0) > 0
  if (did) await recordEvent(contactId, 'agent_resumed', { actor })
  return did
}

export async function scheduleTask(input: {
  runId: string
  contactId: string
  kind: AgentTaskKind
  dueAt: Date
  reason?: string | null
  instruction?: string | null
  createdBy: string
}): Promise<AgentTaskRow> {
  const r = await outreachPool().query(
    `INSERT INTO outreach_agent_tasks (run_id, contact_id, kind, due_at, reason, instruction, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [input.runId, input.contactId, input.kind, input.dueAt, input.reason ?? null, input.instruction ?? null, input.createdBy]
  )
  return r.rows[0]
}

export async function cancelTasks(contactId: string, reason: string, kind?: AgentTaskKind): Promise<number> {
  const params: unknown[] = [contactId, JSON.stringify({ reason })]
  if (kind) params.push(kind)
  const r = await outreachPool().query(
    `UPDATE outreach_agent_tasks SET status = 'cancelled', result = $2::jsonb, done_at = now() WHERE contact_id = $1 AND status = 'pending'${kind ? ' AND kind = $3' : ''}`,
    params
  )
  return r.rowCount ?? 0
}

/** Due pending tasks, claimed for this process (SKIP LOCKED): status running, attempts + 1. */
export async function claimDueTasks(now: Date, limit: number): Promise<AgentTaskRow[]> {
  const r = await outreachPool().query(
    `UPDATE outreach_agent_tasks SET status = 'running', attempts = attempts + 1
      WHERE id IN (SELECT id FROM outreach_agent_tasks WHERE status = 'pending' AND due_at <= $1 ORDER BY due_at LIMIT $2 FOR UPDATE SKIP LOCKED)
      RETURNING *`,
    [now, limit]
  )
  return (r.rows as AgentTaskRow[]).sort((a, b) => new Date(a.due_at).getTime() - new Date(b.due_at).getTime())
}

/** 'pending' with a dueAt reschedules; the other statuses end the task. */
export async function finishTask(id: string, status: 'done' | 'failed' | 'cancelled' | 'pending', result?: Record<string, unknown> | null, dueAt?: Date): Promise<void> {
  const json = result ? JSON.stringify(result) : null
  if (status === 'pending') {
    await outreachPool().query(`UPDATE outreach_agent_tasks SET status = 'pending', due_at = COALESCE($3, due_at), result = $2::jsonb, done_at = NULL WHERE id = $1`, [id, json, dueAt ?? null])
    return
  }
  await outreachPool().query(`UPDATE outreach_agent_tasks SET status = $2, result = $3::jsonb, done_at = now() WHERE id = $1`, [id, status, json])
}

export async function listTasks(contactId: string, limit = 20): Promise<AgentTaskRow[]> {
  const r = await outreachPool().query(`SELECT * FROM outreach_agent_tasks WHERE contact_id = $1 ORDER BY created_at DESC LIMIT $2`, [contactId, Math.min(Math.max(limit, 1), 200)])
  return r.rows
}

export async function pendingTaskCount(contactId: string): Promise<number> {
  const r = await outreachPool().query(`SELECT count(*)::int AS n FROM outreach_agent_tasks WHERE contact_id = $1 AND status = 'pending'`, [contactId])
  return Number(r.rows[0]?.n ?? 0)
}
