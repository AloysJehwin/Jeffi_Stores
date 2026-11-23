import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock pools + context so db.ts's pool() and adminId are controlled.
const platformPool = vi.fn()
const tenantPool = vi.fn()
const isPlatformScope = vi.fn()
const requireTenant = vi.fn()
const currentAdminId = vi.fn()

vi.mock('../src/pools', () => ({
  platformPool: () => platformPool(),
  tenantPool: (t: any) => tenantPool(t),
}))
vi.mock('../src/context', () => ({
  isPlatformScope: () => isPlatformScope(),
  requireTenant: () => requireTenant(),
  currentAdminId: () => currentAdminId(),
}))

import { query, queryOne, queryMany, queryCount, getClient, withTransaction } from '../src/db'

function makeClient() {
  return {
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    release: vi.fn(),
  }
}
function makePool(client = makeClient()) {
  return {
    client,
    query: vi.fn().mockResolvedValue({ rows: [{ a: 1 }], rowCount: 1 }),
    connect: vi.fn().mockResolvedValue(client),
  }
}

describe('db.query — pool selection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    currentAdminId.mockReturnValue(null)
  })

  it('uses the platform pool in platform scope', async () => {
    const pool = makePool()
    isPlatformScope.mockReturnValue(true)
    platformPool.mockReturnValue(pool)
    const r = await query('SELECT 1')
    expect(pool.query).toHaveBeenCalledWith('SELECT 1', undefined)
    expect(r.rows).toEqual([{ a: 1 }])
    expect(tenantPool).not.toHaveBeenCalled()
  })

  it('uses the tenant pool otherwise', async () => {
    const pool = makePool()
    isPlatformScope.mockReturnValue(false)
    requireTenant.mockReturnValue({ slug: 'acme' })
    tenantPool.mockReturnValue(pool)
    await query('SELECT 2', [1])
    expect(tenantPool).toHaveBeenCalledWith({ slug: 'acme' })
    expect(pool.query).toHaveBeenCalledWith('SELECT 2', [1])
  })
})

describe('db.query — admin audit wrapping on mutations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    isPlatformScope.mockReturnValue(true)
  })

  it('wraps a mutation in BEGIN / set_config / COMMIT when an admin is in scope', async () => {
    const client = makeClient()
    client.query.mockResolvedValue({ rows: [{ id: 1 }], rowCount: 1 })
    const pool = makePool(client)
    platformPool.mockReturnValue(pool)
    currentAdminId.mockReturnValue('admin-1')

    const r = await query('INSERT INTO t VALUES (1)', [9])
    expect(r.rows).toEqual([{ id: 1 }])
    const calls = client.query.mock.calls.map((c) => c[0])
    expect(calls[0]).toBe('BEGIN')
    expect(calls[1]).toContain("set_config('audit.admin_id'")
    expect(client.query.mock.calls[1][1]).toEqual(['admin-1'])
    expect(calls).toContain('INSERT INTO t VALUES (1)')
    expect(calls[calls.length - 1]).toBe('COMMIT')
    expect(client.release).toHaveBeenCalled()
    // pool.query (non-transactional) must NOT be used
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('rolls back and rethrows when the mutation fails', async () => {
    const client = makeClient()
    client.query
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({}) // set_config
      .mockRejectedValueOnce(new Error('boom')) // the INSERT
      .mockResolvedValue({}) // ROLLBACK
    const pool = makePool(client)
    platformPool.mockReturnValue(pool)
    currentAdminId.mockReturnValue('admin-1')

    await expect(query('UPDATE t SET x=1')).rejects.toThrow('boom')
    expect(client.query.mock.calls.map((c) => c[0])).toContain('ROLLBACK')
    expect(client.release).toHaveBeenCalled()
  })

  it('does NOT wrap a SELECT even with an admin in scope', async () => {
    const pool = makePool()
    platformPool.mockReturnValue(pool)
    currentAdminId.mockReturnValue('admin-1')
    await query('SELECT * FROM t')
    expect(pool.connect).not.toHaveBeenCalled()
    expect(pool.query).toHaveBeenCalled()
  })
})

