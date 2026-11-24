import { randomUUID } from 'crypto'
import { outreachPool, type Queryable } from '../db'
import { ContactNotFoundError } from '../state'
import type { OutreachContact } from '../types'

// The build's own state on the contact (outreach_contacts.extra.build), changed only under the contact's row lock, so
// two pods agree on whether a generation runs: at most one runs per contact, and a brief that changes meanwhile
// queues one follow-up, never more.

export interface BuildState {
  state: 'idle' | 'running' | 'done' | 'failed'
  runId?: string
  startedAt?: string
  finishedAt?: string
  /** A follow-up waits for the running generation. */
  queued?: boolean
  /** Full generations started for this contact. */
  builds: number
  /** briefHash of the brief the latest generation started from. */
  hash?: string
  /** When the first full generation finished: publish needs it. */
  builtAt?: string
  lastMs?: number
  error?: string
  /** The theme the sketch wears (style.palette). */
  theme?: string
  callLanguage?: string
}

/** Full generations per contact (the first plus follow-ups); past it, brief changes only update the details. */
export const MAX_BUILDS = 3
/** A run that has not finished in this long died with its process. */
export const RUN_STALE_MS = 12 * 60_000

const rec = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})

export function readBuild(extra: unknown): BuildState {
  const b = rec(rec(extra).build)
  return { ...(b as Partial<BuildState>), state: (['idle', 'running', 'done', 'failed'] as const).find(s => s === b.state) ?? 'idle', builds: Number(b.builds) || 0 }
}

export const isRunning = (b: BuildState, now = Date.now()) => b.state === 'running' && !!b.startedAt && now - Date.parse(b.startedAt) < RUN_STALE_MS

export type RunPlan = { action: 'start' | 'queue' | 'none'; next: BuildState }

/** What a brief with `hash` does to the build: start a generation, queue one behind the running one, or nothing. */
export function planRun(b: BuildState, hash: string, now = Date.now()): RunPlan {
  const running = isRunning(b, now)
  const none = { action: 'none' as const, next: b }
  // The same brief again: nothing new to design, unless the last try failed (then it is tried again).
  if (b.hash === hash && (running || b.state === 'done' || b.queued)) return none
  if (running) return b.queued || b.builds >= MAX_BUILDS ? none : { action: 'queue', next: { ...b, queued: true } }
  if (b.builds >= MAX_BUILDS) return none
  const at = new Date(now).toISOString()
  return { action: 'start', next: { ...b, state: 'running', runId: randomUUID(), startedAt: at, queued: false, builds: b.builds + 1, hash, error: undefined } }
}

/**
 * A run ended. Null when another run has taken over; else the state to write and whether the same run goes on with a
 * queued follow-up (from `hash`, the brief as it is now).
 */
export function finishRun(b: BuildState, runId: string, r: { ok: boolean; ms: number; error?: string }, hash: string, now = Date.now()): { next: BuildState; again: boolean } | null {
  if (b.runId !== runId) return null
  const at = new Date(now).toISOString()
  const builtAt = r.ok ? (b.builtAt ?? at) : b.builtAt
  const base = { ...b, builtAt, lastMs: r.ms, ...(r.ok ? { error: undefined } : { error: (r.error ?? 'failed').slice(0, 300) }) }
  if (b.queued && b.builds < MAX_BUILDS && hash !== b.hash)
    return { next: { ...base, state: 'running', queued: false, startedAt: at, builds: b.builds + 1, hash }, again: true }
  return { next: { ...base, state: r.ok ? 'done' : 'failed', queued: false, finishedAt: at }, again: false }
}

/** fn with the contact's row locked; its extra writes commit together. */
export async function withContact<T>(contactId: string, fn: (c: OutreachContact, tx: Queryable) => Promise<T>): Promise<T> {
  const client = await outreachPool().connect()
  try {
    await client.query('BEGIN')
    const r = await client.query(`SELECT * FROM outreach_contacts WHERE id = $1 FOR UPDATE`, [contactId])
    if (!r.rows[0]) throw new ContactNotFoundError(contactId)
    const out = await fn(r.rows[0] as OutreachContact, client)
    await client.query('COMMIT')
    return out
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    client.release()
  }
}

/** Replaces the given top-level keys of the contact's extra (brief, build), leaving the rest. */
export async function writeExtra(db: Queryable, contactId: string, patch: Record<string, unknown>, set: { showcaseSiteId?: string } = {}): Promise<void> {
  await db.query(
    `UPDATE outreach_contacts SET extra = COALESCE(extra, '{}'::jsonb) || $2::jsonb, showcase_site_id = COALESCE($3::uuid, showcase_site_id), updated_at = now() WHERE id = $1`,
    [contactId, JSON.stringify(patch), set.showcaseSiteId ?? null]
  )
}
