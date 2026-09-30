import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── hoisted mocks ────────────────────────────────────────────────────────────
const { queryOneMock } = vi.hoisted(() => ({
  queryOneMock: vi.fn(),
}))

vi.mock('@/lib/shared/db', () => ({
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

vi.mock('@/lib/catalog/site-controls', () => ({
  getFeatureFlags: vi.fn().mockResolvedValue({
    razorpayEnabled: false,
    gstEnabled: false,
    ondeviceSummaryEnabled: false,
    ondeviceFinetuneEnabled: false,
  }),
}))

// ── import handler AFTER mocks ───────────────────────────────────────────────
import { GET } from '@/app/api/(public)/products/slug/[slug]/variants/route'

// ── fixtures ─────────────────────────────────────────────────────────────────
const variantsRow = {
  product_variants: [
    {
      id: 'var-1',
      variant_name: '10mm',
      sku: 'HB-M8-10',
      price: '45.00',
      mrp: '55.00',
      price_ex_gst: '38.14',
      stock_status: 'In Stock',
      pricing_type: 'unit',
      unit: null,
      numeric_value: null,
      sub_variant_type: 'Colour',
      sell_unit_id: null,
      variant_type: 'Size',
      variant_images: [],
      sub_variants: [
        {
          id: 'sub-1',
          sub_variant_name: 'Red',
          sku: 'HB-M8-10-R',
          price: '45.00',
          mrp: '55.00',
          price_ex_gst: '38.14',
          stock_status: 'In Stock',
          is_active: true,
        },
      ],
    },
  ],
  product_units: [],
  variant_min_price: '45.00',
  variant_min_mrp: '55.00',
  variant_stock_total: 3,
}

function makeReq(slug: string) {
  return new Request(`http://localhost/api/products/slug/${slug}/variants`)
}

describe('GET /api/products/[slug]/variants', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 200 with product_variants for a valid slug', async () => {
    queryOneMock.mockResolvedValue(variantsRow)

    const res = await GET(makeReq('hex-bolt-m8') as any, { params: Promise.resolve({ slug: 'hex-bolt-m8' }) })
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body).toHaveProperty('product_variants')
    expect(body.product_variants).toHaveLength(1)
    expect(body.product_variants[0].sku).toBe('HB-M8-10')
    expect(body.product_variants[0].sub_variants[0].sub_variant_name).toBe('Red')
    expect(body).toHaveProperty('product_units')
  })

  it('passes the slug param to the db query', async () => {
    queryOneMock.mockResolvedValue(variantsRow)

    await GET(makeReq('hex-bolt-m8') as any, { params: Promise.resolve({ slug: 'hex-bolt-m8' }) })

    expect(queryOneMock).toHaveBeenCalledOnce()
    const [, queryParams] = queryOneMock.mock.calls[0]
    expect(queryParams).toContain('hex-bolt-m8')
  })

  it('returns 404 for a non-existent slug', async () => {
    queryOneMock.mockResolvedValue(null)

    const res = await GET(makeReq('does-not-exist') as any, { params: Promise.resolve({ slug: 'does-not-exist' }) })
    expect(res.status).toBe(404)

    const body = await res.json()
    expect(body.error).toMatch(/not found/i)
  })

  it('returns 500 when the db throws', async () => {
    queryOneMock.mockRejectedValue(new Error('Connection refused'))

    const res = await GET(makeReq('any-slug') as any, { params: Promise.resolve({ slug: 'any-slug' }) })
    expect(res.status).toBe(500)

    const body = await res.json()
    expect(body).toHaveProperty('error')
  })
})
