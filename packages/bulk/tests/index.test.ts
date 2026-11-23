import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  BulkItemError,
  createJob,
  jobToApi,
  getJob,
  listJobs,
  listItems,
  cancelJob,
  retryJob,
  startWorker,
  type BulkJobRow,
  type BulkItemRow,
  type ItemOutcome,
} from '../src/index'

// A fake pg that records queries and answers by matching the SQL against a rule list.
// Each rule: [regex, rowsOrFn]. First match wins; default [] rows.
type Rule = [RegExp, any[] | ((params: any[]) => any[])]
function fakePool(rules: Rule[] = []) {
  const calls: { sql: string; params: any[] }[] = []
  const answer = (sql: string, params: any[]) => {
    for (const [re, rows] of rules) {
      if (re.test(sql)) return typeof rows === 'function' ? rows(params) : rows
    }
    return []
  }
  const query = vi.fn(async (sql: string, params: any[] = []) => {
    calls.push({ sql, params })
    return { rows: answer(sql, params) }
  })
  return { query, calls } as any
}

function job(over: Partial<BulkJobRow> = {}): BulkJobRow {
  return {
    id: 'jid', tenant_id: 't1', api_key_id: null, kind: 'messages', status: 'queued',
    total: 0, succeeded: 0, failed: 0, skipped: 0, spent_inr: '0',
    options: {}, reference: null, error: null,
    created_at: '2026-01-01T00:00:00.000Z', started_at: null, finished_at: null, ...over,
  }
}
function item(over: Partial<BulkItemRow> = {}): BulkItemRow {
  return { id: 'i1', job_id: 'jid', tenant_id: 't1', seq: 1, status: 'pending', input: {}, result_id: null, result: null, error: null, attempts: 0, ...over }
}

const UUID_A = '11111111-2222-3333-4444-555555555555'

describe('BulkItemError', () => {
  it('carries message and defaults opts to empty', () => {
    const e = new BulkItemError('boom')
    expect(e).toBeInstanceOf(Error)
    expect(e.message).toBe('boom')
    expect(e.opts).toEqual({})
  })
  it('keeps stop/retry opts', () => {
    expect(new BulkItemError('x', { stop: true }).opts.stop).toBe(true)
    expect(new BulkItemError('y', { retry: true }).opts.retry).toBe(true)
  })
})

