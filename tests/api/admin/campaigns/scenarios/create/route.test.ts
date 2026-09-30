import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks (before imports) ────────────────────────────────────────────────────

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({ query: vi.fn(), queryOne: vi.fn(), withTransaction: vi.fn() }))
vi.mock('@/lib/campaigns/sql-safety', () => ({ validateScenarioSql: vi.fn() }))

// ── Imports ───────────────────────────────────────────────────────────────────

import { POST } from '@/app/api/(admin)/admin/campaigns/scenarios/create/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { query, queryOne, withTransaction } from '@/lib/shared/db'
import { validateScenarioSql } from '@/lib/campaigns/sql-safety'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockQuery = vi.mocked(query)
const mockQueryOne = vi.mocked(queryOne)
const mockWithTransaction = vi.mocked(withTransaction)
const mockValidateSql = vi.mocked(validateScenarioSql)

// ── Helpers ───────────────────────────────────────────────────────────────────

const admin = { adminId: 'admin-1', username: 'testadmin', id: 'admin-uuid-1', role: 'super_admin', scopes: ['mailer'] }

function makeRequest(body: unknown) {
  return new NextRequest('http://localhost/api/admin/campaigns/scenarios/create', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const validBody = {
  name: 'Cart Abandon Scenario',
  ai_prompt: 'Generate SQL to find users who abandoned cart',
  generated_sql: 'SELECT id FROM users WHERE 1=1',
  dry_run_count: 42,
}

const okValidation = {
  ok: true,
  normalized: 'SELECT id FROM users WHERE 1=1',
  tablesReferenced: ['users'],
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/admin/campaigns/scenarios/create', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await POST(makeRequest(validBody))
    expect(res.status).toBe(401)
    expect((await res.json()).error).toMatch(/unauthorized/i)
  })

  it('returns 403 when scope missing', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(false)
    const res = await POST(makeRequest(validBody))
    expect(res.status).toBe(403)
  })

  it('returns 400 when name is missing', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    const { name, ...noName } = validBody
    const res = await POST(makeRequest(noName))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/name is required/i)
  })

  it('returns 400 when ai_prompt is missing', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    const { ai_prompt, ...noPrompt } = validBody
    const res = await POST(makeRequest(noPrompt))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/ai_prompt is required/i)
  })

  it('returns 400 when generated_sql is missing', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    const { generated_sql, ...noSql } = validBody
    const res = await POST(makeRequest(noSql))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/generated_sql is required/i)
  })

  it('returns 400 when dry_run_count is missing', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    const { dry_run_count, ...noDry } = validBody
    const res = await POST(makeRequest(noDry))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/dry.run.count/i)
  })

  it('returns 400 when SQL validation fails and logs audit row', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockValidateSql.mockReturnValue({ ok: false, reason: 'contains DROP TABLE', matched: 'DROP' })
    mockQuery.mockResolvedValue(undefined as any)

    const res = await POST(makeRequest(validBody))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/contains drop table/i)
    // should have inserted audit log — action is hardcoded in SQL, params are [adminId, kind, sql, jsonb]
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('scenario_audit_log'),
      expect.arrayContaining([admin.id])
    )
  })

  it('returns 400 when product_sql validation fails', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    // First call (audience sql) succeeds, second (product_sql) fails
    mockValidateSql
      .mockReturnValueOnce(okValidation as any)
      .mockReturnValueOnce({ ok: false, reason: 'invalid product sql', matched: undefined })

    const res = await POST(makeRequest({ ...validBody, product_sql: 'DROP TABLE products' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/product_sql/i)
  })

  it('returns 409 when scenario kind already exists', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockValidateSql.mockReturnValue(okValidation as any)
    mockQueryOne.mockResolvedValue({ kind: 'cart_abandon_scenario' }) // already exists

    const res = await POST(makeRequest(validBody))
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/already exists/i)
  })

  it('creates scenario and returns success on happy path', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockValidateSql.mockReturnValue(okValidation as any)
    mockQueryOne.mockResolvedValue(null) // kind is free

    const mockClient = { query: vi.fn().mockResolvedValue(undefined) }
    mockWithTransaction.mockImplementation(async cb => {
      await cb(mockClient as any)
    })
    mockQuery.mockResolvedValue(undefined as any)

    const res = await POST(makeRequest(validBody))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.kind).toBe('cart_abandon_scenario')
  })

  it('slugifies name to derive kind when no explicit kind provided', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockValidateSql.mockReturnValue(okValidation as any)
    mockQueryOne.mockResolvedValue(null)

    const mockClient = { query: vi.fn().mockResolvedValue(undefined) }
    mockWithTransaction.mockImplementation(async cb => {
      await cb(mockClient as any)
    })
    mockQuery.mockResolvedValue(undefined as any)

    const res = await POST(makeRequest({ ...validBody, name: 'Hello World!! 2024' }))
    const body = await res.json()
    expect(body.kind).toMatch(/^[a-z0-9_]+$/)
    expect(body.kind).toBe('hello_world_2024')
  })

  it('uses explicit kind field when provided', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockValidateSql.mockReturnValue(okValidation as any)
    mockQueryOne.mockResolvedValue(null)

    const mockClient = { query: vi.fn().mockResolvedValue(undefined) }
    mockWithTransaction.mockImplementation(async cb => {
      await cb(mockClient as any)
    })
    mockQuery.mockResolvedValue(undefined as any)

    const res = await POST(makeRequest({ ...validBody, kind: 'my_custom_kind' }))
    const body = await res.json()
    expect(body.kind).toBe('my_custom_kind')
  })

  it('accepts optional product_sql and normalizes it', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockValidateSql.mockReturnValueOnce(okValidation as any).mockReturnValueOnce({
      ok: true,
      normalized: 'SELECT id FROM products WHERE 1=1',
      tablesReferenced: ['products'],
    } as any)
    mockQueryOne.mockResolvedValue(null)

    const mockClient = { query: vi.fn().mockResolvedValue(undefined) }
    mockWithTransaction.mockImplementation(async cb => {
      await cb(mockClient as any)
    })
    mockQuery.mockResolvedValue(undefined as any)

    const res = await POST(makeRequest({ ...validBody, product_sql: 'SELECT id FROM products WHERE 1=1' }))
    expect(res.status).toBe(200)
    expect(mockClient.query).toHaveBeenCalledTimes(2)
  })

  it('returns 500 when transaction throws', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockValidateSql.mockReturnValue(okValidation as any)
    mockQueryOne.mockResolvedValue(null)
    mockWithTransaction.mockRejectedValue(new Error('deadlock detected'))

    const res = await POST(makeRequest(validBody))
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/deadlock detected/i)
  })

  it('inserts audit log on success (fire-and-forget)', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockValidateSql.mockReturnValue(okValidation as any)
    mockQueryOne.mockResolvedValue(null)

    const mockClient = { query: vi.fn().mockResolvedValue(undefined) }
    mockWithTransaction.mockImplementation(async cb => {
      await cb(mockClient as any)
    })
    mockQuery.mockResolvedValue(undefined as any)

    await POST(makeRequest(validBody))
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining("'save'"), expect.any(Array))
  })
})
