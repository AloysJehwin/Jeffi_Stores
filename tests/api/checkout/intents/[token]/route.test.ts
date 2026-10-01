import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/lib/shared/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
  withTransaction: vi.fn(),
}))
vi.mock('@/lib/auth/jwt', () => ({
  authenticateAnyUser: vi.fn(),
  authenticateAdmin: vi.fn(),
  authenticateUser: vi.fn(),
  verifyToken: vi.fn(),
}))
vi.mock('@/lib/orders/checkout-intent', () => ({ verifyIntent: vi.fn() }))
vi.mock('@/lib/orders/order-commit', () => ({
  resolveBuyNowItem: vi.fn(),
  loadActiveCart: vi.fn(),
  cartSubtotal: vi.fn(),
}))

import { GET } from '@/app/api/(public)/checkout/intents/[token]/route'
import { authenticateAnyUser } from '@/lib/auth/jwt'
import { verifyIntent } from '@/lib/orders/checkout-intent'
import { resolveBuyNowItem, loadActiveCart, cartSubtotal } from '@/lib/orders/order-commit'
import { queryOne } from '@/lib/shared/db'

const mockAuth = vi.mocked(authenticateAnyUser)
const mockVerifyIntent = vi.mocked(verifyIntent)
const mockResolve = vi.mocked(resolveBuyNowItem)
const mockLoadCart = vi.mocked(loadActiveCart)
const mockCartSubtotal = vi.mocked(cartSubtotal)
const mockQueryOne = vi.mocked(queryOne)

function makeRequest() {
  return new Request('http://localhost/api/checkout/intents/tok123')
}

const params = { params: Promise.resolve({ token: 'tok123' }) }

describe('GET /api/checkout/intents/[token]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 400 when intent is invalid', async () => {
    mockVerifyIntent.mockResolvedValueOnce(null)
    const res = await GET(makeRequest() as any, params as any)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe('Invalid or expired intent')
  })

  it('returns 401 for cart mode when not authenticated', async () => {
    mockVerifyIntent.mockResolvedValueOnce({ mode: 'cart', userId: 'u1' } as any)
    mockAuth.mockResolvedValueOnce(null)
    const res = await GET(makeRequest() as any, params as any)
    expect(res.status).toBe(401)
  })

  it('returns 403 for cart mode when user mismatch', async () => {
    mockVerifyIntent.mockResolvedValueOnce({ mode: 'cart', userId: 'u1' } as any)
    mockAuth.mockResolvedValueOnce({ userId: 'u2' } as any)
    const res = await GET(makeRequest() as any, params as any)
    expect(res.status).toBe(403)
  })

  it('returns 400 for cart mode when cart is empty', async () => {
    mockVerifyIntent.mockResolvedValueOnce({ mode: 'cart', userId: 'u1' } as any)
    mockAuth.mockResolvedValueOnce({ userId: 'u1' } as any)
    mockLoadCart.mockResolvedValueOnce([])
    const res = await GET(makeRequest() as any, params as any)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe('Cart is empty')
  })

  it('returns cart data for cart mode', async () => {
    mockVerifyIntent.mockResolvedValueOnce({ mode: 'cart', userId: 'u1' } as any)
    mockAuth.mockResolvedValueOnce({ userId: 'u1' } as any)
    mockLoadCart.mockResolvedValueOnce([{ id: 'ci1' }] as any)
    mockCartSubtotal.mockReturnValueOnce(500)

    const res = await GET(makeRequest() as any, params as any)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.mode).toBe('cart')
    expect(json.itemCount).toBe(1)
    expect(json.subtotal).toBe(500)
  })

  it('returns 400 for buyNow mode when resolve fails', async () => {
    mockVerifyIntent.mockResolvedValueOnce({
      mode: 'buyNow',
      productId: 'p1',
      variantId: null,
      subVariantId: null,
      qty: 1,
      buyMode: 'retail',
      buyUnit: 'pc',
    } as any)
    mockResolve.mockResolvedValueOnce({ ok: false, error: 'out of stock' } as any)

    const res = await GET(makeRequest() as any, params as any)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe('out of stock')
  })

  it('returns buyNow data when resolve succeeds', async () => {
    mockVerifyIntent.mockResolvedValueOnce({
      mode: 'buyNow',
      productId: 'p1',
      variantId: 'v1',
      subVariantId: null,
      qty: 2,
      buyMode: 'retail',
      buyUnit: 'pc',
    } as any)
    mockResolve.mockResolvedValueOnce({
      ok: true,
      item: {
        productId: 'p1',
        variantId: 'v1',
        subVariantId: null,
        qty: 2,
        buyMode: 'retail',
        buyUnit: 'pc',
        price: 200,
      },
    } as any)
    mockQueryOne.mockResolvedValueOnce({
      name: 'Bolt',
      sku: 'B1',
      mrp: 250,
      gst_percentage: 18,
      brand_name: 'Unbrako',
      variant_name: 'M6',
      variant_sku: 'V-B1',
      variant_mrp: 250,
      sub_variant_name: null,
      sub_variant_sku: null,
      sub_variant_mrp: null,
    })

    const res = await GET(makeRequest() as any, params as any)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.mode).toBe('buyNow')
    expect(json.price).toBe(200)
    expect(json.productName).toBe('Bolt')
  })
})
