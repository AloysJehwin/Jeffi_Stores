import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockQuery = vi.fn()
const mockEnd = vi.fn().mockResolvedValue(undefined)
vi.mock('pg', () => ({
  Pool: class {
    query = (...a: any[]) => mockQuery(...a)
    end = mockEnd
  },
}))
const cpQuery = vi.fn()
vi.mock('@/lib/tenant-registry', () => ({ controlPlanePool: () => ({ query: (...a: any[]) => cpQuery(...a) }) }))
vi.mock('@/lib/tenant-migrations-schema', () => ({
  buildTenantSchemaSql: () =>
    'CREATE TABLE IF NOT EXISTS public.t (id uuid);\nALTER TABLE public.t ADD COLUMN IF NOT EXISTS source text;\nALTER TABLE public.t ADD CONSTRAINT t_source_check CHECK (source IS NOT NULL);',
  desiredTableColumns: () => new Map([['t', ['id', 'source']]]),
}))

import {
  runMigrationFanout,
  describeSqlError,
  isTransientDbError,
  missingColumns,
  applySchemaToTenant,
} from '@/lib/tenant-migrations'

const SQL =
  'CREATE TABLE IF NOT EXISTS public.t (id uuid);\nALTER TABLE public.t ADD COLUMN IF NOT EXISTS source text;\nALTER TABLE public.t ADD CONSTRAINT t_source_check CHECK (source IS NOT NULL);'
const liveRows = (cols: string[]) => ({ rows: cols.map(c => ({ table_name: 't', column_name: c })) })

beforeEach(() => {
  vi.clearAllMocks()
  process.env.RDS_MASTER_PASSWORD = 'pw'
  cpQuery.mockImplementation(async (text: string) => {
    if (/FROM tenants/.test(text))
      return {
        rows: [
          { id: 't1', slug: 'acme', rds_endpoint: 'db', rds_port: 5432, rds_db: 'jeffi_stores', region: 'us-east-1' },
        ],
      }
    if (/FROM tenant_migration_runs/.test(text)) return { rows: [] }
    return { rows: [], rowCount: 1 }
  })
})

describe('describeSqlError', () => {
  it('names the statement at the reported position', () => {
    const err = Object.assign(new Error('column "source" does not exist'), {
      code: '42703',
      position: String(SQL.indexOf('CHECK (source') + 8),
    })
    const msg = describeSqlError(err, SQL)
    expect(msg).toContain('column "source" does not exist (code 42703)')
    expect(msg).toContain('near: ALTER TABLE public.t ADD CONSTRAINT t_source_check CHECK (source IS NOT NULL);')
  })

  it('falls back to the DO-block inner query, then to the bare message', () => {
    expect(describeSqlError(Object.assign(new Error('boom'), { internalQuery: 'ALTER TABLE x ADD y' }), SQL)).toBe(
      'boom near: ALTER TABLE x ADD y'
    )
    expect(describeSqlError(new Error('plain'), SQL)).toBe('plain')
  })
})

describe('isTransientDbError', () => {
  it('recognises connection-class failures and nothing else', () => {
    expect(isTransientDbError({ code: '57P01', message: 'terminating connection' })).toBe(true)
    expect(isTransientDbError({ message: 'connect ECONNREFUSED 10.0.0.1:5432' })).toBe(true)
    expect(isTransientDbError({ code: '42703', message: 'column "source" does not exist' })).toBe(false)
    expect(isTransientDbError(null)).toBe(false)
  })
})

describe('missingColumns', () => {
  it('lists absent columns and whole tables', () => {
    const desired = new Map([
      ['a', ['x', 'y']],
      ['b', ['z']],
    ])
    const live = new Map([['a', new Set(['x'])]])
    expect(missingColumns(desired, live)).toEqual(['a.y', 'b.*'])
  })
})

describe('applySchemaToTenant', () => {
  it('retries once after a transient error, then verifies the columns landed', async () => {
    mockQuery
      .mockRejectedValueOnce(Object.assign(new Error('Connection terminated unexpectedly'), { code: '57P01' }))
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce(liveRows(['id', 'source']))
    const pool = { query: (...a: any[]) => mockQuery(...a) } as any
    await expect(applySchemaToTenant(pool, SQL, new Map([['t', ['id', 'source']]]))).resolves.toBeUndefined()
    expect(mockQuery).toHaveBeenCalledTimes(3)
  }, 10_000)

  it('does not retry a real schema error and reports the failing statement', async () => {
    mockQuery.mockRejectedValueOnce(
      Object.assign(new Error('column "source" does not exist'), {
        code: '42703',
        position: String(SQL.indexOf('CHECK (source') + 8),
      })
    )
    const pool = { query: (...a: any[]) => mockQuery(...a) } as any
    await expect(applySchemaToTenant(pool, SQL, new Map())).rejects.toThrow(
      /does not exist \(code 42703\) near: ALTER TABLE public\.t ADD CONSTRAINT/
    )
    expect(mockQuery).toHaveBeenCalledTimes(1)
  })

  it('fails when a declared column is still missing after the apply', async () => {
    mockQuery.mockResolvedValueOnce({}).mockResolvedValueOnce(liveRows(['id']))
    const pool = { query: (...a: any[]) => mockQuery(...a) } as any
    await expect(applySchemaToTenant(pool, SQL, new Map([['t', ['id', 'source']]]))).rejects.toThrow(
      /post-apply verification: 1 column\(s\) still missing: t\.source/
    )
  })
})

describe('runMigrationFanout', () => {
  it('records a success per tenant when the apply and the verification pass', async () => {
    mockQuery.mockResolvedValueOnce({}).mockResolvedValueOnce(liveRows(['id', 'source']))
    const r = await runMigrationFanout('sha1')
    expect(r).toMatchObject({ total: 1, applied: 1, skipped: 0, failed: 0, failures: [] })
    const recorded = cpQuery.mock.calls.find(c => /INSERT INTO tenant_migration_runs/.test(c[0]))
    expect(recorded?.[1]).toEqual(['t1', 'sha1', 'success', null])
    expect(mockEnd).toHaveBeenCalled()
  })

  it('isolates a failing tenant with a readable error and records the failure', async () => {
    mockQuery.mockRejectedValueOnce(Object.assign(new Error('column "source" does not exist'), { code: '42703' }))
    const r = await runMigrationFanout('sha2')
    expect(r.failed).toBe(1)
    expect(r.failures[0]).toMatchObject({ slug: 'acme' })
    expect(r.failures[0].error).toContain('column "source" does not exist (code 42703)')
    const recorded = cpQuery.mock.calls.find(c => /INSERT INTO tenant_migration_runs/.test(c[0]))
    expect(recorded?.[1][2]).toBe('failed')
  })

  it('skips a tenant already recorded at this sha', async () => {
    cpQuery.mockImplementation(async (text: string) => {
      if (/FROM tenants/.test(text))
        return {
          rows: [
            { id: 't1', slug: 'acme', rds_endpoint: 'db', rds_port: 5432, rds_db: 'jeffi_stores', region: 'us-east-1' },
          ],
        }
      if (/FROM tenant_migration_runs/.test(text)) return { rows: [{ 1: 1 }] }
      return { rows: [] }
    })
    const r = await runMigrationFanout('sha3')
    expect(r).toMatchObject({ skipped: 1, applied: 0, failed: 0 })
    expect(mockQuery).not.toHaveBeenCalled()
  })
})
