import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/scopes', () => ({ hasScope: vi.fn().mockReturnValue(true) }))

const mockQueryMany = vi.fn()
const mockQueryOne = vi.fn()
const mockClientQuery = vi.fn()
vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: (...a: any[]) => mockQueryOne(...a),
  queryMany: (...a: any[]) => mockQueryMany(...a),
  withTransaction: (fn: any) => fn({ query: (...a: any[]) => mockClientQuery(...a) }),
}))

import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { query } from '@/lib/db'
import { GET, PUT, POST } from '@/app/api/admin/product-offers/[id]/products/route'

const admin = { id: 'a1', role: 'super_admin', scopes: [] }
const params = Promise.resolve({ id: '11111111-1111-1111-1111-111111111111' })
const P1 = '22222222-2222-4222-8222-222222222222'
const P2 = '33333333-3333-4333-9333-333333333333'

function req(method: string, body?: unknown) {
  return new NextRequest('http://localhost/api/admin/product-offers/x/products', {
    method,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('GET /api/admin/product-offers/[id]/products', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateAdmin).mockResolvedValue(admin as any)
    vi.mocked(hasScope).mockReturnValue(true)
  })

  it('401 unauthenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    const res = await GET(req('GET'), { params })
    expect(res.status).toBe(401)
  })

  it('403 insufficient scope', async () => {
    vi.mocked(hasScope).mockReturnValue(false)
    const res = await GET(req('GET'), { params })
    expect(res.status).toBe(403)
  })

  it('404 when offer missing', async () => {
    mockQueryOne.mockResolvedValueOnce(null)
    const res = await GET(req('GET'), { params })
    expect(res.status).toBe(404)
  })

  it('returns assigned products', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'o1' })
    mockQueryMany.mockResolvedValueOnce([{ id: P1, name: 'A', sku: 'S1', image_url: null }])
    const res = await GET(req('GET'), { params })
    const data = await res.json()
    expect(res.status).toBe(200)
    expect(data.products).toHaveLength(1)
  })
})

describe('PUT /api/admin/product-offers/[id]/products', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateAdmin).mockResolvedValue(admin as any)
    vi.mocked(hasScope).mockReturnValue(true)
  })

  it('401 unauthenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    const res = await PUT(req('PUT', { productIds: [] }), { params })
    expect(res.status).toBe(401)
  })

  it('403 insufficient scope', async () => {
    vi.mocked(hasScope).mockReturnValue(false)
    const res = await PUT(req('PUT', { productIds: [] }), { params })
    expect(res.status).toBe(403)
  })

  it('400 on invalid body (non-uuid)', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'o1' })
    const res = await PUT(req('PUT', { productIds: ['not-a-uuid'] }), { params })
    expect(res.status).toBe(400)
  })

  it('replaces membership: delete then insert', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'o1' })
    mockClientQuery.mockResolvedValue({})
    const res = await PUT(req('PUT', { productIds: [P1, P2] }), { params })
    const data = await res.json()
    expect(res.status).toBe(200)
    expect(data.count).toBe(2)
    expect(mockClientQuery.mock.calls[0][0]).toContain('DELETE FROM product_offer_items')
    expect(mockClientQuery.mock.calls[1][0]).toContain('INSERT INTO product_offer_items')
    expect(mockClientQuery.mock.calls[1][1]).toEqual([(await params).id, [P1, P2]])
  })

  it('empty list clears membership without an insert', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'o1' })
    mockClientQuery.mockResolvedValue({})
    const res = await PUT(req('PUT', { productIds: [] }), { params })
    expect(res.status).toBe(200)
    expect(mockClientQuery).toHaveBeenCalledTimes(1)
    expect(mockClientQuery.mock.calls[0][0]).toContain('DELETE')
  })
})

describe('POST /api/admin/product-offers/[id]/products (bulk by category or brand)', () => {
  const CATEGORY = '44444444-4444-4444-8444-444444444444'
  const SEEDED_BRAND = '22222222-2222-2222-2222-222222222221'

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateAdmin).mockResolvedValue(admin as any)
    vi.mocked(hasScope).mockReturnValue(true)
    mockQueryOne.mockImplementation(async (sql: string) => (sql.includes('count(*)') ? { n: 12 } : { id: 'o1' }))
    vi.mocked(query).mockResolvedValue({ rowCount: 5 } as any)
  })

  it('401 unauthenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    const res = await POST(req('POST', { action: 'add', categoryId: CATEGORY }), { params })
    expect(res.status).toBe(401)
  })

  it('403 insufficient scope', async () => {
    vi.mocked(hasScope).mockReturnValue(false)
    const res = await POST(req('POST', { action: 'add', categoryId: CATEGORY }), { params })
    expect(res.status).toBe(403)
  })

  it('404 when offer missing', async () => {
    mockQueryOne.mockResolvedValueOnce(null)
    const res = await POST(req('POST', { action: 'add', categoryId: CATEGORY }), { params })
    expect(res.status).toBe(404)
  })

  it('400 unless exactly one of categoryId or brandId is given', async () => {
    expect((await POST(req('POST', { action: 'add' }), { params })).status).toBe(400)
    const both = await POST(req('POST', { action: 'add', categoryId: CATEGORY, brandId: SEEDED_BRAND }), { params })
    expect(both.status).toBe(400)
    expect(query).not.toHaveBeenCalled()
  })

  it('adds a category with its active subcategories, skipping inactive products and existing members', async () => {
    const res = await POST(req('POST', { action: 'add', categoryId: CATEGORY }), { params })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ changed: 5, total: 12 })
    const [sql, args] = vi.mocked(query).mock.calls[0]
    expect(sql).toContain('WITH RECURSIVE tree')
    expect(sql).toContain('c.is_active = true')
    expect(sql).toContain('INSERT INTO product_offer_items')
    expect(sql).toContain('p.is_active = true')
    expect(sql).toContain('ON CONFLICT DO NOTHING')
    expect(args).toEqual([(await params).id, CATEGORY])
  })

  it('removes a brand, accepting seeded non-RFC brand ids', async () => {
    const res = await POST(req('POST', { action: 'remove', brandId: SEEDED_BRAND }), { params })
    expect(res.status).toBe(200)
    const [sql, args] = vi.mocked(query).mock.calls[0]
    expect(sql).toContain('DELETE FROM product_offer_items')
    expect(sql).toContain('p.brand_id = $2')
    expect(sql).not.toContain('RECURSIVE')
    expect(args).toEqual([(await params).id, SEEDED_BRAND])
  })
})
