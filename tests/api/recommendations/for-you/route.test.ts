import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks (must precede imports) ───────────────────────────────────────────

vi.mock('@/lib/shared/db', () => ({ query: vi.fn() }))
vi.mock('@/lib/auth/jwt', () => ({ authenticateUser: vi.fn() }))
vi.mock('@/lib/catalog/recommendations', () => ({
  getFeaturedForUser: vi.fn(),
  getBestSellerCards: vi.fn(),
}))

// ── Imports ────────────────────────────────────────────────────────────────

import { GET } from '@/app/api/(public)/recommendations/for-you/route'
import { query } from '@/lib/shared/db'
import { authenticateUser } from '@/lib/auth/jwt'
import { getFeaturedForUser, getBestSellerCards } from '@/lib/catalog/recommendations'

const mockQuery = vi.mocked(query)
const mockAuth = vi.mocked(authenticateUser)
const mockFeatured = vi.mocked(getFeaturedForUser)
const mockBestSellers = vi.mocked(getBestSellerCards)

function makeReq() {
  return new NextRequest('http://localhost/api/recommendations/for-you')
}

// A fully-populated card row exercising the "has variants" branches
const cardWithVariants = {
  id: 'p1',
  name: 'Bolt',
  slug: 'bolt',
  has_variants: true,
  variant_min_price: '99',
  variant_stock_total: '5',
  base_price: '120',
  stock_status: 'In Stock',
  mrp: null,
  variant_min_mrp: '150',
  discount_pct: '10',
  extra_delivery_days: '1',
  handling_days: '3',
  product_images: [
    { image_url: 'a.jpg', thumbnail_url: 'a-thumb.jpg', is_primary: false },
    { image_url: 'b.jpg', thumbnail_url: 'b-thumb.jpg', is_primary: true },
  ],
  brands: { name: 'Acme' },
  categories: { name: 'Fasteners' },
}

// A simple product without variants exercising the other branches
const cardSimple = {
  id: 'p2',
  name: 'Nut',
  slug: 'nut',
  has_variants: false,
  variant_min_price: null,
  variant_stock_total: null,
  base_price: '50',
  stock_status: 'Out of Stock',
  mrp: '80',
  variant_min_mrp: null,
  discount_pct: null,
  extra_delivery_days: null,
  handling_days: null,
  product_images: [],
  brands: null,
  categories: null,
}

describe('GET /api/recommendations/for-you', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 } as any)
  })

  it('logged-out → returns best-seller fallback cards', async () => {
    mockAuth.mockResolvedValue(null as any)
    mockBestSellers.mockResolvedValue([cardWithVariants, cardSimple] as any)

    const res = await GET(makeReq())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.source).toBe('bestsellers')
    expect(body.curated).toBe(false)
    expect(body.fallback).toBe(true)
    expect(body.products).toHaveLength(2)
    // has-variants card: displayPrice from variant_min_price, mrp from variant_min_mrp
    expect(body.products[0].displayPrice).toBe(99)
    expect(body.products[0].mrp).toBe(150)
    expect(body.products[0].mrpDiscount).toBe(34) // round((150-99)/150*100)
    expect(body.products[0].effectiveStock).toBe(5)
    expect(body.products[0].primaryImage.image_url).toBe('b.jpg') // is_primary chosen
    expect(body.products[0].brandName).toBe('Acme')
    expect(body.products[0].categoryName).toBe('Fasteners')
    // simple out-of-stock card: displayPrice from base_price, stock 0
    expect(body.products[1].displayPrice).toBe(50)
    expect(body.products[1].effectiveStock).toBe(0)
    expect(body.products[1].mrp).toBe(80)
    expect(body.products[1].primaryImage).toBeNull()
    expect(body.products[1].brandName).toBeNull()
    expect(body.products[1].handlingDays).toBe(2) // default fallback
    expect(mockBestSellers).toHaveBeenCalledWith(8)
  })

  it('logged-in → returns curated featured recommendations and logs analytics', async () => {
    mockAuth.mockResolvedValue({ userId: 'u1' } as any)
    mockFeatured.mockResolvedValue({
      products: [cardSimple],
      source: 'ai',
      curated: true,
      seedQuery: 'bolts and nuts',
      candidateCount: 20,
      responseMs: 120,
      model: 'gpt',
      promptTokens: 100,
      completionTokens: 50,
    } as any)

    const res = await GET(makeReq())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.source).toBe('ai')
    expect(body.curated).toBe(true)
    expect(body.products).toHaveLength(1)
    expect(mockQuery).toHaveBeenCalledOnce()
    // curated → error column should be null (10th param)
    const args = mockQuery.mock.calls[0][1] as any[]
    expect(args[9]).toBeNull()
  })

  it('logged-in uncurated → logs error text and uses rec:source model fallback', async () => {
    mockAuth.mockResolvedValue({ userId: 'u1' } as any)
    mockFeatured.mockResolvedValue({
      products: [],
      source: 'fallback',
      curated: false,
      seedQuery: 'x',
      candidateCount: 0,
      responseMs: null,
      model: null,
      promptTokens: null,
      completionTokens: null,
    } as any)

    const res = await GET(makeReq())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.curated).toBe(false)
    const args = mockQuery.mock.calls[0][1] as any[]
    expect(args[5]).toBe('rec:fallback') // model fallback
    expect(args[9]).toMatch(/uncurated \(fallback\)/) // error column filled
  })

  it('analytics logging failure does not break the response (catch)', async () => {
    mockAuth.mockResolvedValue({ userId: 'u1' } as any)
    mockFeatured.mockResolvedValue({
      products: [cardWithVariants],
      source: 'ai',
      curated: true,
      seedQuery: 's',
      candidateCount: 1,
      responseMs: 1,
      model: 'm',
      promptTokens: 1,
      completionTokens: 1,
    } as any)
    mockQuery.mockRejectedValue(new Error('insert failed'))

    const res = await GET(makeReq())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.products).toHaveLength(1)
  })

  it('returns empty products (never 500) when an error is thrown', async () => {
    mockAuth.mockRejectedValue(new Error('auth blew up'))

    const res = await GET(makeReq())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.products).toEqual([])
  })

  it('best-seller card with no images and zero mrp discount', async () => {
    mockAuth.mockResolvedValue(null as any)
    mockBestSellers.mockResolvedValue([
      {
        ...cardSimple,
        mrp: '40', // mrp < displayPrice(50) → no discount
        product_images: undefined,
      },
    ] as any)

    const res = await GET(makeReq())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.products[0].mrpDiscount).toBe(0)
    expect(body.products[0].primaryImage).toBeNull()
  })
})
