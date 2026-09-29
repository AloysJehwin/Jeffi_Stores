import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── hoisted mocks ────────────────────────────────────────────────────────────
const { queryMock, queryManyMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  queryManyMock: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  query: queryMock,
  queryOne: vi.fn(),
  queryMany: queryManyMock,
  queryCount: vi.fn(),
}))

vi.mock('@/lib/jwt', () => ({
  authenticateUser: vi.fn().mockResolvedValue(null),
  authenticateAdmin: vi.fn().mockResolvedValue(null),
}))

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    get: vi.fn().mockReturnValue(undefined),
    set: vi.fn(),
    delete: vi.fn(),
  }),
  headers: vi.fn().mockResolvedValue(new Headers()),
}))

vi.mock('@/lib/search', () => ({
  buildProductSearchClause: vi.fn((_raw: string, _n: string, _s: string, _v: string, idx: number) => ({
    clause: 'TRUE',
    params: ['mock:*', 'mock query', 'mock%'],
    nextIdx: idx + 3,
  })),
  buildProductSearchRank: vi.fn((_raw: string, _n: string, _v: string, idx: number) => ({
    rank: '0',
    params: ['mock%', '%mock%', 'mock:*'],
    nextIdx: idx + 3,
  })),
  buildSearchClause: vi.fn((_raw: string, _cols: string[], idx: number) => ({
    clause: 'TRUE',
    params: ['%mock%'],
    nextIdx: idx + 1,
  })),
}))

vi.mock('@/lib/queries', () => ({
  VARIANT_MIN_PRICE_SQL: '(SELECT NULL)',
  VARIANT_MIN_PRICE_INCL_GST_SQL: '(SELECT NULL)',
  VARIANT_MIN_PRICE_EX_GST_SQL: '(SELECT NULL)',
  VARIANT_MIN_MRP_SQL: '(SELECT NULL)',
  VARIANT_STOCK_TOTAL_SQL: '0',
}))
vi.mock('@/lib/site-controls', () => ({
  getFeatureFlags: vi.fn().mockResolvedValue({
    razorpayEnabled: false,
    gstEnabled: false,
    ondeviceSummaryEnabled: false,
    ondeviceFinetuneEnabled: false,
  }),
}))

// ── import handler AFTER mocks ───────────────────────────────────────────────
import { GET } from '@/app/api/search/route'

// ── helpers ──────────────────────────────────────────────────────────────────
function makeReq(q?: string) {
  const url = new URL('http://localhost/api/search')
  if (q !== undefined) url.searchParams.set('q', q)
  const req = new Request(url.toString())
  // The search route accesses request.nextUrl.searchParams (Next.js extension).
  // Attach a nextUrl shim so tests don't hit undefined.
  Object.defineProperty(req, 'nextUrl', { value: url, writable: false })
  return req
}

const sampleProducts = [
  {
    id: 'prod-1',
    name: 'Hex Bolt M8',
    slug: 'hex-bolt-m8',
    base_price: '50.00',
    has_variants: false,
    categories: { id: 'cat-1', name: 'Bolts', slug: 'bolts' },
    product_images: [],
    variant_min_price: null,
  },
]

const sampleCategories = [{ id: 'cat-1', name: 'Bolts', slug: 'bolts' }]

describe('GET /api/search', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    queryManyMock.mockResolvedValue([])
    queryMock.mockResolvedValue({ rows: [], rowCount: 0 })
  })

  it('returns empty results for query shorter than 2 characters', async () => {
    const res = await GET(makeReq('a') as any)
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body).toEqual({ products: [], categories: [] })
    expect(queryManyMock).not.toHaveBeenCalled()
  })

  it('returns empty results when no query param provided', async () => {
    const res = await GET(makeReq('') as any)
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body).toEqual({ products: [], categories: [] })
  })

  it('returns products and categories for a valid query', async () => {
    queryManyMock
      .mockResolvedValueOnce(sampleProducts)
      .mockResolvedValueOnce(sampleCategories)

    const res = await GET(makeReq('bolt') as any)
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body).toHaveProperty('products')
    expect(body).toHaveProperty('categories')
    expect(body.products).toHaveLength(1)
    expect(body.categories).toHaveLength(1)
  })

  it('returns empty arrays when db returns null', async () => {
    queryManyMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)

    const res = await GET(makeReq('bolt') as any)
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.products).toEqual([])
    expect(body.categories).toEqual([])
  })

  it('handles special characters safely without throwing', async () => {
    queryManyMock.mockResolvedValue([])

    const res = await GET(makeReq("'; DROP TABLE products; --") as any)
    expect([200, 500]).toContain(res.status)
  })

  it('handles percent and wildcard characters without throwing', async () => {
    queryManyMock.mockResolvedValue([])

    const res = await GET(makeReq('%bolt%') as any)
    expect([200, 500]).toContain(res.status)
  })

  it('works for unauthenticated requests (no session cookie)', async () => {
    queryManyMock
      .mockResolvedValueOnce(sampleProducts)
      .mockResolvedValueOnce([])

    const res = await GET(makeReq('bolt') as any)
    expect(res.status).toBe(200)
  })

  it('returns response with products/categories keys even if db throws', async () => {
    queryManyMock.mockRejectedValue(new Error('DB error'))

    const res = await GET(makeReq('bolt') as any)
    expect([200, 500]).toContain(res.status)

    const body = await res.json()
    expect(body).toHaveProperty('products')
    expect(body).toHaveProperty('categories')
  })
})
