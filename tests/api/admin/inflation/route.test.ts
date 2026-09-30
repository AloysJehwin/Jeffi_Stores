import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks (hoisted before any imports) ────────────────────────────────────────

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
  withTransaction: vi.fn(),
}))
vi.mock('@/lib/shared/validate', async () => {
  const { z } = await import('zod')
  return {
    parseBody: vi.fn(),
    zUuid: z.string().uuid(),
  }
})

// ── Imports ────────────────────────────────────────────────────────────────────

import { GET, POST } from '@/app/api/admin/inflation/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { queryMany, withTransaction } from '@/lib/shared/db'
import { parseBody } from '@/lib/shared/validate'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockQueryMany = vi.mocked(queryMany)
const mockWithTx = vi.mocked(withTransaction)
const mockParseBody = vi.mocked(parseBody)

// ── Helpers ────────────────────────────────────────────────────────────────────

const admin = {
  adminId: 'a1',
  username: 'admin',
  role: 'super_admin',
  scopes: ['inflation'],
  first_name: 'Test',
  last_name: 'Admin',
}

function makeGet(params: Record<string, string> = {}) {
  const url = new URL('http://localhost/api/admin/inflation')
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))
  return new NextRequest(url)
}

function makePost(body: unknown) {
  return new NextRequest('http://localhost/api/admin/inflation', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const sampleProducts = [
  {
    id: 'p1',
    name: 'Hex Bolt M6',
    has_variants: false,
    mrp_ex_gst: '100',
    mrp: '118',
    price_ex_gst: '80',
    base_price: '94.40',
    discount_pct: '20',
    gst_percentage: '18',
    variants: [],
  },
]

const sampleProductWithVariants = [
  {
    id: 'p2',
    name: 'Bolt Set',
    has_variants: true,
    mrp_ex_gst: '0',
    mrp: '0',
    price_ex_gst: '0',
    base_price: '0',
    discount_pct: '0',
    gst_percentage: '18',
    variants: [
      {
        id: 'v1',
        variant_name: 'Small',
        mrp_ex_gst: '50',
        mrp: '59',
        price_ex_gst: '40',
        price: '47.20',
      },
    ],
  },
]

// ── GET tests ─────────────────────────────────────────────────────────────────

describe('GET /api/admin/inflation', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await GET(makeGet({ category_id: 'cat-1', percentage: '5' }))
    expect(res.status).toBe(401)
    const data = await res.json()
    expect(data.error).toBe('Unauthorized')
  })

  it('returns 403 when scope missing', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(false)
    const res = await GET(makeGet({ category_id: 'cat-1', percentage: '5' }))
    expect(res.status).toBe(403)
    const data = await res.json()
    expect(data.error).toMatch(/permissions/i)
  })

  it('returns 400 when category_id missing', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    const res = await GET(makeGet({ percentage: '5' }))
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toMatch(/category_id/i)
  })

  it('returns 400 when percentage missing', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    const res = await GET(makeGet({ category_id: 'cat-1' }))
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toMatch(/percentage/i)
  })

  it('returns 400 when percentage is 0', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    const res = await GET(makeGet({ category_id: 'cat-1', percentage: '0' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 when percentage is negative', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    const res = await GET(makeGet({ category_id: 'cat-1', percentage: '-5' }))
    expect(res.status).toBe(400)
  })

  it('returns preview for products without variants', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    mockQueryMany.mockResolvedValue(sampleProducts as any)

    const res = await GET(makeGet({ category_id: 'cat-1', percentage: '10' }))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.preview).toHaveLength(1)
    expect(data.count).toBe(1)
    const p = data.preview[0]
    expect(p.id).toBe('p1')
    expect(p.current.mrp_ex_gst).toBe(100)
    // 100 * 1.10 = 110 new mrp_ex_gst
    expect(p.projected.mrp_ex_gst).toBe(110)
  })

  it('handles products with zero mrp_ex_gst gracefully', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    mockQueryMany.mockResolvedValue(sampleProductWithVariants as any)

    const res = await GET(makeGet({ category_id: 'cat-1', percentage: '5' }))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.preview).toHaveLength(1)
    // product itself has no mrp_ex_gst, projected should be null
    expect(data.preview[0].projected.mrp_ex_gst).toBeNull()
    // variant has mrp_ex_gst=50
    expect(data.preview[0].variants[0].projected.mrp_ex_gst).toBe(52.5)
  })

  it('returns empty preview when no products found', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    mockQueryMany.mockResolvedValue([])

    const res = await GET(makeGet({ category_id: 'cat-1', percentage: '5' }))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.preview).toHaveLength(0)
    expect(data.count).toBe(0)
  })

  it('supports product_ids filter', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    mockQueryMany.mockResolvedValue(sampleProducts as any)

    const res = await GET(makeGet({ category_id: 'cat-1', percentage: '5', product_ids: 'p1,p2' }))
    expect(res.status).toBe(200)
    expect(mockQueryMany).toHaveBeenCalledWith(expect.any(String), ['cat-1', ['p1', 'p2']])
  })
})

