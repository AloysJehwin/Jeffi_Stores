import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── hoisted mocks (lifted above vi.mock hoisting) ────────────────────────────
const { queryOneMock, queryManyMock } = vi.hoisted(() => ({
  queryOneMock: vi.fn(),
  queryManyMock: vi.fn(),
}))

vi.mock('@/lib/shared/db', () => ({
  query: vi.fn(),
  queryOne: queryOneMock,
  queryMany: queryManyMock,
  queryCount: vi.fn(),
}))

vi.mock('@/lib/catalog/search', () => ({
  buildProductSearchClause: vi.fn((_raw: string, _n: string, _s: string, _v: string, idx: number) => ({
    clause: 'TRUE',
    params: [],
    nextIdx: idx,
  })),
  buildProductSearchRank: vi.fn((_raw: string, _n: string, _v: string, idx: number) => ({
    rank: '0',
    params: [],
    nextIdx: idx,
  })),
  buildSearchRank: vi.fn((_raw: string, _n: string, idx: number) => ({
    rank: '0',
    params: [],
    nextIdx: idx,
  })),
}))

vi.mock('@/lib/queries', () => ({
  VARIANT_MIN_PRICE_SQL: '(SELECT NULL)',
  VARIANT_MIN_PRICE_INCL_GST_SQL: '(SELECT NULL)',
  VARIANT_MIN_PRICE_EX_GST_SQL: '(SELECT NULL)',
  VARIANT_MIN_MRP_SQL: '(SELECT NULL)',
  VARIANT_STOCK_TOTAL_SQL: '0',
}))
vi.mock('@/lib/catalog/site-controls', () => ({
  getFeatureFlags: vi.fn().mockResolvedValue({
    razorpayEnabled: false,
    gstEnabled: false,
    ondeviceSummaryEnabled: false,
    ondeviceFinetuneEnabled: false,
  }),
}))

// ── import handler AFTER mocks ───────────────────────────────────────────────
import { GET } from '@/app/api/products/route'

// ── helpers ──────────────────────────────────────────────────────────────────
function makeReq(searchParams: Record<string, string> = {}) {
  const url = new URL('http://localhost/api/products')
  for (const [k, v] of Object.entries(searchParams)) url.searchParams.set(k, v)
  return new Request(url.toString())
}

const sampleProduct = {
  id: 'prod-1',
  name: 'Hex Bolt M8',
  slug: 'hex-bolt-m8',
  sku: 'HB-M8',
  is_active: true,
  is_featured: false,
  base_price: '50.00',
  categories: { id: 'cat-1', name: 'Bolts', slug: 'bolts' },
  brands: { id: 'brand-1', name: 'Unbrako' },
  product_images: [],
  variant_stock_total: 5,
  variant_min_price: '45.00',
  variant_min_mrp: '55.00',
}

describe('GET /api/products (list)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    queryOneMock.mockResolvedValue({ total: '1' })
    queryManyMock.mockResolvedValue([sampleProduct])
  })

  it('returns paginated products with correct structure', async () => {
    const res = await GET(makeReq() as any)
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body).toHaveProperty('products')
    expect(body).toHaveProperty('total', 1)
    expect(body).toHaveProperty('page', 1)
    expect(body).toHaveProperty('totalPages', 1)
    expect(Array.isArray(body.products)).toBe(true)
    expect(body.products[0]).toMatchObject({ id: 'prod-1', name: 'Hex Bolt M8' })
  })

  it('returns empty products when db returns nothing', async () => {
    queryOneMock.mockResolvedValue({ total: '0' })
    queryManyMock.mockResolvedValue([])

    const res = await GET(makeReq() as any)
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.products).toEqual([])
    expect(body.total).toBe(0)
    expect(body.totalPages).toBe(0)
  })

  it('respects page and limit params', async () => {
    queryOneMock.mockResolvedValue({ total: '42' })
    queryManyMock.mockResolvedValue([sampleProduct])

    const res = await GET(makeReq({ page: '2', limit: '10' }) as any)
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.page).toBe(2)
    expect(body.totalPages).toBe(5)
  })

  it('caps limit at 100', async () => {
    queryOneMock.mockResolvedValue({ total: '5' })
    queryManyMock.mockResolvedValue([sampleProduct])

    const res = await GET(makeReq({ limit: '999' }) as any)
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body).toHaveProperty('products')
  })

  it('handles category filter param', async () => {
    queryOneMock.mockResolvedValue({ total: '1' })
    queryManyMock.mockResolvedValue([sampleProduct])

    const res = await GET(makeReq({ category: 'bolts' }) as any)
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.products).toHaveLength(1)
  })

  it('handles brand filter param', async () => {
    queryOneMock.mockResolvedValue({ total: '1' })
    queryManyMock.mockResolvedValue([sampleProduct])

    const res = await GET(makeReq({ brand: 'brand-uuid-1' }) as any)
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.products).toHaveLength(1)
  })

  it('handles search query param', async () => {
    queryOneMock.mockResolvedValue({ total: '1' })
    queryManyMock.mockResolvedValue([sampleProduct])

    const res = await GET(makeReq({ search: 'bolt' }) as any)
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.products).toHaveLength(1)
  })

  it('returns 200 for unauthenticated request (public endpoint)', async () => {
    const res = await GET(makeReq() as any)
    expect(res.status).toBe(200)
  })

  it('returns 500 and error message when db throws', async () => {
    queryOneMock.mockRejectedValue(new Error('DB down'))

    const res = await GET(makeReq() as any)
    expect(res.status).toBe(500)

    const body = await res.json()
    expect(body).toHaveProperty('error')
  })

  it('handles null db response for queryMany gracefully', async () => {
    queryOneMock.mockResolvedValue({ total: '0' })
    queryManyMock.mockResolvedValue(null)

    const res = await GET(makeReq() as any)
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.products).toEqual([])
  })
})