describe('createJob', () => {
  function connPool(rules: Rule[] = []) {
    const client = fakePool(rules)
    client.release = vi.fn()
    const db: any = { connect: vi.fn(async () => client) }
    return { db, client }
  }

  it('runs BEGIN, inserts job + items, COMMITs and returns the row', async () => {
    const created = job({ id: 'new', total: 2 })
    const { db, client } = connPool([[/INSERT INTO bulk_jobs/, [created]]])
    const out = await createJob(db, { kind: 'messages', tenantId: 't1', inputs: [{ a: 1 }, { b: 2 }] })
    expect(out).toBe(created)
    const sqls = client.calls.map((c: any) => c.sql)
    expect(sqls[0]).toBe('BEGIN')
    expect(sqls.some((s: string) => /INSERT INTO bulk_jobs/.test(s))).toBe(true)
    expect(sqls.some((s: string) => /INSERT INTO bulk_job_items/.test(s))).toBe(true)
    expect(sqls[sqls.length - 1]).toBe('COMMIT')
    // total passed = inputs.length
    const jobInsert = client.calls.find((c: any) => /INSERT INTO bulk_jobs/.test(c.sql))!
    expect(jobInsert.params[3]).toBe(2)
    expect(client.release).toHaveBeenCalledOnce()
  })

  it('defaults apiKeyId, options and reference to null/{} ', async () => {
    const { db, client } = connPool([[/INSERT INTO bulk_jobs/, [job()]]])
    await createJob(db, { kind: 'documents', tenantId: 't9', inputs: [] })
    const ins = client.calls.find((c: any) => /INSERT INTO bulk_jobs/.test(c.sql))!
    expect(ins.params[1]).toBeNull()               // api_key_id
    expect(ins.params[4]).toBe(JSON.stringify({}))  // options default {}
    expect(ins.params[5]).toBeNull()               // reference
    expect(ins.params[3]).toBe(0)                  // total 0 for empty inputs
  })

  it('passes explicit apiKeyId/options/reference through', async () => {
    const { db, client } = connPool([[/INSERT INTO bulk_jobs/, [job()]]])
    await createJob(db, { kind: 'messages', tenantId: 't1', apiKeyId: 'ak', options: { x: 1 }, reference: 'ref', inputs: [1] })
    const ins = client.calls.find((c: any) => /INSERT INTO bulk_jobs/.test(c.sql))!
    expect(ins.params[1]).toBe('ak')
    expect(ins.params[4]).toBe(JSON.stringify({ x: 1 }))
    expect(ins.params[5]).toBe('ref')
  })

  it('ROLLBACKs and rethrows on failure, still releasing', async () => {
    const client = fakePool()
    client.release = vi.fn()
    client.query = vi.fn(async (sql: string) => {
      client.calls.push({ sql, params: [] })
      if (/INSERT INTO bulk_jobs/.test(sql)) throw new Error('db down')
      return { rows: [] }
    })
    const db: any = { connect: vi.fn(async () => client) }
    await expect(createJob(db, { kind: 'messages', tenantId: 't1', inputs: [1] })).rejects.toThrow('db down')
    expect(client.calls.map((c: any) => c.sql)).toContain('ROLLBACK')
    expect(client.release).toHaveBeenCalledOnce()
  })
})

describe('jobToApi', () => {
  it('maps fields, computes pending and coerces spent_inr', () => {
    const api = jobToApi(job({ id: 'j', total: 10, succeeded: 3, failed: 1, skipped: 1, spent_inr: '42.5', reference: 'r', error: 'e' }))
    expect(api.pending).toBe(5)
    expect(api.spent_inr).toBe(42.5)
    expect(api.reference).toBe('r')
    expect(api.error).toBe('e')
    expect(api.created_at).toBe('2026-01-01T00:00:00.000Z')
  })
  it('clamps pending at 0 when counts exceed total', () => {
    expect(jobToApi(job({ total: 1, succeeded: 2, failed: 1 })).pending).toBe(0)
  })
  it('isoes null start/finish to null', () => {
    const api = jobToApi(job({ started_at: null, finished_at: null }))
    expect(api.started_at).toBeNull()
    expect(api.finished_at).toBeNull()
  })
  it('isoes present dates', () => {
    const api = jobToApi(job({ started_at: '2026-02-02T03:04:05Z', finished_at: '2026-02-02T03:05:05Z' }))
    expect(api.started_at).toBe('2026-02-02T03:04:05.000Z')
    expect(api.finished_at).toBe('2026-02-02T03:05:05.000Z')
  })
})

describe('getJob', () => {
  it('returns null without a DB call for a non-UUID id', async () => {
    const db = fakePool()
    expect(await getJob(db, 't1', 'messages', 'not-a-uuid')).toBeNull()
    expect(db.calls).toHaveLength(0)
  })
  it('queries and returns the row for a valid UUID', async () => {
    const row = job({ id: UUID_A })
    const db = fakePool([[/SELECT \* FROM bulk_jobs WHERE id=/, [row]]])
    const out = await getJob(db, 't1', 'messages', UUID_A)
    expect(out).toBe(row)
    expect(db.calls[0].params).toEqual([UUID_A, 't1', 'messages'])
  })
  it('returns null when the query yields no rows', async () => {
    const db = fakePool([[/SELECT/, []]])
    expect(await getJob(db, 't1', 'messages', UUID_A)).toBeNull()
  })
})

