import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
  withTransaction: vi.fn(),
}))
vi.mock('@/lib/queries', () => ({
  VARIANT_MIN_PRICE_SQL: '0',
  VARIANT_STOCK_TOTAL_SQL: '0',
}))

import { GET } from '@/app/api/products/slug/[slug]/route'
import { queryOne } from '@/lib/db'

const mockQueryOne = vi.mocked(queryOne)

function makeRequest() {
  return new Request('http://localhost/api/products/slug/test-bolt')
}

const params = { params: Promise.resolve({ slug: 'test-bolt' }) }

describe('GET /api/products/slug/[slug]', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns 404 when product not found', async () => {
    mockQueryOne.mockResolvedValueOnce(null)
    const res = await GET(makeRequest() as any, params as any)
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
    mockQueryOne.mockResolvedValueOnce(product)
    const res = await GET(makeRequest() as any, params as any)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.product.name).toBe('Test Bolt')
  })

  it('returns 500 on db error', async () => {
    mockQueryOne.mockRejectedValueOnce(new Error('db error'))
    const res = await GET(makeRequest() as any, params as any)
    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json.error).toBe('Failed')
  })
})
