import { queryMany, queryOne } from '@/lib/shared/db'
import { errorText } from './sync-run'
import type { ChangeActor, Channel } from './types'

// Every change made from a channel console goes through runChange: validate (nothing sent when it
// fails), then either return the preview (what would change) or apply it, logging the attempt in
// channel_change_log with the before and after state.

export interface ChangeSpec<T> {
  channel: Channel
  action: string
  entityType: string
  entityId?: string | null
  summary: string
  before?: unknown
  after?: unknown
  /** Problems that stop the change (shown to the admin). Throwing counts as a problem too. */
  validate?: () => Promise<string[]> | string[]
  apply: () => Promise<T>
}

export interface ChangeOutcome<T> {
  ok: boolean
  preview: boolean
  summary: string
  before?: unknown
  after?: unknown
  problems: string[]
  result?: T
  logId?: string | null
}

export class ChangeRejectedError extends Error {
  constructor(public readonly problems: string[]) {
    super(problems.join('; ') || 'The change was rejected')
    this.name = 'ChangeRejectedError'
  }
}

async function log(spec: ChangeSpec<unknown>, actor: ChangeActor, status: 'applied' | 'rejected' | 'failed', error: string | null): Promise<string | null> {
  const row = await queryOne<{ id: string }>(
    `INSERT INTO channel_change_log (channel, admin_id, admin_email, action, entity_type, entity_id, summary, before, after, status, error)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10, $11) RETURNING id::text`,
    [
      spec.channel,
      actor.adminId,
      actor.email,
      spec.action,
      spec.entityType,
      spec.entityId ?? null,
      spec.summary.slice(0, 500),
      spec.before === undefined ? null : JSON.stringify(spec.before),
      spec.after === undefined ? null : JSON.stringify(spec.after),
      status,
      error,
    ]
  ).catch(e => {
    console.error(`[${spec.channel}] change log write failed`, e)
    return null
  })
  return row?.id ?? null
}

export async function runChange<T>(spec: ChangeSpec<T>, actor: ChangeActor, preview: boolean): Promise<ChangeOutcome<T>> {
  let problems: string[] = []
  try {
    problems = (await spec.validate?.()) ?? []
  } catch (e) {
    problems = [errorText(e)]
  }
  const base = { preview, summary: spec.summary, before: spec.before, after: spec.after, problems }
  if (problems.length) {
    if (!preview) await log(spec, actor, 'rejected', problems.join('; '))
    return { ...base, ok: false }
  }
  if (preview) return { ...base, ok: true }
  try {
    const result = await spec.apply()
    const logId = await log(spec, actor, 'applied', null)
    return { ...base, ok: true, result, logId }
  } catch (e) {
    const msg = errorText(e)
    await log(spec, actor, 'failed', msg)
    return { ...base, ok: false, problems: [msg] }
  }
}

export interface ChangeRow {
  id: string
  created_at: string
  admin_email: string | null
  action: string
  entity_type: string
  entity_id: string | null
  summary: string
  before: unknown
  after: unknown
  status: string
  error: string | null
}

export async function listChanges(channel: Channel, limit = 100): Promise<ChangeRow[]> {
  return queryMany<ChangeRow>(
    `SELECT id::text, created_at, admin_email, action, entity_type, entity_id, summary, before, after, status, error
     FROM channel_change_log WHERE channel = $1 ORDER BY created_at DESC LIMIT $2`,
    [channel, limit]
  ).catch(() => [])
}

/** A shallow diff of two flat objects: the keys whose values differ. */
export function diffKeys(before: Record<string, unknown> | null | undefined, after: Record<string, unknown> | null | undefined): string[] {
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])
  return [...keys].filter(k => JSON.stringify((before ?? {})[k]) !== JSON.stringify((after ?? {})[k])).sort()
}