describe('listJobs', () => {
  it('clamps limit to [1,100] and maps rows; no next_cursor when under limit', async () => {
    const db = fakePool([[/SELECT \* FROM bulk_jobs/, [job({ id: 'a' })]]])
    const r = await listJobs(db, 't1', 'messages', { limit: 500 })
    expect(db.calls[0].params[3]).toBe(100)       // clamped high
    expect(r.items).toHaveLength(1)
    expect(r.next_cursor).toBeNull()
  })
  it('defaults limit to 20 for missing/zero and forwards null cursor', async () => {
    const db = fakePool([[/SELECT/, []]])
    await listJobs(db, 't1', 'messages', {})
    expect(db.calls[0].params[3]).toBe(20)
    expect(db.calls[0].params[2]).toBeNull()
  })
  it('clamps a sub-1 limit up to 1', async () => {
    const db = fakePool([[/SELECT/, []]])
    await listJobs(db, 't1', 'messages', { limit: -4 })
    expect(db.calls[0].params[3]).toBe(1)
  })
  it('returns next_cursor = last created_at when page is full', async () => {
    const rows = [job({ id: 'a', created_at: '2026-01-02T00:00:00Z' }), job({ id: 'b', created_at: '2026-01-01T00:00:00Z' })]
    const db = fakePool([[/SELECT/, rows]])
    const r = await listJobs(db, 't1', 'messages', { limit: 2, cursor: '2026-03-01T00:00:00Z' })
    expect(r.next_cursor).toBe('2026-01-01T00:00:00.000Z')
    expect(db.calls[0].params[2]).toBe('2026-03-01T00:00:00Z')
  })
})

describe('listItems', () => {
  it('clamps limit to [1,500], defaults status/cursor to null/0', async () => {
    const db = fakePool([[/SELECT \* FROM bulk_job_items/, []]])
    await listItems(db, 'jid', { limit: 9999 })
    expect(db.calls[0].params).toEqual(['jid', null, 0, 500])
  })
  it('defaults limit to 50 and forwards status + numeric cursor', async () => {
    const db = fakePool([[/SELECT/, []]])
    await listItems(db, 'jid', { status: 'done', cursor: '7' })
    expect(db.calls[0].params).toEqual(['jid', 'done', 7, 50])
  })
  it('returns next_cursor from last seq when page full', async () => {
    const rows = [item({ seq: 1 }), item({ seq: 2 })]
    const db = fakePool([[/SELECT/, rows]])
    const r = await listItems(db, 'jid', { limit: 2 })
    expect(r.next_cursor).toBe('2')
    expect(r.rows).toBe(rows)
  })
  it('null next_cursor when under limit', async () => {
    const db = fakePool([[/SELECT/, [item()]]])
    const r = await listItems(db, 'jid', { limit: 5 })
    expect(r.next_cursor).toBeNull()
  })
  it('clamps a sub-1 limit up to 1', async () => {
    const db = fakePool([[/SELECT/, []]])
    await listItems(db, 'jid', { limit: 0 }) // 0 is falsy -> default 50, so use negative
    await listItems(db, 'jid', { limit: -2 })
    expect(db.calls[1].params[3]).toBe(1)
  })
})

describe('cancelJob', () => {
  it('returns the job unchanged when status is not queued/running', async () => {
    const db = fakePool()
    const j = job({ status: 'completed' })
    expect(await cancelJob(db, j)).toBe(j)
    expect(db.calls).toHaveLength(0)
  })
  it('skips pending items, recounts to cancelled and re-reads', async () => {
    const reread = job({ id: 'jid', status: 'cancelled' })
    const db = fakePool([[/SELECT \* FROM bulk_jobs WHERE id=/, [reread]]])
    const out = await cancelJob(db, job({ status: 'running' }))
    expect(out).toBe(reread)
    const sqls = db.calls.map((c: any) => c.sql)
    expect(sqls.some((s: string) => /UPDATE bulk_job_items SET status='skipped'/.test(s))).toBe(true)
    expect(sqls.some((s: string) => /status='cancelled', finished_at=now\(\)/.test(s))).toBe(true)
  })
})

