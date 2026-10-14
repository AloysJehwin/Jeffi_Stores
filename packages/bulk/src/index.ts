import type pg from 'pg'

// Async bulk jobs shared by document-service and messaging-service. Each service runs a worker that
// claims pending items with FOR UPDATE SKIP LOCKED (safe across replicas) and hands them to a handler.

export type BulkKind = 'documents' | 'messages'

export interface BulkJobRow {
  id: string; tenant_id: string; api_key_id: string | null; kind: BulkKind; status: string
  total: number; succeeded: number; failed: number; skipped: number; spent_inr: string
  options: any; reference: string | null; error: string | null
  created_at: string; started_at: string | null; finished_at: string | null
}
export interface BulkItemRow {
  id: string; job_id: string; tenant_id: string; seq: number; status: string; input: any
  result_id: string | null; result: any; error: string | null; attempts: number
}
export interface ItemOutcome { resultId?: string; result?: unknown; spentInr?: number; usage?: 'messages' | 'documents' }

/** Throw from a handler. `stop` ends the job (e.g. wallet empty); `retry` re-queues once. */
export class BulkItemError extends Error {
  constructor(message: string, readonly opts: { stop?: boolean; retry?: boolean } = {}) { super(message) }
}

const MAX_ATTEMPTS = 2

