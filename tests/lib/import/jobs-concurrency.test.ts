import { describe, it, expect, vi, beforeEach } from 'vitest'

const pool = { query: vi.fn(), connect: vi.fn() }
vi.mock('@/lib/tenant-registry', () => ({ controlPlanePool: () => pool }))
vi.mock('@/lib/tenancy/tenant-context', () => ({ resolveTenantId: vi.fn() }))

import {
  withImportLock,
  ImportBusyError,
  failStaleImportJobs,
  claimNextImportJob,
  pageImportJobs,
  getImportJob,
  STALE_JOB_MINUTES,
  STALE_JOB_MESSAGE,
} from '@/lib/import/jobs'

function client(lockOk = true) {
  const c = {
    query: vi.fn(async (sql: string) => {
      if (sql.includes('pg_try_advisory_lock')) return { rows: [{ ok: lockOk }] }
      if (sql.includes('UPDATE import_jobs')) return { rows: [{ id: 'j1', status: 'running' }] }
      return { rows: [] }
    }),
    release: vi.fn(),
  }
  pool.connect.mockResolvedValue(c)
  return c
}

beforeEach(() => vi.clearAllMocks())

describe('withImportLock', () => {
  it('runs the work and always unlocks and releases', async () => {
    const c = client(true)
    await expect(withImportLock('t1', 'sheet', async () => 7)).resolves.toBe(7)
    expect(c.query.mock.calls.map(x => x[0])).toEqual([
      expect.stringContaining('pg_try_advisory_lock'),
      expect.stringContaining('pg_advisory_unlock'),
    ])
    expect(c.query.mock.calls[0][1]).toEqual(['import:sheet:t1'])
    expect(c.release).toHaveBeenCalledOnce()
  })

  it('unlocks when the work throws', async () => {
    const c = client(true)
    await expect(withImportLock('t1', 'upload', async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom')
    expect(c.query.mock.calls.some(x => String(x[0]).includes('pg_advisory_unlock'))).toBe(true)
    expect(c.release).toHaveBeenCalledOnce()
  })

  it('throws ImportBusyError without running the work when the lock is held', async () => {
    const c = client(false)
    const fn = vi.fn()
    await expect(withImportLock('t1', 'sheet', fn)).rejects.toBeInstanceOf(ImportBusyError)
    expect(fn).not.toHaveBeenCalled()
    expect(c.release).toHaveBeenCalledOnce()
  })
})

describe('stale jobs and claiming', () => {
  it('fails running jobs idle past the threshold, optionally for one tenant', async () => {
    pool.query.mockResolvedValue({ rowCount: 2 })
    await expect(failStaleImportJobs('t1')).resolves.toBe(2)
    const [sql, args] = pool.query.mock.calls[0]
    expect(sql).toMatch(/status='failed'[\s\S]*status='running' AND updated_at < now\(\)/)
    expect(args).toEqual([STALE_JOB_MESSAGE, STALE_JOB_MINUTES, 't1'])
    await failStaleImportJobs()
    expect(pool.query.mock.calls[1][1][2]).toBeNull()
  })

  it('claims under a transaction lock and skips tenants with a live running job', async () => {
    const c = client()
    await expect(claimNextImportJob()).resolves.toMatchObject({ id: 'j1' })
    const sqls = c.query.mock.calls.map(x => String(x[0]))
    expect(sqls[0]).toBe('BEGIN')
    expect(sqls[1]).toMatch(/pg_advisory_xact_lock/)
    expect(sqls[2]).toMatch(/NOT EXISTS[\s\S]*r.status='running'/)
    expect(sqls[3]).toBe('COMMIT')
    expect(c.release).toHaveBeenCalledOnce()
  })
})

describe('history paging', () => {
  it('clamps limit and offset, including non-finite input', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ n: 0 }] })
    await pageImportJobs('t1', { limit: Infinity, offset: Infinity, status: 'failed', source: 'upload' })
    const sql = String(pool.query.mock.calls[0][0])
    expect(sql).toMatch(/LIMIT 30 OFFSET 0/)
    expect(sql).toMatch(/status='failed'/)
    expect(pool.query.mock.calls[0][1]).toEqual(['t1', 'upload'])
  })

  it('does not query for a job id that is not a uuid', async () => {
    await expect(getImportJob("x' OR 1=1", 't1')).resolves.toBeNull()
    expect(pool.query).not.toHaveBeenCalled()
  })
})
