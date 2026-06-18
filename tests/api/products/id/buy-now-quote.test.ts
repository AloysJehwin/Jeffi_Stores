import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/lib/order-commit', () => ({
  resolveBuyNowItem: vi.fn(),
}))

import { POST } from '@/app/api/products/[id]/buy-now-quote/route'
import { resolveBuyNowItem } from '@/lib/order-commit'

const mockResolve = vi.mocked(resolveBuyNowItem)

function makeRequest(body: object = {}) {
  return new Request('http://localhost/api/products/prod1/buy-now-quote', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const params = { params: Promise.resolve({ id: 'prod1' }) }

describe('POST /api/products/[id]/buy-now-quote', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns 400 when resolve fails', async () => {
    mockResolve.mockResolvedValueOnce({ ok: false, error: 'Product not found' } as any)
    const res = await POST(makeRequest() as any, params as any)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe('Product not found')
  })

  it('returns resolved item on success', async () => {
    mockResolve.mockResolvedValueOnce({
      ok: true,
      item: {
        productId: 'prod1',
        variantId: 'v1',
        subVariantId: null,
        qty: 2,
        buyMode: 'retail',
        buyUnit: 'pc',
        price: 150,
      },
    } as any)

    const res = await POST(makeRequest({ variantId: 'v1', qty: 2 }) as any, params as any)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.price).toBe(150)
    expect(json.qty).toBe(2)
    expect(json.productId).toBe('prod1')
  })

  it('defaults qty to 1 when not provided', async () => {
    mockResolve.mockResolvedValueOnce({
      ok: true,
      item: { productId: 'prod1', variantId: null, subVariantId: null, qty: 1, buyMode: 'retail', buyUnit: 'pc', price: 100 },
    } as any)

    await POST(makeRequest({}) as any, params as any)
    expect(mockResolve).toHaveBeenCalledWith(expect.objectContaining({ qty: 1 }))
  })

  it('handles malformed JSON body gracefully', async () => {
    mockResolve.mockResolvedValueOnce({ ok: false, error: 'bad' } as any)
    const req = new Request('http://localhost/api/products/prod1/buy-now-quote', {
      method: 'POST',
      body: 'not-json',
    })
    const res = await POST(req as any, params as any)
    expect(res.status).toBe(400)
  })
})
