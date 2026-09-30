import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/lib/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  getClient: vi.fn(),
}))
vi.mock('@/lib/campaigns/sql-safety', () => ({
  validateScenarioSql: vi.fn(),
}))

// ── Imports ───────────────────────────────────────────────────────────────────

import { POST } from '@/app/api/admin/campaigns/scenarios/dry-run/route'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { query, getClient } from '@/lib/db'
import { validateScenarioSql } from '@/lib/campaigns/sql-safety'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockQuery = vi.mocked(query)
const mockGetClient = vi.mocked(getClient)
const mockValidateSql = vi.mocked(validateScenarioSql)

// ── Helpers ───────────────────────────────────────────────────────────────────

const ADMIN = { adminId: 'admin-1', id: 'admin-1', role: 'super_admin', scopes: ['mailer'] }

function makePost(body: unknown) {
  return new NextRequest('http://localhost/api/admin/campaigns/scenarios/dry-run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function makeMockClient(audienceRows: any[] = [], productRows: any[] = []) {
  return {
    query: vi.fn().mockImplementation((sql: string) => {
      if (sql === 'BEGIN READ ONLY') return Promise.resolve()
      if (sql.includes('statement_timeout')) return Promise.resolve()
      if (sql.includes('lock_timeout')) return Promise.resolve()
      if (sql.includes('idle_in_transaction')) return Promise.resolve()
      if (sql === 'ROLLBACK') return Promise.resolve()
      // audience query uses validation.normalized
      if (!sql.startsWith('SET')) {
        return Promise.resolve({ rows: audienceRows, rowCount: audienceRows.length })
      }
      return Promise.resolve({ rows: [], rowCount: 0 })
    }),
    release: vi.fn(),
  }
}

const validAudienceValidation = {
  ok: true,
  normalized: 'SELECT id FROM users WHERE ...',
}

const validProductValidation = {
  ok: true,
  normalized: 'SELECT name, price, image_url FROM products WHERE ...',
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/admin/campaigns/scenarios/dry-run', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue(ADMIN as any)
    mockHasScope.mockReturnValue(true)
    mockQuery.mockResolvedValue({ rows: [] } as any)
  })

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null as any)
    const res = await POST(makePost({ sql: 'SELECT id FROM users' }))
    expect(res.status).toBe(401)
    expect((await res.json()).error).toBe('Unauthorized')
  })

  it('returns 403 when scope missing', async () => {
    mockHasScope.mockReturnValue(false)
    const res = await POST(makePost({ sql: 'SELECT id FROM users' }))
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe('Insufficient permissions')
  })

  it('returns 400 when sql is missing', async () => {
    const res = await POST(makePost({}))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('sql is required')
  })

  it('returns 400 when sql is empty string', async () => {
    const res = await POST(makePost({ sql: '   ' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('sql is required')
  })

  it('returns 400 when audience SQL validation fails', async () => {
    mockValidateSql.mockReturnValueOnce({ ok: false, reason: 'Dangerous SQL detected' } as any)
    const res = await POST(makePost({ sql: 'DROP TABLE users' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('Dangerous SQL detected')
    // Should log to audit
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('dry_run_rejected'), expect.any(Array))
  })

  it('returns 400 when product_sql validation fails', async () => {
    mockValidateSql
      .mockReturnValueOnce(validAudienceValidation as any) // audience passes
      .mockReturnValueOnce({ ok: false, reason: 'Bad product SQL' } as any) // product fails
    const res = await POST(makePost({ sql: 'SELECT id FROM users', product_sql: 'DROP TABLE products' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('product_sql')
    expect(body.error).toContain('Bad product SQL')
  })

  it('runs dry-run and returns audience count and sample', async () => {
    mockValidateSql.mockReturnValueOnce(validAudienceValidation as any)
    const audienceRows = [{ id: 'u1' }, { id: 'u2' }, { id: 'u3' }]
    const client = makeMockClient(audienceRows)
    // Override client.query to handle the actual normalized query call
    client.query = vi.fn().mockImplementation((sql: string) => {
      if (sql === 'BEGIN READ ONLY') return Promise.resolve()
      if (sql.includes('statement_timeout')) return Promise.resolve()
      if (sql.includes('lock_timeout')) return Promise.resolve()
      if (sql.includes('idle_in_transaction')) return Promise.resolve()
      if (sql === 'ROLLBACK') return Promise.resolve()
      // The normalized audience query
      return Promise.resolve({ rows: audienceRows, rowCount: audienceRows.length })
    })
    mockGetClient.mockResolvedValueOnce(client as any)

    const res = await POST(makePost({ sql: 'SELECT id FROM users WHERE ...' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.count).toBe(3)
    expect(body.sample).toHaveLength(3)
    expect(body.productCount).toBe(0)
    expect(typeof body.elapsedMs).toBe('number')
    expect(client.release).toHaveBeenCalled()
  })

  it('runs dry-run with product_sql and returns both counts', async () => {
    mockValidateSql
      .mockReturnValueOnce(validAudienceValidation as any)
      .mockReturnValueOnce(validProductValidation as any)

    const audienceRows = [{ id: 'u1' }, { id: 'u2' }]
    const productRows = [{ name: 'Widget', price: 100, image_url: '/img/w.jpg' }]
    let callCount = 0
    const client = {
      query: vi.fn().mockImplementation((sql: string) => {
        if (sql === 'BEGIN READ ONLY') return Promise.resolve()
        if (sql.includes('statement_timeout')) return Promise.resolve()
        if (sql.includes('lock_timeout')) return Promise.resolve()
        if (sql.includes('idle_in_transaction')) return Promise.resolve()
        if (sql === 'ROLLBACK') return Promise.resolve()
        callCount++
        if (callCount === 1) {
          return Promise.resolve({ rows: audienceRows, rowCount: audienceRows.length })
        }
        return Promise.resolve({ rows: productRows, rowCount: productRows.length })
      }),
      release: vi.fn(),
    }
    mockGetClient.mockResolvedValueOnce(client as any)

    const res = await POST(
      makePost({ sql: 'SELECT id FROM users', product_sql: 'SELECT name, price, image_url FROM products' })
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.count).toBe(2)
    expect(body.productCount).toBe(1)
    expect(body.productSample[0].name).toBe('Widget')
  })

  it('returns 400 and logs when dry-run query fails', async () => {
    mockValidateSql.mockReturnValueOnce(validAudienceValidation as any)
    const client = {
      query: vi.fn().mockImplementation((sql: string) => {
        if (sql === 'BEGIN READ ONLY') return Promise.resolve()
        if (sql.includes('statement_timeout')) return Promise.resolve()
        if (sql.includes('lock_timeout')) return Promise.resolve()
        if (sql.includes('idle_in_transaction')) return Promise.resolve()
        if (sql === 'ROLLBACK') return Promise.resolve()
        return Promise.reject(Object.assign(new Error('Query timed out'), { code: '57014' }))
      }),
      release: vi.fn(),
    }
    mockGetClient.mockResolvedValueOnce(client as any)

    const res = await POST(makePost({ sql: 'SELECT id FROM users' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('timed out')
    expect(body.code).toBe('57014')
    // Audit log for failure
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('dry_run_failed'), expect.any(Array))
    expect(client.release).toHaveBeenCalled()
  })

  it('returns 400 on non-timeout query error', async () => {
    mockValidateSql.mockReturnValueOnce(validAudienceValidation as any)
    const client = {
      query: vi.fn().mockImplementation((sql: string) => {
        if (
          ['BEGIN READ ONLY', 'ROLLBACK'].includes(sql) ||
          sql.includes('timeout') ||
          sql.includes('lock_timeout') ||
          sql.includes('idle_in_transaction')
        ) {
          return Promise.resolve()
        }
        return Promise.reject(new Error('syntax error near FROM'))
      }),
      release: vi.fn(),
    }
    mockGetClient.mockResolvedValueOnce(client as any)

    const res = await POST(makePost({ sql: 'INVALID SQL' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('syntax error near FROM')
    expect(client.release).toHaveBeenCalled()
  })

  it('logs successful dry-run to audit table', async () => {
    mockValidateSql.mockReturnValueOnce(validAudienceValidation as any)
    const client = {
      query: vi.fn().mockImplementation((sql: string) => {
        if (
          ['BEGIN READ ONLY', 'ROLLBACK'].includes(sql) ||
          sql.includes('timeout') ||
          sql.includes('lock') ||
          sql.includes('idle')
        ) {
          return Promise.resolve()
        }
        return Promise.resolve({ rows: [{ id: 'u1' }], rowCount: 1 })
      }),
      release: vi.fn(),
    }
    mockGetClient.mockResolvedValueOnce(client as any)

    await POST(makePost({ sql: 'SELECT id FROM users' }))
    // Audit success log
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining("'dry_run'"), expect.any(Array))
  })
})
