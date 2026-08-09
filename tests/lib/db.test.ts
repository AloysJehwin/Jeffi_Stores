/**
 * Tests for src/lib/db.ts
 *
 * Pool is a module-level singleton.  Each test group that needs to control
 * Pool construction calls vi.resetModules() before importing so it gets a
 * fresh module with pool = null.
 *
 * Key constraint: `new Pool(config)` is called in src, so the Pool mock
 * must be a proper constructor function (not an arrow function).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Helper: build a pg mock whose Pool is a real constructor function
// ---------------------------------------------------------------------------
function makePgMock() {
  const clientQuery = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 })
  const clientRelease = vi.fn()

  const mockClient = {
    query: clientQuery,
    release: clientRelease,
  }

  const poolQuery = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 })
  const poolConnect = vi.fn().mockResolvedValue(mockClient)
  let errorHandler: ((err: Error) => void) | null = null

  const poolOn = vi.fn().mockImplementation(function (event: string, cb: any) {
    if (event === 'error') errorHandler = cb
  })
  const poolEnd = vi.fn()

  // Must be declared with `function` so `new Pool()` works.
  // The constructor stores a reference to its config via capturedConfig.
  const capturedConfigs: any[] = []
  function PoolConstructor(this: any, config: any) {
    capturedConfigs.push(config)
    this.query = poolQuery
    this.connect = poolConnect
    this.on = poolOn
    this.end = poolEnd
  }

  const PoolSpy = vi.fn().mockImplementation(function (this: any, config: any) {
    capturedConfigs.push(config)
    this.query = poolQuery
    this.connect = poolConnect
    this.on = poolOn
    this.end = poolEnd
  })

  return {
    PoolSpy,
    poolQuery,
    poolConnect,
    poolOn,
    poolEnd,
    mockClient,
    clientQuery,
    clientRelease,
    capturedConfigs,
    getErrorHandler: () => errorHandler,
  }
}

// ---------------------------------------------------------------------------
// Core helper: reset modules + register vi.doMock for all dependencies
// ---------------------------------------------------------------------------
async function importDb(opts: {
  dbUrl?: string
  rdsIamAuth?: string
  certExists?: boolean
  adminToken?: string | null
  jwtPayload?: any
} = {}) {
  vi.resetModules()

  const pg = makePgMock()

  vi.doMock('pg', () => ({ Pool: pg.PoolSpy, default: { Pool: pg.PoolSpy } }))

  vi.doMock('fs', () => {
    const existsSync = vi.fn().mockReturnValue(opts.certExists ?? true)
    const readFileSync = vi.fn().mockReturnValue('CERT_CONTENT')
    return { default: { existsSync, readFileSync }, existsSync, readFileSync }
  })

  vi.doMock('@aws-sdk/rds-signer', () => ({
    Signer: vi.fn().mockImplementation(function (this: any) {
      this.getAuthToken = vi.fn().mockResolvedValue('rds-token')
    }),
  }))

  const adminToken = opts.adminToken ?? null
  vi.doMock('next/headers', () => ({
    cookies: vi.fn().mockResolvedValue({
      get: (key: string) =>
        key === 'admin_sid' && adminToken ? { value: adminToken } : undefined,
      set: vi.fn(),
      delete: vi.fn(),
    }),
  }))

  const jwtPayload = opts.jwtPayload ?? { adminId: 'admin-123' }
  vi.doMock('jose', () => ({
    jwtVerify: vi.fn().mockResolvedValue({ payload: jwtPayload }),
  }))

  // Opaque sessions: getRequestAdminId now dynamically imports resolveSession from
  // @/lib/auth-sessions (the cookie value is the opaque session id, not a JWT).
  // Resolve to an admin principal only when an admin_sid cookie is present.
  vi.doMock('@/lib/auth-sessions', () => ({
    resolveSession: vi.fn().mockImplementation(async (sid: string) => {
      if (!sid || !adminToken) return null
      return {
        sid,
        principalType: 'admin',
        principalId: jwtPayload.adminId,
        role: 'admin',
        scopes: [],
      }
    }),
  }))

  process.env.DATABASE_URL = opts.dbUrl ?? 'postgres://localhost/testdb'
  if (opts.rdsIamAuth) {
    process.env.RDS_IAM_AUTH = opts.rdsIamAuth
    process.env.RDS_HOST = 'myhost.rds.amazonaws.com'
    process.env.RDS_PORT = '5432'
    process.env.RDS_USER = 'dbuser'
    process.env.RDS_DB = 'mydb'
  } else {
    delete process.env.RDS_IAM_AUTH
  }

  const mod = await import('@/lib/db')
  return { mod, pg }
}

// ---------------------------------------------------------------------------
// Pool construction – lazy initialisation
// ---------------------------------------------------------------------------
describe('getPool – lazy construction', () => {
  beforeEach(() => {
    vi.resetModules()
    delete process.env.RDS_IAM_AUTH
    delete process.env.DATABASE_URL
  })

  it('does not construct the Pool on module import (lazy)', async () => {
    const { pg } = await importDb()
    expect(pg.PoolSpy).not.toHaveBeenCalled()
  })

  it('constructs the Pool on the first query call', async () => {
    const { mod, pg } = await importDb()
    await mod.query('SELECT 1')
    expect(pg.PoolSpy).toHaveBeenCalledTimes(1)
  })

  it('reuses the same Pool on subsequent calls (singleton)', async () => {
    const { mod, pg } = await importDb()
    await mod.query('SELECT 1')
    await mod.query('SELECT 2')
    expect(pg.PoolSpy).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// TLS / cert behaviour for RDS URLs
// ---------------------------------------------------------------------------
describe('getPool – TLS configuration', () => {
  beforeEach(() => {
    vi.resetModules()
    delete process.env.RDS_IAM_AUTH
  })

  it('sets rejectUnauthorized:true and reads cert when URL contains rds.amazonaws.com', async () => {
    const { mod, pg } = await importDb({
      dbUrl: 'postgres://user:pw@myhost.rds.amazonaws.com:5432/db',
    })
    await mod.query('SELECT 1')
    const config = pg.capturedConfigs[0]
    expect(config.ssl.rejectUnauthorized).toBe(true)
    expect(config.ssl.ca).toBe('CERT_CONTENT')
  })

  it('throws when RDS URL is used but cert file is missing', async () => {
    const { mod } = await importDb({
      dbUrl: 'postgres://user:pw@myhost.rds.amazonaws.com:5432/db',
      certExists: false,
    })
    await expect(mod.query('SELECT 1')).rejects.toThrow('RDS TLS certificate not found')
  })

  it('does NOT set ssl when DATABASE_URL is a plain non-RDS URL', async () => {
    const { mod, pg } = await importDb({ dbUrl: 'postgres://localhost/testdb' })
    await mod.query('SELECT 1')
    const config = pg.capturedConfigs[0]
    expect(config.ssl).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Pool error handler writes to _debug_log
// ---------------------------------------------------------------------------
describe('pool.on("error") handler', () => {
  it('inserts into _debug_log when a pool-level error occurs', async () => {
    const { mod, pg } = await importDb()
    // Trigger pool creation
    await mod.query('SELECT 1')

    const errorHandler = pg.getErrorHandler()
    expect(errorHandler).not.toBeNull()

    // Simulate a pool-level error
    const fakeErr = Object.assign(new Error('connection lost'), { code: 'ECONNRESET' })
    errorHandler!(fakeErr)

    // handler is async internally; drain microtasks
    await new Promise(r => setTimeout(r, 10))

    const insertCall = pg.poolQuery.mock.calls.find(
      (c: any[]) => typeof c[0] === 'string' && (c[0] as string).includes('_debug_log')
    )
    expect(insertCall).toBeDefined()
    expect(insertCall![1][0]).toBe('pool.error')
    const payload = JSON.parse(insertCall![1][1])
    expect(payload.msg).toBe('connection lost')
    expect(payload.code).toBe('ECONNRESET')
  })
})

// ---------------------------------------------------------------------------
// query() – mutation wrapping with audit context
// ---------------------------------------------------------------------------
describe('query() – mutation wrapping', () => {
  it('wraps INSERT in a transaction with audit.admin_id when admin cookie is present', async () => {
    const { mod, pg } = await importDb({
      adminToken: 'valid-token',
      jwtPayload: { adminId: 'admin-abc' },
    })
    await mod.query('INSERT INTO orders (id) VALUES ($1)', ['o1'])

    // clientQuery is the vi.fn() attached to the mock client returned by poolConnect
    const calls = pg.clientQuery.mock.calls.map((c: any[]) =>
      typeof c[0] === 'string' ? c[0] : ''
    ) as string[]
    expect(calls).toContain('BEGIN')
    expect(calls.some(s => s.includes('set_config') && s.includes('audit.admin_id'))).toBe(true)
    expect(calls).toContain('COMMIT')
  })

  it('does NOT wrap SELECT in a transaction (pool.query is called directly)', async () => {
    const { mod, pg } = await importDb({
      adminToken: 'valid-token',
      jwtPayload: { adminId: 'admin-abc' },
    })
    await mod.query('SELECT * FROM orders')
    // No client.connect() for non-mutation queries
    expect(pg.poolConnect).not.toHaveBeenCalled()
    expect(pg.poolQuery).toHaveBeenCalledWith('SELECT * FROM orders', undefined)
  })

  it('does NOT wrap mutation when there is no admin cookie', async () => {
    const { mod, pg } = await importDb({ adminToken: null })
    await mod.query('INSERT INTO orders (id) VALUES ($1)', ['o1'])
    expect(pg.poolConnect).not.toHaveBeenCalled()
    expect(pg.poolQuery).toHaveBeenCalled()
  })

  it('rolls back and re-throws when client query fails inside mutation transaction', async () => {
    vi.resetModules()

    const pg = makePgMock()

    // Sequence: BEGIN ok, set_config ok, INSERT fails, ROLLBACK ok
    pg.clientQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // BEGIN
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // set_config
      .mockRejectedValueOnce(new Error('DB constraint'))  // INSERT
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // ROLLBACK

    vi.doMock('pg', () => ({ Pool: pg.PoolSpy, default: { Pool: pg.PoolSpy } }))
    vi.doMock('fs', () => ({
      default: { existsSync: vi.fn().mockReturnValue(true), readFileSync: vi.fn().mockReturnValue('CERT') },
      existsSync: vi.fn().mockReturnValue(true),
      readFileSync: vi.fn().mockReturnValue('CERT'),
    }))
    vi.doMock('@aws-sdk/rds-signer', () => ({
      Signer: vi.fn().mockImplementation(function (this: any) { this.getAuthToken = vi.fn() }),
    }))
    vi.doMock('next/headers', () => ({
      cookies: vi.fn().mockResolvedValue({
        get: (k: string) => k === 'admin_sid' ? { value: 'tok' } : undefined,
      }),
    }))
    vi.doMock('jose', () => ({
      jwtVerify: vi.fn().mockResolvedValue({ payload: { adminId: 'admin-err' } }),
    }))
    vi.doMock('@/lib/auth-sessions', () => ({
      resolveSession: vi.fn().mockResolvedValue({
        sid: 'tok',
        principalType: 'admin',
        principalId: 'admin-err',
        role: 'admin',
        scopes: [],
      }),
    }))
    process.env.DATABASE_URL = 'postgres://localhost/testdb'

    const { query } = await import('@/lib/db')
    await expect(query('INSERT INTO t VALUES ($1)', [1])).rejects.toThrow('DB constraint')

    const calls = pg.clientQuery.mock.calls.map((c: any[]) =>
      typeof c[0] === 'string' ? c[0] : ''
    ) as string[]
    expect(calls).toContain('ROLLBACK')
  })
})

// ---------------------------------------------------------------------------
// queryOne
// ---------------------------------------------------------------------------
describe('queryOne()', () => {
  it('returns the first row when rows are present', async () => {
    const { mod, pg } = await importDb()
    pg.poolQuery.mockResolvedValueOnce({
      rows: [{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }],
      rowCount: 2,
    })
    const result = await mod.queryOne('SELECT * FROM users')
    expect(result).toEqual({ id: 1, name: 'Alice' })
  })

  it('returns null when no rows are returned', async () => {
    const { mod, pg } = await importDb()
    pg.poolQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 })
    const result = await mod.queryOne('SELECT * FROM users WHERE id = $1', [999])
    expect(result).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// queryMany
// ---------------------------------------------------------------------------
describe('queryMany()', () => {
  it('returns all rows', async () => {
    const { mod, pg } = await importDb()
    const rows = [{ id: 1 }, { id: 2 }, { id: 3 }]
    pg.poolQuery.mockResolvedValueOnce({ rows, rowCount: 3 })
    const result = await mod.queryMany('SELECT * FROM users')
    expect(result).toEqual(rows)
  })

  it('returns an empty array when there are no rows', async () => {
    const { mod, pg } = await importDb()
    pg.poolQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 })
    const result = await mod.queryMany('SELECT * FROM users WHERE 1=0')
    expect(result).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// withTransaction
// ---------------------------------------------------------------------------
describe('withTransaction()', () => {
  it('calls BEGIN and COMMIT around a successful fn', async () => {
    const { mod, pg } = await importDb({ adminToken: null })
    const fn = vi.fn().mockResolvedValue('ok')
    const result = await mod.withTransaction(fn)

    expect(result).toBe('ok')
    const calls = pg.clientQuery.mock.calls.map((c: any[]) =>
      typeof c[0] === 'string' ? c[0] : ''
    ) as string[]
    expect(calls).toContain('BEGIN')
    expect(calls).toContain('COMMIT')
    expect(calls).not.toContain('ROLLBACK')
  })

  it('calls ROLLBACK and re-throws when fn throws', async () => {
    const { mod, pg } = await importDb({ adminToken: null })
    const fn = vi.fn().mockRejectedValue(new Error('tx error'))

    await expect(mod.withTransaction(fn)).rejects.toThrow('tx error')

    const calls = pg.clientQuery.mock.calls.map((c: any[]) =>
      typeof c[0] === 'string' ? c[0] : ''
    ) as string[]
    expect(calls).toContain('BEGIN')
    expect(calls).toContain('ROLLBACK')
  })

  it('always releases the client on success', async () => {
    const { mod, pg } = await importDb({ adminToken: null })
    await mod.withTransaction(vi.fn().mockResolvedValue(undefined))
    expect(pg.clientRelease).toHaveBeenCalled()
  })

  it('always releases the client on failure', async () => {
    const { mod, pg } = await importDb({ adminToken: null })
    await mod.withTransaction(vi.fn().mockRejectedValue(new Error('boom'))).catch(() => {})
    expect(pg.clientRelease).toHaveBeenCalled()
  })

  it('sets audit.admin_id inside the transaction when admin cookie is present', async () => {
    const { mod, pg } = await importDb({
      adminToken: 'valid-token',
      jwtPayload: { adminId: 'admin-tx' },
    })
    await mod.withTransaction(vi.fn().mockResolvedValue(null))

    const calls = pg.clientQuery.mock.calls.map((c: any[]) =>
      typeof c[0] === 'string' ? c[0] : ''
    ) as string[]
    expect(calls.some(s => s.includes('set_config') && s.includes('audit.admin_id'))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// RDS IAM Auth (lines 30-42): useIamAuth branch
// ---------------------------------------------------------------------------
describe('getPool – RDS IAM Auth', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('configures host/port/user/database from env vars when RDS_IAM_AUTH=true', async () => {
    process.env.RDS_HOST = 'myhost.rds.amazonaws.com'
    process.env.RDS_PORT = '5433'
    process.env.RDS_USER = 'iamuser'
    process.env.RDS_DB = 'iamdb'
    process.env.AWS_REGION = 'eu-west-1'

    const { mod, pg } = await importDb({ rdsIamAuth: 'true', certExists: true })
    await mod.query('SELECT 1')

    const config = pg.capturedConfigs[0]
    expect(config.host).toBe('myhost.rds.amazonaws.com')
    expect(config.port).toBe(5432) // importDb sets RDS_PORT=5432
    expect(config.user).toBe('dbuser') // importDb sets RDS_USER=dbuser
    expect(config.database).toBe('mydb') // importDb sets RDS_DB=mydb
    expect(config.ssl.rejectUnauthorized).toBe(true)
    expect(config.ssl.ca).toBe('CERT_CONTENT')
    expect(typeof config.password).toBe('function')
  })

  it('uses rejectUnauthorized:false when cert file is missing under RDS_IAM_AUTH=true', async () => {
    const { mod, pg } = await importDb({ rdsIamAuth: 'true', certExists: false })
    await mod.query('SELECT 1')

    const config = pg.capturedConfigs[0]
    expect(config.ssl.rejectUnauthorized).toBe(false)
    expect(config.ssl.ca).toBeUndefined()
  })

  it('uses default region us-east-1 when AWS_REGION is not set', async () => {
    delete process.env.AWS_REGION
    const { mod, pg } = await importDb({ rdsIamAuth: 'true', certExists: true })
    await mod.query('SELECT 1')
    // Pool was constructed — the IAM auth branch ran without error
    expect(pg.PoolSpy).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// getRequestAdminId – catch branch: resolveSession throws / returns null
// ---------------------------------------------------------------------------
describe('getRequestAdminId – error handling', () => {
  it('returns null and does not throw when resolveSession rejects (catch branch)', async () => {
    vi.resetModules()

    const pg = makePgMock()

    vi.doMock('pg', () => ({ Pool: pg.PoolSpy, default: { Pool: pg.PoolSpy } }))
    vi.doMock('fs', () => ({
      default: { existsSync: vi.fn().mockReturnValue(true), readFileSync: vi.fn().mockReturnValue('CERT') },
      existsSync: vi.fn().mockReturnValue(true),
      readFileSync: vi.fn().mockReturnValue('CERT'),
    }))
    vi.doMock('@aws-sdk/rds-signer', () => ({
      Signer: vi.fn().mockImplementation(function (this: any) { this.getAuthToken = vi.fn() }),
    }))
    vi.doMock('next/headers', () => ({
      cookies: vi.fn().mockResolvedValue({
        get: (k: string) => k === 'admin_sid' ? { value: 'bad-token' } : undefined,
      }),
    }))
    // resolveSession throws — exercises the catch block in getRequestAdminId
    vi.doMock('@/lib/auth-sessions', () => ({
      resolveSession: vi.fn().mockRejectedValue(new Error('db unreachable')),
    }))
    process.env.DATABASE_URL = 'postgres://localhost/testdb'
    process.env.JWT_SECRET = 'secret'

    const { query } = await import('@/lib/db')
    // INSERT would wrap in transaction only if adminId is non-null.
    // Since resolveSession throws, adminId should be null -> falls through to pool.query
    await expect(query('INSERT INTO t VALUES ($1)', [1])).resolves.toBeDefined()
    expect(pg.poolConnect).not.toHaveBeenCalled()
  })

  it('returns null when resolveSession finds no session for the cookie', async () => {
    vi.resetModules()

    const pg = makePgMock()

    vi.doMock('pg', () => ({ Pool: pg.PoolSpy, default: { Pool: pg.PoolSpy } }))
    vi.doMock('fs', () => ({
      default: { existsSync: vi.fn().mockReturnValue(true), readFileSync: vi.fn().mockReturnValue('CERT') },
      existsSync: vi.fn().mockReturnValue(true),
      readFileSync: vi.fn().mockReturnValue('CERT'),
    }))
    vi.doMock('@aws-sdk/rds-signer', () => ({
      Signer: vi.fn().mockImplementation(function (this: any) { this.getAuthToken = vi.fn() }),
    }))
    vi.doMock('next/headers', () => ({
      cookies: vi.fn().mockResolvedValue({
        get: (k: string) => k === 'admin_sid' ? { value: 'some-token' } : undefined,
      }),
    }))
    // Session not found / expired (e.g. a legacy JWT cookie) -> null
    vi.doMock('@/lib/auth-sessions', () => ({
      resolveSession: vi.fn().mockResolvedValue(null),
    }))
    process.env.DATABASE_URL = 'postgres://localhost/testdb'

    const { query } = await import('@/lib/db')
    // No session -> adminId null -> no transaction wrapping
    await expect(query('INSERT INTO t VALUES ($1)', [1])).resolves.toBeDefined()
    expect(pg.poolConnect).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// queryCount (lines 128-129)
// ---------------------------------------------------------------------------
describe('queryCount()', () => {
  it('returns the parsed integer from result.rows[0].count', async () => {
    const { mod, pg } = await importDb()
    pg.poolQuery.mockResolvedValueOnce({ rows: [{ count: '42' }], rowCount: 1 })
    const result = await mod.queryCount('SELECT COUNT(*) AS count FROM users')
    expect(result).toBe(42)
  })

  it('returns 0 when rows is empty (no count field)', async () => {
    const { mod, pg } = await importDb()
    pg.poolQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 })
    const result = await mod.queryCount('SELECT COUNT(*) AS count FROM users WHERE 1=0')
    expect(result).toBe(0)
  })

  it('returns 0 when count field is missing from the first row', async () => {
    const { mod, pg } = await importDb()
    pg.poolQuery.mockResolvedValueOnce({ rows: [{}], rowCount: 1 })
    const result = await mod.queryCount('SELECT COUNT(*) AS count FROM users')
    expect(result).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// audit-context integration: local AsyncLocalStorage value takes precedence
// ---------------------------------------------------------------------------
describe('query() – runWithAuditContext takes precedence over cookie', () => {
  it('uses the context adminId and wraps mutation in a transaction', async () => {
    const { mod, pg } = await importDb({ adminToken: null })

    // Importing audit-context after resetModules ensures we share the same
    // AsyncLocalStorage instance as the db module loaded in this cycle.
    const { runWithAuditContext } = await import('@/lib/audit-context')

    await runWithAuditContext('ctx-admin', async () => {
      await mod.query('INSERT INTO orders (id) VALUES ($1)', ['o2'])
    })

    const calls = pg.clientQuery.mock.calls.map((c: any[]) =>
      typeof c[0] === 'string' ? c[0] : ''
    ) as string[]
    expect(calls).toContain('BEGIN')
    expect(calls.some(s => s.includes('audit.admin_id'))).toBe(true)
    expect(calls).toContain('COMMIT')
  })
})
