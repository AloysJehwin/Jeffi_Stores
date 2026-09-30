import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/shared/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
  withTransaction: vi.fn(),
}))

vi.mock('@/lib/auth/jwt', () => ({
  authenticateAdmin: vi.fn(),
}))

vi.mock('@/lib/auth/scopes', () => ({
  hasScope: vi.fn(),
}))

import { POST } from '@/app/api/admin/inflation/rollback/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { queryOne, withTransaction } from '@/lib/shared/db'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockQueryOne = vi.mocked(queryOne)
const mockWithTx = vi.mocked(withTransaction)

const admin = {
  adminId: 'a1',
  username: 'admin',
  role: 'super_admin',
  scopes: ['inflation'],
  first_name: 'Test',
  last_name: 'Admin',
}

function makeReq(body: any) {
  return new NextRequest('http://localhost/api/admin/inflation/rollback', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

const validLog = {
  id: 'log-1',
  category_id: 'cat-1',
  category_name: 'Bolts',
  percentage: 5,
  applied_fields: ['mrp'],
  is_rollback: false,
  rolled_back_at: null,
  snapshot: [{ id: 'p1', before: { mrp: 100 }, variants: [] }],
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('POST /api/admin/inflation/rollback', () => {
  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await POST(makeReq({ log_id: 'log-1' }))
    expect(res.status).toBe(401)
  })

  it('returns 403 when scope missing', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(false)
    const res = await POST(makeReq({ log_id: 'log-1' }))
    expect(res.status).toBe(403)
  })

  it('returns 400 when log_id missing', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    const res = await POST(makeReq({}))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/log_id/)
  })

  it('returns 404 when log entry not found', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue(null)
    const res = await POST(makeReq({ log_id: 'log-1' }))
    expect(res.status).toBe(404)
  })

  it('returns 400 when already rolled back', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue({ ...validLog, rolled_back_at: '2024-01-01' })
    const res = await POST(makeReq({ log_id: 'log-1' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/rolled back/)
  })

  it('returns 400 when entry is itself a rollback', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue({ ...validLog, is_rollback: true })
    const res = await POST(makeReq({ log_id: 'log-1' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/rollback/)
  })

  it('returns 400 when no snapshot available', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue({ ...validLog, snapshot: [] })
    const res = await POST(makeReq({ log_id: 'log-1' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/snapshot/)
  })

  it('executes rollback successfully', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue(validLog)
    const mockClient = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
    }
    mockWithTx.mockImplementation(async (fn: any) => fn(mockClient))
    const res = await POST(makeReq({ log_id: 'log-1' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.product_count).toBe(1)
  })

  it('rolls back variant prices when snapshot contains variants with before values', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    const logWithVariants = {
      ...validLog,
      snapshot: [
        {
          id: 'p1',
          before: { mrp: 200, base_price: 180 },
          variants: [
            { id: 'v1', before: { mrp: 210, base_price: 190 } },
            { id: 'v2', before: { mrp: 220 } },
          ],
        },
      ],
    }
    mockQueryOne.mockResolvedValue(logWithVariants)
    const mockClient = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
    }
    mockWithTx.mockImplementation(async (fn: any) => fn(mockClient))
    const res = await POST(makeReq({ log_id: 'log-1' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    // Verify variant UPDATE was called: set_config + product UPDATE + 2x variant UPDATE + log UPDATE + log INSERT = 6 calls
    const updateCalls = mockClient.query.mock.calls.filter(
      (c: any[]) => typeof c[0] === 'string' && c[0].includes('UPDATE product_variants')
    )
    expect(updateCalls.length).toBe(2)
  })

  it('skips variant UPDATE when variant has no applicable before values', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    const logWithEmptyVariantBefore = {
      ...validLog,
      snapshot: [
        {
          id: 'p1',
          before: { mrp: 100 },
          variants: [
            { id: 'v1', before: {} }, // no before values — setClauses empty, no UPDATE
          ],
        },
      ],
    }
    mockQueryOne.mockResolvedValue(logWithEmptyVariantBefore)
    const mockClient = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
    }
    mockWithTx.mockImplementation(async (fn: any) => fn(mockClient))
    const res = await POST(makeReq({ log_id: 'log-1' }))
    expect(res.status).toBe(200)
    const variantUpdates = mockClient.query.mock.calls.filter(
      (c: any[]) => typeof c[0] === 'string' && c[0].includes('UPDATE product_variants')
    )
    expect(variantUpdates).toHaveLength(0)
  })

  it('returns 500 when withTransaction throws', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue(validLog)
    mockWithTx.mockRejectedValue(new Error('Transaction failed'))
    const res = await POST(makeReq({ log_id: 'log-1' }))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe('Transaction failed')
  })

  it('skips product UPDATE when snapshot product has no applicable before values', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    const logNoProductBefore = {
      ...validLog,
      snapshot: [{ id: 'p1', before: {}, variants: [] }],
    }
    mockQueryOne.mockResolvedValue(logNoProductBefore)
    const mockClient = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
    }
    mockWithTx.mockImplementation(async (fn: any) => fn(mockClient))
    const res = await POST(makeReq({ log_id: 'log-1' }))
    expect(res.status).toBe(200)
    const productUpdates = mockClient.query.mock.calls.filter(
      (c: any[]) => typeof c[0] === 'string' && c[0].includes('UPDATE products SET')
    )
    expect(productUpdates).toHaveLength(0)
  })
})
