import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── hoisted mocks ────────────────────────────────────────────────────────────
const { queryOneMock } = vi.hoisted(() => ({
  queryOneMock: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: queryOneMock,
  queryMany: vi.fn(),
  queryCount: vi.fn(),
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
import { GET } from '@/app/api/products/slug/[slug]/route'

// ── fixtures ─────────────────────────────────────────────────────────────────
const fullProduct = {
  id: 'prod-1',
  name: 'Hex Bolt M8',
  slug: 'hex-bolt-m8',
  sku: 'HB-M8',
  is_active: true,
  base_price: '50.00',
  categories: { id: 'cat-1', name: 'Bolts', slug: 'bolts' },
  brands: { id: 'brand-1', name: 'Unbrako', slug: 'unbrako' },
  product_images: [
    { id: 'img-1', image_url: 'https://cdn.example.com/img.jpg', is_primary: true, display_order: 1 },
  ],
  product_variants: [
    {
      id: 'var-1',
      sku: 'HB-M8-10',
      variant_name: '10mm',
      price: '45.00',
      mrp: '55.00',
      stock_status: 'In Stock',
      is_active: true,
    },
  ],
  product_units: [],
  product_unit_rules: [],
  variant_stock_total: 1,
  variant_min_price: '45.00',
}

function makeReq(slug: string) {
  return new Request(`http://localhost/api/products/slug/${slug}`)
}

describe('GET /api/products/slug/[slug]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 200 with full product for valid slug', async () => {
    queryOneMock.mockResolvedValue(fullProduct)

    const res = await GET(makeReq('hex-bolt-m8') as any, { params: Promise.resolve({ slug: 'hex-bolt-m8' }) })
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body).toHaveProperty('product')
    expect(body.product.slug).toBe('hex-bolt-m8')
    expect(body.product.name).toBe('Hex Bolt M8')
  })

  it('includes variants in the response', async () => {
    queryOneMock.mockResolvedValue(fullProduct)

    const res = await GET(makeReq('hex-bolt-m8') as any, { params: Promise.resolve({ slug: 'hex-bolt-m8' }) })
    const body = await res.json()

    expect(body.product.product_variants).toHaveLength(1)
    expect(body.product.product_variants[0].sku).toBe('HB-M8-10')
  })

  it('includes product_units in the response', async () => {
    queryOneMock.mockResolvedValue(fullProduct)

    const res = await GET(makeReq('hex-bolt-m8') as any, { params: Promise.resolve({ slug: 'hex-bolt-m8' }) })
    const body = await res.json()

    expect(body.product).toHaveProperty('product_units')
    expect(Array.isArray(body.product.product_units)).toBe(true)
  })

  it('returns 404 for non-existent slug', async () => {
    queryOneMock.mockResolvedValue(null)

    const res = await GET(makeReq('does-not-exist') as any, { params: Promise.resolve({ slug: 'does-not-exist' }) })
    expect(res.status).toBe(404)

    const body = await res.json()
    expect(body.error).toMatch(/not found/i)
  })

  it('returns 500 when db throws', async () => {
    queryOneMock.mockRejectedValue(new Error('Connection refused'))

    const res = await GET(makeReq('any-slug') as any, { params: Promise.resolve({ slug: 'any-slug' }) })
    expect(res.status).toBe(500)

    const body = await res.json()
    expect(body).toHaveProperty('error')
  })

  it('passes the slug param to the db query', async () => {
    queryOneMock.mockResolvedValue(fullProduct)

    await GET(makeReq('hex-bolt-m8') as any, { params: Promise.resolve({ slug: 'hex-bolt-m8' }) })

    expect(queryOneMock).toHaveBeenCalledOnce()
    const [, queryParams] = queryOneMock.mock.calls[0]
    expect(queryParams).toContain('hex-bolt-m8')
  })
})

describe('GET /api/products/slug/[slug] response shape', () => {
  const params = { params: Promise.resolve({ slug: 'test-bolt' }) }

  beforeEach(() => { vi.clearAllMocks() })

  it('returns 404 when product not found', async () => {
    queryOneMock.mockResolvedValueOnce(null)
    const res = await GET(makeReq('test-bolt') as any, params as any)
    expect(res.status).toBe(404)
    const json = await res.json()
    expect(json.error).toBe('Product not found')
  })

  it('returns product when found', async () => {
    const product = {
      id: 'prod1',
      name: 'Test Bolt',
      slug: 'test-bolt',
      is_active: true,
      product_images: [],
      product_variants: [],
      product_units: [],
      product_unit_rules: [],
    }
    queryOneMock.mockResolvedValueOnce(product)
    const res = await GET(makeReq('test-bolt') as any, params as any)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.product.name).toBe('Test Bolt')
  })

  it('returns 500 on db error', async () => {
    queryOneMock.mockRejectedValueOnce(new Error('db error'))
    const res = await GET(makeReq('test-bolt') as any, params as any)
    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json.error).toBe('Failed')
  })
})
