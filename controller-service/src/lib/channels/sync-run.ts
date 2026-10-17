import type { PoolClient } from 'pg'
import { getClient, queryMany, queryOne } from '@/lib/shared/db'
import { CHANNEL_LOCKS, type Channel, type ChannelLock } from './types'

// One job run per lock: a session advisory lock on one dedicated connection (so cron and a manual
// "Run now" never overlap), with a channel_sync_log row written at start and finish.

export class ChannelJobBusyError extends Error {
  constructor(public readonly job: ChannelLock) {
    super('This job is already running. Try again when it finishes.')
    this.name = 'ChannelJobBusyError'
  }
}

export interface RunContext {
  db: PoolClient
  counts: Record<string, number>
  errors: { step: string; message: string }[]
  /** Runs one step; a throw is recorded and the run carries on. */
  step: (name: string, fn: () => Promise<number | void>) => Promise<void>
}

export interface RunResult {
  id: string | null
  status: 'success' | 'partial' | 'error'
  counts: Record<string, number>
  errors: { step: string; message: string }[]
}

export const errorText = (e: unknown) => String((e as any)?.message ?? e).slice(0, 500)

export async function withChannelLock(channel: Channel, job: ChannelLock, kind: string, fn: (ctx: RunContext) => Promise<void>): Promise<RunResult> {
  const key = CHANNEL_LOCKS[job]
  const db = await getClient()
  let locked = false
  let unlockFailed = false
  try {
    const lock = await db.query<{ acquired: boolean }>('SELECT pg_try_advisory_lock($1) AS acquired', [key])
    locked = !!lock.rows[0]?.acquired
    if (!locked) throw new ChannelJobBusyError(job)
    const log = await db.query<{ id: string }>(
      `INSERT INTO channel_sync_log (channel, kind, status) VALUES ($1, $2, 'running') RETURNING id::text`,
      [channel, kind]
    )
    const id = log.rows[0]?.id ?? null
    const counts: Record<string, number> = {}
    const errors: RunResult['errors'] = []
    let steps = 0
    const ctx: RunContext = {
      db,
      counts,
      errors,
      step: async (name, run) => {
        steps++
        try {
          const n = await run()
          if (typeof n === 'number') counts[name] = (counts[name] ?? 0) + n
        } catch (e) {
          errors.push({ step: name, message: errorText(e) })
        }
      },
    }
    try {
      await fn(ctx)
    } catch (e) {
      errors.push({ step: 'run', message: errorText(e) })
      steps++
    }
    const status: RunResult['status'] = errors.length === 0 ? 'success' : errors.length >= Math.max(steps, 1) ? 'error' : 'partial'
    await db.query(
      `UPDATE channel_sync_log SET status = $2, counts = $3::jsonb, errors = $4::jsonb, finished_at = now() WHERE id = $1::bigint`,
      [id, status, JSON.stringify(counts), JSON.stringify(errors)]
    )
    return { id, status, counts, errors }
  } finally {
    if (locked) {
      await db.query('SELECT pg_advisory_unlock($1)', [key]).catch(() => {
        unlockFailed = true
      })
    }
    db.release(unlockFailed || undefined)
  }
}

export async function isJobRunning(job: ChannelLock): Promise<boolean> {
  const row = await queryOne<{ running: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM pg_locks
       WHERE locktype = 'advisory' AND granted AND database = (SELECT oid FROM pg_database WHERE datname = current_database())
         AND classid = 0 AND objid = $1 AND objsubid = 1
     ) AS running`,
    [CHANNEL_LOCKS[job]]
  ).catch(() => null)
  return !!row?.running
}

export interface SyncLogRow {
  id: string
  kind: string
  status: string
  counts: Record<string, number>
  errors: { step: string; message: string }[]
  started_at: string
  finished_at: string | null
}

export async function listRuns(channel: Channel, limit = 50): Promise<SyncLogRow[]> {
  return queryMany<SyncLogRow>(
    `SELECT id::text, kind, status, counts, errors, started_at, finished_at FROM channel_sync_log
     WHERE channel = $1 ORDER BY started_at DESC LIMIT $2`,
    [channel, limit]
  ).catch(() => [])
}

/** Last finished run of each kind, for "last refreshed" labels. */
export async function lastRuns(channel: Channel): Promise<Record<string, SyncLogRow>> {
  const rows = await queryMany<SyncLogRow>(
    `SELECT DISTINCT ON (kind) id::text, kind, status, counts, errors, started_at, finished_at FROM channel_sync_log
     WHERE channel = $1 AND finished_at IS NOT NULL ORDER BY kind, started_at DESC`,
    [channel]
  ).catch(() => [])
  return Object.fromEntries(rows.map(r => [r.kind, r]))
}