describe('db — queryOne / queryMany / queryCount', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    isPlatformScope.mockReturnValue(true)
    currentAdminId.mockReturnValue(null)
  })

  it('queryOne returns the first row or null', async () => {
    const pool = makePool()
    pool.query.mockResolvedValueOnce({ rows: [{ a: 1 }] }).mockResolvedValueOnce({ rows: [] })
    platformPool.mockReturnValue(pool)
    expect(await queryOne('SELECT')).toEqual({ a: 1 })
    expect(await queryOne('SELECT')).toBeNull()
  })

  it('queryMany returns the rows array', async () => {
    const pool = makePool()
    pool.query.mockResolvedValue({ rows: [{ a: 1 }, { a: 2 }] })
    platformPool.mockReturnValue(pool)
    expect(await queryMany('SELECT')).toEqual([{ a: 1 }, { a: 2 }])
  })

  it('queryCount parses the count, defaulting to 0', async () => {
    const pool = makePool()
    pool.query.mockResolvedValueOnce({ rows: [{ count: '42' }] }).mockResolvedValueOnce({ rows: [] })
    platformPool.mockReturnValue(pool)
    expect(await queryCount('SELECT count(*)')).toBe(42)
    expect(await queryCount('SELECT count(*)')).toBe(0)
  })
})

describe('db.getClient', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    isPlatformScope.mockReturnValue(true)
  })

  it('returns a raw client untouched when no admin in scope', async () => {
    const client = makeClient()
    const pool = makePool(client)
    platformPool.mockReturnValue(pool)
    currentAdminId.mockReturnValue(null)
    const c = await getClient()
    expect(c).toBe(client)
    expect(client.query).not.toHaveBeenCalled()
  })

  it('sets audit.admin_id and wraps release to clear it when admin in scope', async () => {
    const client = makeClient()
    const origRelease = client.release
    const pool = makePool(client)
    platformPool.mockReturnValue(pool)
    currentAdminId.mockReturnValue('admin-2')

    const c = await getClient()
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining("set_config('audit.admin_id'"), ['admin-2'])
    // release is replaced
    expect(c.release).not.toBe(origRelease)
    await (c as any).release()
    await new Promise((r) => setTimeout(r, 0)) // flush the clear-query .finally() chain
    // clearing query issued, then underlying release called
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining("set_config('audit.admin_id', ''"))
    expect(origRelease).toHaveBeenCalled()
  })
})

describe('db.withTransaction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    isPlatformScope.mockReturnValue(true)
  })

  it('commits on success and sets audit id when admin present', async () => {
    const client = makeClient()
    const origRelease = client.release // getClient wraps client.release when an admin is in scope
    const pool = makePool(client)
    platformPool.mockReturnValue(pool)
    currentAdminId.mockReturnValue('admin-3')

    const r = await withTransaction(async (c) => {
      expect(c).toBe(client)
      return 'ok'
    })
    await new Promise((res) => setTimeout(res, 0)) // flush the wrapped-release clear chain
    expect(r).toBe('ok')
    const calls = client.query.mock.calls.map((c) => c[0])
    expect(calls).toContain('BEGIN')
    expect(calls).toContain('COMMIT')
    // BEGIN precedes COMMIT
    expect(calls.indexOf('BEGIN')).toBeLessThan(calls.indexOf('COMMIT'))
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining("set_config('audit.admin_id'"), ['admin-3'])
    expect(origRelease).toHaveBeenCalled()
  })

  it('does not set audit id when no admin, still commits', async () => {
    const client = makeClient()
    const pool = makePool(client)
    platformPool.mockReturnValue(pool)
    currentAdminId.mockReturnValue(null)
    await withTransaction(async () => 1)
    const setConfig = client.query.mock.calls.find((c) => String(c[0]).includes('set_config'))
    expect(setConfig).toBeUndefined()
  })

  it('rolls back and rethrows when the callback throws', async () => {
    const client = makeClient()
    const pool = makePool(client)
    platformPool.mockReturnValue(pool)
    currentAdminId.mockReturnValue(null)
    await expect(
      withTransaction(async () => {
        throw new Error('fail')
      }),
    ).rejects.toThrow('fail')
    expect(client.query.mock.calls.map((c) => c[0])).toContain('ROLLBACK')
    expect(client.release).toHaveBeenCalled()
  })
})