// ── POST tests ────────────────────────────────────────────────────────────────

describe('POST /api/admin/inflation', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  const validBody = {
    category_id: 'cat-1',
    category_name: 'Bolts',
    percentage: 5,
  }

  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await POST(makePost(validBody))
    expect(res.status).toBe(401)
  })

  it('returns 403 when scope missing', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(false)
    const res = await POST(makePost(validBody))
    expect(res.status).toBe(403)
  })

  it('returns 400 when category_id missing', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    mockParseBody.mockReturnValue({ ok: true, data: { percentage: 5, categoryId: null } } as any)
    const res = await POST(makePost({ category_name: 'Bolts', percentage: 5 }))
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toMatch(/category_id/i)
  })

  it('returns 400 when category_name missing', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    mockParseBody.mockReturnValue({ ok: true, data: { percentage: 5, categoryId: 'cat-1' } } as any)
    const res = await POST(makePost({ category_id: 'cat-1', percentage: 5 }))
    expect(res.status).toBe(400)
  })

  it('returns validation error when parseBody fails', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    const errorResponse = new Response(JSON.stringify({ error: 'Invalid' }), { status: 422 })
    mockParseBody.mockReturnValue({ ok: false, response: errorResponse } as any)
    const res = await POST(makePost(validBody))
    expect(res.status).toBe(422)
  })

  it('returns 400 when no active products found', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    mockParseBody.mockReturnValue({ ok: true, data: { percentage: 5, categoryId: 'cat-1' } } as any)
    mockQueryMany.mockResolvedValue([])

    const res = await POST(makePost(validBody))
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toMatch(/no active products/i)
  })

  it('applies inflation successfully and returns product_count', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    mockParseBody.mockReturnValue({ ok: true, data: { percentage: 5, categoryId: 'cat-1' } } as any)
    mockQueryMany.mockResolvedValue(sampleProducts as any)

    const mockClient = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
    }
    mockWithTx.mockImplementation(async (fn: any) => fn(mockClient))

    const res = await POST(makePost(validBody))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.success).toBe(true)
    expect(data.product_count).toBe(1)
  })

  it('applies inflation with variants correctly', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    mockParseBody.mockReturnValue({ ok: true, data: { percentage: 10, categoryId: 'cat-1' } } as any)
    mockQueryMany.mockResolvedValue(sampleProducts as any)

    const mockClient = {
      query: vi.fn().mockImplementation((sql: string) => {
        if (sql.includes('product_variants pv')) {
          return {
            rows: [
              {
                id: 'v1',
                product_id: 'p1',
                variant_name: 'Small',
                mrp_ex_gst: '50',
                mrp: '59',
                price_ex_gst: '40',
                price: '47.20',
                discount_pct: '20',
                gst_percentage: '18',
              },
            ],
          }
        }
        if (sql.includes('product_sub_variants psv')) {
          return { rows: [] }
        }
        return { rows: [] }
      }),
    }
    mockWithTx.mockImplementation(async (fn: any) => fn(mockClient))

    const res = await POST(makePost({ ...validBody, percentage: 10 }))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.success).toBe(true)
  })

  it('returns 500 on transaction error', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    mockParseBody.mockReturnValue({ ok: true, data: { percentage: 5, categoryId: 'cat-1' } } as any)
    mockQueryMany.mockResolvedValue(sampleProducts as any)
    mockWithTx.mockRejectedValue(new Error('DB connection lost'))

    const res = await POST(makePost(validBody))
    expect(res.status).toBe(500)
    const data = await res.json()
    expect(data.error).toMatch(/DB connection lost/i)
  })

  it('uses filtered product_ids when provided', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    mockParseBody.mockReturnValue({ ok: true, data: { percentage: 5, categoryId: 'cat-1' } } as any)
    mockQueryMany.mockResolvedValue(sampleProducts as any)

    const mockClient = { query: vi.fn().mockResolvedValue({ rows: [] }) }
    mockWithTx.mockImplementation(async (fn: any) => fn(mockClient))

    const res = await POST(makePost({ ...validBody, product_ids: ['p1', 'p2'] }))
    expect(res.status).toBe(200)
    expect(mockQueryMany).toHaveBeenCalledWith(expect.any(String), ['cat-1', ['p1', 'p2']])
  })

  it('passes null for product_ids when empty array provided', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    mockParseBody.mockReturnValue({ ok: true, data: { percentage: 5, categoryId: 'cat-1' } } as any)
    mockQueryMany.mockResolvedValue(sampleProducts as any)

    const mockClient = { query: vi.fn().mockResolvedValue({ rows: [] }) }
    mockWithTx.mockImplementation(async (fn: any) => fn(mockClient))

    const res = await POST(makePost({ ...validBody, product_ids: [] }))
    expect(res.status).toBe(200)
    expect(mockQueryMany).toHaveBeenCalledWith(expect.any(String), ['cat-1', null])
  })
})