export async function createJob(db: pg.Pool, j: { kind: BulkKind; tenantId: string; apiKeyId?: string | null; options?: unknown; reference?: string | null; inputs: unknown[] }) {
  const c = await db.connect()
  try {
    await c.query('BEGIN')
    const job = (await c.query<BulkJobRow>(
      `INSERT INTO bulk_jobs (tenant_id, api_key_id, kind, total, options, reference) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [j.tenantId, j.apiKeyId ?? null, j.kind, j.inputs.length, JSON.stringify(j.options ?? {}), j.reference ?? null]
    )).rows[0]
    await c.query(
      `INSERT INTO bulk_job_items (job_id, tenant_id, seq, input)
       SELECT $1, $2, t.ord, t.x FROM jsonb_array_elements($3::jsonb) WITH ORDINALITY AS t(x, ord)`,
      [job.id, j.tenantId, JSON.stringify(j.inputs)]
    )
    await c.query('COMMIT')
    return job
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    c.release()
  }
}

export const jobToApi = (j: BulkJobRow) => ({
  id: j.id, kind: j.kind, status: j.status, total: j.total, succeeded: j.succeeded, failed: j.failed, skipped: j.skipped,
  pending: Math.max(0, j.total - j.succeeded - j.failed - j.skipped), spent_inr: Number(j.spent_inr),
  reference: j.reference, error: j.error, created_at: iso(j.created_at), started_at: iso(j.started_at), finished_at: iso(j.finished_at),
})
const iso = (d: string | null) => (d ? new Date(d).toISOString() : null)

export async function getJob(db: pg.Pool, tenantId: string, kind: BulkKind, id: string) {
  if (!UUID.test(id)) return null
  return (await db.query<BulkJobRow>(`SELECT * FROM bulk_jobs WHERE id=$1 AND tenant_id=$2 AND kind=$3`, [id, tenantId, kind])).rows[0] ?? null
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function listJobs(db: pg.Pool, tenantId: string, kind: BulkKind, q: { limit?: number; cursor?: string }) {
  const limit = Math.min(Math.max(Number(q.limit) || 20, 1), 100)
  const r = await db.query<BulkJobRow>(
    `SELECT * FROM bulk_jobs WHERE tenant_id=$1 AND kind=$2 AND ($3::timestamptz IS NULL OR created_at < $3) ORDER BY created_at DESC LIMIT $4`,
    [tenantId, kind, q.cursor || null, limit]
  )
  const items = r.rows.map(jobToApi)
  return { items, next_cursor: items.length === limit ? items[items.length - 1].created_at : null }
}

export async function listItems(db: pg.Pool, jobId: string, q: { status?: string; cursor?: string; limit?: number }) {
  const limit = Math.min(Math.max(Number(q.limit) || 50, 1), 500)
  const r = await db.query<BulkItemRow>(
    `SELECT * FROM bulk_job_items WHERE job_id=$1 AND ($2::text IS NULL OR status=$2) AND seq > $3 ORDER BY seq LIMIT $4`,
    [jobId, q.status || null, Number(q.cursor) || 0, limit]
  )
  return { rows: r.rows, next_cursor: r.rows.length === limit ? String(r.rows[r.rows.length - 1].seq) : null }
}

export async function cancelJob(db: pg.Pool, job: BulkJobRow) {
  if (!['queued', 'running'].includes(job.status)) return job
  await db.query(`UPDATE bulk_job_items SET status='skipped', error='cancelled', updated_at=now() WHERE job_id=$1 AND status='pending'`, [job.id])
  await recount(db, job.id, `status='cancelled', finished_at=now()`)
  return (await db.query<BulkJobRow>(`SELECT * FROM bulk_jobs WHERE id=$1`, [job.id])).rows[0]
}

/** Re-queue failed + skipped items (e.g. after a wallet top-up). */
export async function retryJob(db: pg.Pool, job: BulkJobRow) {
  if (!['partial', 'failed', 'cancelled'].includes(job.status)) return job
  await db.query(
    `UPDATE bulk_job_items SET status='pending', error=NULL, attempts=0, locked_at=NULL, updated_at=now() WHERE job_id=$1 AND status IN ('failed','skipped')`,
    [job.id]
  )
  await recount(db, job.id, `status='queued', error=NULL, finished_at=NULL`)
  return (await db.query<BulkJobRow>(`SELECT * FROM bulk_jobs WHERE id=$1`, [job.id])).rows[0]
}

async function recount(db: pg.Pool | pg.PoolClient, jobId: string, set: string, params: unknown[] = []) {
  await db.query(
    `UPDATE bulk_jobs j SET ${set},
       succeeded = (SELECT count(*) FROM bulk_job_items WHERE job_id=j.id AND status='done'),
       failed    = (SELECT count(*) FROM bulk_job_items WHERE job_id=j.id AND status='failed'),
       skipped   = (SELECT count(*) FROM bulk_job_items WHERE job_id=j.id AND status='skipped')
     WHERE j.id=$1`, [jobId, ...params])
}

async function finalize(db: pg.Pool, jobId: string) {
  await db.query(
    `UPDATE bulk_jobs SET finished_at=now(),
       status = CASE WHEN failed + skipped = 0 THEN 'completed' WHEN succeeded = 0 THEN 'failed' ELSE 'partial' END
     WHERE id=$1 AND status IN ('queued','running')
       AND NOT EXISTS (SELECT 1 FROM bulk_job_items WHERE job_id=$1 AND status IN ('pending','running'))`, [jobId])
}

async function bumpUsage(db: pg.Pool, apiKeyId: string, usage: 'messages' | 'documents', spentInr: number) {
  await db.query(
    `INSERT INTO api_key_usage_daily (api_key_id, day, ${usage}, spend_paise) VALUES ($1, current_date, 1, $2)
     ON CONFLICT (api_key_id, day) DO UPDATE SET ${usage} = api_key_usage_daily.${usage} + 1, spend_paise = api_key_usage_daily.spend_paise + $2`,
    [apiKeyId, Math.round(spentInr * 100)]
  ).catch(() => {})
}

export function startWorker(
  db: pg.Pool, kind: BulkKind,
  handle: (item: BulkItemRow, job: BulkJobRow) => Promise<ItemOutcome>,
  // sequential: one item at a time per job (jobs still run in parallel) — keeps document numbers in item order.
  // where: limits which tenants' jobs this worker claims (a tenant's own service pod vs the platform's).
  opts: { concurrency?: number; sequential?: boolean; intervalMs?: number; log?: (msg: string, err?: unknown) => void; where?: (col: string, p: number) => { sql: string; params: unknown[] } } = {}
) {
  const concurrency = Math.max(1, opts.concurrency ?? 2)
  let active = 0, stopped = false, ticking = false

  async function run(item: BulkItemRow) {
    try {
      const job = (await db.query<BulkJobRow>(`SELECT * FROM bulk_jobs WHERE id=$1`, [item.job_id])).rows[0]
      if (!job || job.status === 'cancelled') {
        await db.query(`UPDATE bulk_job_items SET status='skipped', error='cancelled', updated_at=now() WHERE id=$1`, [item.id])
        return
      }
      try {
        const out = await handle(item, job)
        const spent = out.spentInr ?? 0
        await db.query(`UPDATE bulk_job_items SET status='done', result_id=$2, result=$3, error=NULL, updated_at=now() WHERE id=$1`,
          [item.id, out.resultId ?? null, out.result === undefined ? null : JSON.stringify(out.result)])
        await db.query(`UPDATE bulk_jobs SET succeeded=succeeded+1, spent_inr=spent_inr+$2 WHERE id=$1`, [job.id, spent])
        if (job.api_key_id && out.usage) await bumpUsage(db, job.api_key_id, out.usage, spent)
      } catch (e: any) {
        const err = e instanceof BulkItemError ? e : new BulkItemError(e?.message || 'error', { retry: true })
        if (err.opts.stop) {
          await db.query(`UPDATE bulk_job_items SET status='skipped', error=$2, updated_at=now() WHERE job_id=$1 AND (id=$3 OR status='pending')`, [job.id, err.message, item.id])
          await recount(db, job.id, 'error=$2', [err.message])
        } else if (err.opts.retry && item.attempts < MAX_ATTEMPTS) {
          await db.query(`UPDATE bulk_job_items SET status='pending', error=$2, locked_at=NULL, updated_at=now() WHERE id=$1`, [item.id, err.message])
          return
        } else {
          await db.query(`UPDATE bulk_job_items SET status='failed', error=$2, updated_at=now() WHERE id=$1`, [item.id, err.message.slice(0, 500)])
          await db.query(`UPDATE bulk_jobs SET failed=failed+1 WHERE id=$1`, [job.id])
        }
      }
      await finalize(db, job.id)
    } catch (e) {
      opts.log?.('bulk item crashed', e)
    } finally {
      active--
    }
  }

  async function tick() {
    if (stopped || ticking || active >= concurrency) return
    ticking = true
    try {
      const claimable = `(x.status='pending' OR (x.status='running' AND x.locked_at < now() - interval '5 minutes'))`
      const w = opts.where?.('j.tenant_id', 3) ?? { sql: 'true', params: [] }
      const pick = opts.sequential
        ? `SELECT x.id FROM bulk_jobs j CROSS JOIN LATERAL (
             SELECT x.id FROM bulk_job_items x WHERE x.job_id = j.id AND ${claimable} ORDER BY x.seq LIMIT 1 FOR UPDATE SKIP LOCKED) x
            WHERE j.kind=$1 AND j.status IN ('queued','running') AND ${w.sql}
              AND NOT EXISTS (SELECT 1 FROM bulk_job_items r WHERE r.job_id = j.id AND r.status='running' AND r.locked_at >= now() - interval '5 minutes')
            ORDER BY j.created_at LIMIT $2`
        // Ordered by seq first, so concurrent jobs interleave instead of one big job starving the rest.
        : `SELECT x.id FROM bulk_job_items x JOIN bulk_jobs j ON j.id = x.job_id
            WHERE j.kind=$1 AND j.status IN ('queued','running') AND ${claimable} AND ${w.sql}
            ORDER BY x.seq, j.created_at LIMIT $2 FOR UPDATE OF x SKIP LOCKED`
      const r = await db.query<BulkItemRow>(
        `UPDATE bulk_job_items i SET status='running', locked_at=now(), attempts=i.attempts+1, updated_at=now()
          WHERE i.id IN (${pick}) RETURNING i.*`, [kind, concurrency - active, ...w.params])
      if (!r.rows.length) return
      await db.query(`UPDATE bulk_jobs SET status='running', started_at=COALESCE(started_at, now()) WHERE id = ANY($1) AND status='queued'`,
        [[...new Set(r.rows.map(i => i.job_id))]])
      active += r.rows.length
      for (const item of r.rows) void run(item)
    } catch (e) {
      opts.log?.('bulk claim failed', e)
    } finally {
      ticking = false
    }
  }

  const timer = setInterval(tick, opts.intervalMs ?? 500)
  timer.unref?.()
  return () => { stopped = true; clearInterval(timer) }
}
