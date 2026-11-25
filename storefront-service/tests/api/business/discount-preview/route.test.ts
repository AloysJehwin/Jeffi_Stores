import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const authenticateAnyUser = vi.hoisted(() => vi.fn())
const queryOne = vi.hoisted(() => vi.fn())
const getBusinessDiscountMap = vi.hoisted(() => vi.fn())
const loadActiveCart = vi.hoisted(() => vi.fn())

vi.mock('@/lib/auth/jwt', () => ({ authenticateAnyUser }))
vi.mock('@/lib/shared/db', () => ({ queryOne }))
vi.mock('@/lib/catalog/business-discount', () => ({ getBusinessDiscountMap }))
vi.mock('@/lib/orders/order-commit', () => ({ loadActiveCart }))

import { POST } from '@storefront/app/api/(public)/business/discount-preview/route'

const post = (body: unknown) =>
  POST(
    new NextRequest('http://localhost/api/business/discount-preview', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    })
  )

describe('POST /api/business/discount-preview', () => {
  beforeEach(() => {
    authenticateAnyUser.mockResolvedValue({ userId: 'b1' })
    getBusinessDiscountMap.mockResolvedValue({ catA: 10 })
    loadActiveCart.mockResolvedValue([])
  })

  it('401s when unauthenticated', async () => {
    authenticateAnyUser.mockResolvedValue(null)
    expect((await post({})).status).toBe(401)
  })

  it('returns zero when the business has no discounts', async () => {
    getBusinessDiscountMap.mockResolvedValue({})
    expect(await (await post({})).json()).toEqual({ businessDiscountAmount: 0 })
    expect(loadActiveCart).not.toHaveBeenCalled()
  })

  it('tolerates a non-JSON body (defaults to cart mode)', async () => {
    expect(await (await post('not json')).json()).toEqual({ businessDiscountAmount: 0 })
    expect(loadActiveCart).toHaveBeenCalledWith('b1')
  })

  it('sums the discount across cart lines in discounted categories, preferring the price at addition', async () => {
    loadActiveCart.mockResolvedValue([
      { products: { category_id: 'catA', base_price: 100 }, price_at_addition: '200', quantity: 2 },
      { products: { category_id: 'catA', base_price: 50 }, price_at_addition: 0, variant: { price: 80 }, quantity: 1 },
      { products: { category_id: 'catB', base_price: 999 }, quantity: 5 },
    ])
    // (200*2*10%) + (80*1*10%) = 40 + 8
    expect(await (await post({ mode: 'cart' })).json()).toEqual({ businessDiscountAmount: 48 })
  })

  it('previews a buy-now line from the product category', async () => {
    queryOne.mockResolvedValue({ category_id: 'catA' })
    const res = await post({ mode: 'buyNow', productId: 'p1', qty: 3, price: 99.99 })
    expect(await res.json()).toEqual({ businessDiscountAmount: 30 })
    expect(queryOne).toHaveBeenCalledWith(expect.stringContaining('FROM products'), ['p1'])
  })

  it('returns zero for an incomplete buy-now payload or an uncategorised product', async () => {
    expect(await (await post({ mode: 'buyNow', productId: 'p1' })).json()).toEqual({ businessDiscountAmount: 0 })
    queryOne.mockResolvedValue({ category_id: null })
    expect(await (await post({ mode: 'buyNow', productId: 'p1', qty: 1, price: 10 })).json()).toEqual({ businessDiscountAmount: 0 })
  })
})