describe('retryJob', () => {
  it('returns unchanged when status is not partial/failed/cancelled', async () => {
    const db = fakePool()
    const j = job({ status: 'running' })
    expect(await retryJob(db, j)).toBe(j)
    expect(db.calls).toHaveLength(0)
  })
  it('re-queues failed+skipped items and recounts to queued', async () => {
    const reread = job({ id: 'jid', status: 'queued' })
    const db = fakePool([[/SELECT \* FROM bulk_jobs WHERE id=/, [reread]]])
    const out = await retryJob(db, job({ status: 'partial' }))
    expect(out).toBe(reread)
    const sqls = db.calls.map((c: any) => c.sql)
    expect(sqls.some((s: string) => /SET status='pending', error=NULL, attempts=0/.test(s))).toBe(true)
    expect(sqls.some((s: string) => /status='queued', error=NULL, finished_at=NULL/.test(s))).toBe(true)
  })
})

// ---- startWorker: drive tick() via fake timers and flush microtasks for run() ----
async function flush() {
  // let all pending promise jobs settle
  for (let i = 0; i < 20; i++) await Promise.resolve()
}

describe('startWorker', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  function worker(db: any, handle: any, opts: any = {}) {
    const stop = startWorker(db, 'messages', handle, opts)
    return stop
  }

  it('claims nothing: returns early, no job status update', async () => {
    const db = fakePool([[/UPDATE bulk_job_items i SET status='running'/, []]])
    const stop = worker(db, async () => ({}))
    await vi.advanceTimersByTimeAsync(600)
    await flush()
    stop()
    // only the claim query, no "SET status='running'" on bulk_jobs
    expect(db.calls.some((c: any) => /UPDATE bulk_jobs SET status='running'/.test(c.sql))).toBe(false)
  })

  it('processes a successful item: marks done, bumps succeeded, finalizes', async () => {
    const claimed = item({ id: 'i1', job_id: 'jid', attempts: 1 })
    const db = fakePool([
      [/UPDATE bulk_job_items i SET status='running'/, [claimed]],
      [/UPDATE bulk_jobs SET status='running'/, []],
      [/SELECT \* FROM bulk_jobs WHERE id=/, [job({ id: 'jid', status: 'running' })]],
    ])
    const handle = vi.fn(async () => ({ resultId: 'r1', result: { ok: 1 }, spentInr: 2 } as ItemOutcome))
    const stop = worker(db, handle, { concurrency: 1 })
    await vi.advanceTimersByTimeAsync(600)
    await flush()
    stop()
    expect(handle).toHaveBeenCalledOnce()
    const sqls = db.calls.map((c: any) => c.sql)
    expect(sqls.some((s: string) => /SET status='done'/.test(s))).toBe(true)
    expect(sqls.some((s: string) => /SET succeeded=succeeded\+1/.test(s))).toBe(true)
    expect(sqls.some((s: string) => /UPDATE bulk_jobs SET finished_at=now\(\)/.test(s))).toBe(true)
    // result serialized, spent forwarded
    const doneCall = db.calls.find((c: any) => /SET status='done'/.test(c.sql))!
    expect(doneCall.params[2]).toBe(JSON.stringify({ ok: 1 }))
    const succCall = db.calls.find((c: any) => /succeeded=succeeded\+1/.test(c.sql))!
    expect(succCall.params[1]).toBe(2)
  })

  it('serializes result=null when outcome.result is undefined and defaults spent to 0', async () => {
    const claimed = item({ id: 'i1' })
    const db = fakePool([
      [/UPDATE bulk_job_items i SET status='running'/, [claimed]],
      [/SELECT \* FROM bulk_jobs WHERE id=/, [job({ id: 'jid', status: 'running' })]],
    ])
    const stop = worker(db, async () => ({}), { concurrency: 1 })
    await vi.advanceTimersByTimeAsync(600)
    await flush()
    stop()
    const doneCall = db.calls.find((c: any) => /SET status='done'/.test(c.sql))!
    expect(doneCall.params[1]).toBeNull()  // result_id null
    expect(doneCall.params[2]).toBeNull()  // result null
    const succCall = db.calls.find((c: any) => /succeeded=succeeded\+1/.test(c.sql))!
    expect(succCall.params[1]).toBe(0)
  })

  it('bumps api_key_usage_daily when job has api_key_id and usage', async () => {
    const claimed = item({ id: 'i1' })
    const db = fakePool([
      [/UPDATE bulk_job_items i SET status='running'/, [claimed]],
      [/SELECT \* FROM bulk_jobs WHERE id=/, [job({ id: 'jid', status: 'running', api_key_id: 'ak' })]],
    ])
    const stop = worker(db, async () => ({ usage: 'messages', spentInr: 1.5 } as ItemOutcome), { concurrency: 1 })
    await vi.advanceTimersByTimeAsync(600)
    await flush()
    stop()
    const bump = db.calls.find((c: any) => /api_key_usage_daily/.test(c.sql))
    expect(bump).toBeTruthy()
    expect(bump!.params[0]).toBe('ak')
    expect(bump!.params[1]).toBe(Math.round(1.5 * 100)) // 150 paise
  })

  it('skips a cancelled job: marks item skipped, no handler call', async () => {
    const claimed = item({ id: 'i1' })
    const handle = vi.fn(async () => ({}))
    const db = fakePool([
      [/UPDATE bulk_job_items i SET status='running'/, [claimed]],
      [/SELECT \* FROM bulk_jobs WHERE id=/, [job({ id: 'jid', status: 'cancelled' })]],
    ])
    const stop = worker(db, handle, { concurrency: 1 })
    await vi.advanceTimersByTimeAsync(600)
    await flush()
    stop()
    expect(handle).not.toHaveBeenCalled()
    expect(db.calls.some((c: any) => /UPDATE bulk_job_items SET status='skipped', error='cancelled', updated_at=now\(\) WHERE id=/.test(c.sql))).toBe(true)
  })

  it('skips when the job no longer exists', async () => {
    const claimed = item({ id: 'i1' })
    const handle = vi.fn(async () => ({}))
    const db = fakePool([
      [/UPDATE bulk_job_items i SET status='running'/, [claimed]],
      [/SELECT \* FROM bulk_jobs WHERE id=/, []], // no job
    ])
    const stop = worker(db, handle, { concurrency: 1 })
    await vi.advanceTimersByTimeAsync(600)
    await flush()
    stop()
    expect(handle).not.toHaveBeenCalled()
  })

  it('stop:true error skips remaining items and sets job error', async () => {
    const claimed = item({ id: 'i1', attempts: 1 })
    const db = fakePool([
      [/UPDATE bulk_job_items i SET status='running'/, [claimed]],
      [/SELECT \* FROM bulk_jobs WHERE id=/, [job({ id: 'jid', status: 'running' })]],
    ])
    const stop = worker(db, async () => { throw new BulkItemError('wallet empty', { stop: true }) }, { concurrency: 1 })
    await vi.advanceTimersByTimeAsync(600)
    await flush()
    stop()
    const skipAll = db.calls.find((c: any) => /SET status='skipped', error=\$2.*OR status='pending'/.test(c.sql))
    expect(skipAll).toBeTruthy()
    expect(skipAll!.params[1]).toBe('wallet empty')
    expect(db.calls.some((c: any) => /UPDATE bulk_jobs j SET error=\$2/.test(c.sql))).toBe(true)
  })

  it('retryable error under MAX_ATTEMPTS re-queues the item', async () => {
    const claimed = item({ id: 'i1', attempts: 1 }) // < MAX_ATTEMPTS(2)
    const db = fakePool([
      [/UPDATE bulk_job_items i SET status='running'/, [claimed]],
      [/SELECT \* FROM bulk_jobs WHERE id=/, [job({ id: 'jid', status: 'running' })]],
    ])
    const stop = worker(db, async () => { throw new BulkItemError('temporary', { retry: true }) }, { concurrency: 1 })
    await vi.advanceTimersByTimeAsync(600)
    await flush()
    stop()
    const requeue = db.calls.find((c: any) => /SET status='pending', error=\$2, locked_at=NULL/.test(c.sql))
    expect(requeue).toBeTruthy()
    expect(requeue!.params[1]).toBe('temporary')
    // early return means finalize is not called for this item
    expect(db.calls.some((c: any) => /UPDATE bulk_jobs SET finished_at=now\(\)/.test(c.sql))).toBe(false)
  })

  it('retryable error at MAX_ATTEMPTS fails the item and bumps failed', async () => {
    const claimed = item({ id: 'i1', attempts: 2 }) // == MAX_ATTEMPTS, no retry
    const db = fakePool([
      [/UPDATE bulk_job_items i SET status='running'/, [claimed]],
      [/SELECT \* FROM bulk_jobs WHERE id=/, [job({ id: 'jid', status: 'running' })]],
    ])
    const stop = worker(db, async () => { throw new BulkItemError('perma', { retry: true }) }, { concurrency: 1 })
    await vi.advanceTimersByTimeAsync(600)
    await flush()
    stop()
    expect(db.calls.some((c: any) => /SET status='failed', error=\$2/.test(c.sql))).toBe(true)
    expect(db.calls.some((c: any) => /UPDATE bulk_jobs SET failed=failed\+1/.test(c.sql))).toBe(true)
  })

  it('wraps a plain thrown error as retryable; truncates a long message to 500 on final failure', async () => {
    const claimed = item({ id: 'i1', attempts: 2 }) // forces failure path (no retry room)
    const db = fakePool([
      [/UPDATE bulk_job_items i SET status='running'/, [claimed]],
      [/SELECT \* FROM bulk_jobs WHERE id=/, [job({ id: 'jid', status: 'running' })]],
    ])
    const longMsg = 'x'.repeat(700)
    const stop = worker(db, async () => { throw new Error(longMsg) }, { concurrency: 1 })
    await vi.advanceTimersByTimeAsync(600)
    await flush()
    stop()
    const fail = db.calls.find((c: any) => /SET status='failed'/.test(c.sql))!
    expect(fail.params[1]).toHaveLength(500)
  })

  it('wraps a thrown non-Error (no message) as "error"', async () => {
    const claimed = item({ id: 'i1', attempts: 2 })
    const db = fakePool([
      [/UPDATE bulk_job_items i SET status='running'/, [claimed]],
      [/SELECT \* FROM bulk_jobs WHERE id=/, [job({ id: 'jid', status: 'running' })]],
    ])
    const stop = worker(db, async () => { throw {} }, { concurrency: 1 })
    await vi.advanceTimersByTimeAsync(600)
    await flush()
    stop()
    const fail = db.calls.find((c: any) => /SET status='failed'/.test(c.sql))!
    expect(fail.params[1]).toBe('error')
  })

  it('logs and recovers when the inner run throws (SELECT job rejects)', async () => {
    const claimed = item({ id: 'i1' })
    const log = vi.fn()
    const db = fakePool([[/UPDATE bulk_job_items i SET status='running'/, [claimed]]])
    // make the SELECT job inside run() throw
    const base = db.query
    db.query = vi.fn(async (sql: string, params: any[] = []) => {
      if (/SELECT \* FROM bulk_jobs WHERE id=/.test(sql)) { db.calls.push({ sql, params }); throw new Error('read fail') }
      return base(sql, params)
    })
    const stop = worker(db, async () => ({}), { concurrency: 1, log })
    await vi.advanceTimersByTimeAsync(600)
    await flush()
    stop()
    expect(log).toHaveBeenCalledWith('bulk item crashed', expect.any(Error))
  })

  it('logs when the claim query (tick) fails', async () => {
    const log = vi.fn()
    const db = fakePool()
    db.query = vi.fn(async (sql: string) => { throw new Error('claim boom') })
    const stop = worker(db, async () => ({}), { log })
    await vi.advanceTimersByTimeAsync(600)
    await flush()
    stop()
    expect(log).toHaveBeenCalledWith('bulk claim failed', expect.any(Error))
  })

  it('sequential mode builds the LATERAL pick SQL', async () => {
    const db = fakePool([[/UPDATE bulk_job_items i SET status='running'/, []]])
    const stop = worker(db, async () => ({}), { sequential: true })
    await vi.advanceTimersByTimeAsync(600)
    await flush()
    stop()
    const claim = db.calls.find((c: any) => /UPDATE bulk_job_items i SET status='running'/.test(c.sql))!
    expect(claim.sql).toMatch(/CROSS JOIN LATERAL/)
  })

  it('non-sequential mode builds the JOIN pick SQL and passes kind + batch size', async () => {
    const db = fakePool([[/UPDATE bulk_job_items i SET status='running'/, []]])
    const stop = worker(db, async () => ({}), { concurrency: 3 })
    await vi.advanceTimersByTimeAsync(600)
    await flush()
    stop()
    const claim = db.calls.find((c: any) => /UPDATE bulk_job_items i SET status='running'/.test(c.sql))!
    expect(claim.sql).toMatch(/FOR UPDATE OF x SKIP LOCKED/)
    expect(claim.params[0]).toBe('messages')  // kind
    expect(claim.params[1]).toBe(3)           // concurrency - active(0)
  })

  it('applies the where() clause and its params', async () => {
    const db = fakePool([[/UPDATE bulk_job_items i SET status='running'/, []]])
    const where = vi.fn((col: string, p: number) => ({ sql: `${col} = $${p}`, params: ['t-scope'] }))
    const stop = worker(db, async () => ({}), { where })
    await vi.advanceTimersByTimeAsync(600)
    await flush()
    stop()
    expect(where).toHaveBeenCalledWith('j.tenant_id', 3)
    const claim = db.calls.find((c: any) => /UPDATE bulk_job_items i SET status='running'/.test(c.sql))!
    expect(claim.sql).toMatch(/j\.tenant_id = \$3/)
    expect(claim.params).toContain('t-scope')
  })

  it('stop() halts further ticks', async () => {
    const db = fakePool([[/UPDATE bulk_job_items i SET status='running'/, []]])
    const stop = worker(db, async () => ({}))
    await vi.advanceTimersByTimeAsync(600)
    await flush()
    const before = db.calls.length
    stop()
    await vi.advanceTimersByTimeAsync(2000)
    await flush()
    expect(db.calls.length).toBe(before)
  })

  it('on claim, flips queued jobs to running with deduped job ids', async () => {
    const rows = [item({ id: 'i1', job_id: 'jA' }), item({ id: 'i2', job_id: 'jA' }), item({ id: 'i3', job_id: 'jB' })]
    const db = fakePool([
      [/UPDATE bulk_job_items i SET status='running'/, rows],
      [/SELECT \* FROM bulk_jobs WHERE id=/, [job({ id: 'jA', status: 'running' })]],
    ])
    const stop = worker(db, async () => ({}), { concurrency: 5 })
    await vi.advanceTimersByTimeAsync(600)
    await flush()
    stop()
    const flip = db.calls.find((c: any) => /UPDATE bulk_jobs SET status='running', started_at=COALESCE/.test(c.sql))!
    expect(flip.params[0]).toEqual(['jA', 'jB'])
  })
})
