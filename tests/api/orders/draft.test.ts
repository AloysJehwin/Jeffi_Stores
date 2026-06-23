import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/jwt', () => ({
  authenticateAnyUser: vi.fn(),
}))
vi.mock('@/lib/db', () => ({
  queryOne: vi.fn(),
}))
vi.mock('@/lib/order-commit', () => ({
  loadActiveCart: vi.fn(),
  cartSubtotal: vi.fn().mockReturnValue(500),
  cartTaxAmount: vi.fn().mockReturnValue(45),
  cartItemsForHash: vi.fn().mockReturnValue([]),
  validateCouponForUser: vi.fn().mockResolvedValue({ ok: false }),
  loadAddress: vi.fn(),
  getMinOrderAmount: vi.fn().mockResolvedValue(0),
  findExistingUnpaidRazorpayOrder: vi.fn().mockResolvedValue(null),
  resolveBuyNowItem: vi.fn(),
  quoteShipping: vi.fn().mockResolvedValue(0),
}))
vi.mock('@/lib/order-draft', () => ({
  signDraftToken: vi.fn().mockResolvedValue('signed-draft-token'),
  hashCartItems: vi.fn().mockReturnValue('hash-abc'),
}))
vi.mock('@/lib/checkout-intent', () => ({
  verifyIntent: vi.fn().mockResolvedValue(null),
}))
vi.mock('@/lib/business-discount', () => ({
  getBusinessDiscountMap: vi.fn().mockResolvedValue({}),
}))
vi.mock('@/lib/validate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/validate')>()
  return { ...actual }
})

import { POST } from '@/app/api/orders/draft/route'
import * as jwt from '@/lib/jwt'
import * as orderCommit from '@/lib/order-commit'
import * as orderDraft from '@/lib/order-draft'
import * as checkoutIntent from '@/lib/checkout-intent'

const USER = { userId: 'user-1' }

const MOCK_ADDRESS = {
  id: 'addr-1',
  postal_code: '400001',
  city: 'Mumbai',
  state: 'Maharashtra',
}

const MOCK_CART = [
  {
    product_id: 'prod-1',
    variant_id: null,
    sub_variant_id: null,
    buy_mode: 'unit',
    quantity: 2,
    price_at_addition: '500',
  },
]

const VALID_BODY = {
  addressId: '550e8400-e29b-41d4-a716-446655440001',
  mode: 'cart',
}

function makeRequest(body: unknown = VALID_BODY) {
  return new Request('http://localhost/api/orders/draft', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/orders/draft', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(orderCommit.loadActiveCart).mockResolvedValue(MOCK_CART as any)
    vi.mocked(orderCommit.loadAddress).mockResolvedValue(MOCK_ADDRESS as any)
    vi.mocked(orderCommit.findExistingUnpaidRazorpayOrder).mockResolvedValue(null)
    vi.mocked(orderCommit.cartSubtotal).mockReturnValue(500)
  })

  it('returns 401 when not authenticated', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(null)
    const res = await POST(makeRequest() as any)
    expect(res.status).toBe(401)
  })

  it('returns 400 for invalid intent token', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(USER as any)
    vi.mocked(checkoutIntent.verifyIntent).mockResolvedValue(null)
    const res = await POST(makeRequest({ ...VALID_BODY, intent: 'bad-intent' }) as any)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/Invalid or expired intent/i)
  })

  it('returns 404 when address not found', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(USER as any)
    vi.mocked(orderCommit.loadAddress).mockResolvedValue(null as any)
    const res = await POST(makeRequest() as any)
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toMatch(/Address not found/i)
  })

  it('returns 409 when existing unpaid razorpay order found', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(USER as any)
    vi.mocked(orderCommit.findExistingUnpaidRazorpayOrder).mockResolvedValue({
      id: 'existing-order',
      order_number: 'ORD-001',
    } as any)
    const res = await POST(makeRequest() as any)
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.existingOrderId).toBe('existing-order')
  })

  it('returns 400 when cart is empty', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(USER as any)
    vi.mocked(orderCommit.loadActiveCart).mockResolvedValue([])
    const res = await POST(makeRequest() as any)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/Cart is empty/i)
  })

  it('creates draft token successfully for cart mode', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(USER as any)
    const res = await POST(makeRequest() as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.draftToken).toBe('signed-draft-token')
    expect(body.total).toBeDefined()
    expect(body.subtotal).toBe(500)
    expect(orderDraft.signDraftToken).toHaveBeenCalled()
  })

  it('returns 400 for buyNow mode without item details', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(USER as any)
    const res = await POST(makeRequest({ ...VALID_BODY, mode: 'buyNow' }) as any)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/Item details are required/i)
  })

  it('creates draft token for buyNow mode with item', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(USER as any)
    vi.mocked(orderCommit.resolveBuyNowItem).mockResolvedValue({
      ok: true,
      item: { productId: 'prod-1', variantId: null, subVariantId: null, qty: 1, price: 500 },
    } as any)
    const res = await POST(makeRequest({
      ...VALID_BODY,
      mode: 'buyNow',
      item: { productId: '550e8400-e29b-41d4-a716-446655440001', qty: 1 },
    }) as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.draftToken).toBe('signed-draft-token')
  })

  it('returns 400 when buyNow item resolution fails', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(USER as any)
    vi.mocked(orderCommit.resolveBuyNowItem).mockResolvedValue({
      ok: false,
      error: 'Product not available',
    } as any)
    const res = await POST(makeRequest({
      ...VALID_BODY,
      mode: 'buyNow',
      item: { productId: '550e8400-e29b-41d4-a716-446655440001', qty: 1 },
    }) as any)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('Product not available')
  })

  it('returns 400 below minimum order amount', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(USER as any)
    vi.mocked(orderCommit.cartSubtotal).mockReturnValue(50)
    vi.mocked(orderCommit.getMinOrderAmount).mockResolvedValue(100)
    const res = await POST(makeRequest() as any)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/Minimum order value/i)
  })

  it('applies coupon discount when valid', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(USER as any)
    vi.mocked(orderCommit.validateCouponForUser).mockResolvedValue({ ok: true, appliedDiscount: 50 } as any)
    const res = await POST(makeRequest({ ...VALID_BODY, couponId: 'coupon-1' }) as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.appliedDiscount).toBe(50)
  })

  it('returns 403 when cart intent does not belong to user', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(USER as any)
    vi.mocked(checkoutIntent.verifyIntent).mockResolvedValue({
      mode: 'cart',
      userId: 'other-user',
    } as any)
    const res = await POST(makeRequest({ ...VALID_BODY, intent: 'some-intent' }) as any)
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toMatch(/does not belong to this user/i)
  })
})
