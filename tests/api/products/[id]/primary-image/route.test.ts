import { vi, describe, it, expect, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/shared/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
  withTransaction: vi.fn(),
}))

import { GET } from '@/app/api/(public)/products/[id]/primary-image/route'
import { queryOne } from '@/lib/shared/db'

const mockQueryOne = vi.mocked(queryOne)

function makeRequest(variantId?: string) {
  const url = `http://localhost/api/products/prod1/primary-image${variantId ? `?variantId=${variantId}` : ''}`
  return new NextRequest(url)
}

const params = { params: Promise.resolve({ id: 'prod1' }) }

describe('GET /api/products/[id]/primary-image', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns product image when no variantId', async () => {
    // Promise.all: variantImage=Promise.resolve(null), productImage=queryOne, product=queryOne, variant=Promise.resolve(null)
    // So only 2 queryOne calls: productImage then product
    mockQueryOne
      .mockResolvedValueOnce({ image_url: 'https://cdn/product.jpg' }) // productImage
      .mockResolvedValueOnce({ name: 'Bolt' }) // product name

    const res = await GET(makeRequest(), params as any)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.imageUrl).toBe('https://cdn/product.jpg')
    expect(json.productName).toBe('Bolt')
    expect(json.variantName).toBeNull()
  })

  it('returns variant image when variantId provided', async () => {
    // Promise.all: variantImage=queryOne, productImage=queryOne, product=queryOne, variant=queryOne
    mockQueryOne
      .mockResolvedValueOnce({ image_url: 'https://cdn/variant.jpg' }) // variantImage
      .mockResolvedValueOnce({ image_url: 'https://cdn/product.jpg' }) // productImage
      .mockResolvedValueOnce({ name: 'Bolt' }) // product
      .mockResolvedValueOnce({ variant_name: 'M6x20' }) // variant

    const res = await GET(makeRequest('v1'), params as any)
    const json = await res.json()
    expect(json.imageUrl).toBe('https://cdn/variant.jpg')
    expect(json.variantName).toBe('M6x20')
  })

  it('falls back to product image when variant image is null', async () => {
    mockQueryOne
      .mockResolvedValueOnce(null) // variantImage = null
      .mockResolvedValueOnce({ image_url: 'https://cdn/product.jpg' }) // productImage
      .mockResolvedValueOnce({ name: 'Bolt' }) // product
      .mockResolvedValueOnce({ variant_name: 'M6x20' }) // variant

    const res = await GET(makeRequest('v1'), params as any)
    const json = await res.json()
    expect(json.imageUrl).toBe('https://cdn/product.jpg')
  })

  it('returns null imageUrl when no images found', async () => {
    // No variantId → 2 queryOne calls both null
    mockQueryOne
      .mockResolvedValueOnce(null) // productImage
      .mockResolvedValueOnce(null) // product

    const res = await GET(makeRequest(), params as any)
    const json = await res.json()
    expect(json.imageUrl).toBeNull()
    expect(json.productName).toBeNull()
  })
})
