import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/jwt', () => ({
  authenticateAnyUser: vi.fn(),
}))
vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  resolveRequestTenant: vi.fn(async () => null),
}))
vi.mock('@/lib/razorpay', () => ({
  isRazorpayEnabled: vi.fn(),
  getRazorpayInstance: vi.fn(),
  getRazorpayInstanceFor: vi.fn(),
}))
vi.mock('@/lib/order-draft', () => ({
  verifyDraftToken: vi.fn(),
  hashCartItems: vi.fn(),
}))
vi.mock('@/lib/order-commit', () => ({
  loadActiveCart: vi.fn(),
  cartSubtotal: vi.fn(),
  cartItemsForHash: vi.fn(),
  validateCouponForUser: vi.fn(),
}))
vi.mock('@/lib/validate', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/validate')>()
  return { ...actual }
})

import { POST } from '@/app/api/razorpay/create-order/route'
import * as jwt from '@/lib/jwt'
import * as db from '@/lib/db'
import * as razorpayLib from '@/lib/razorpay'
import * as orderDraft from '@/lib/order-draft'
import * as orderCommit from '@/lib/order-commit'

// ------------------------------------------------------------------ helpers

function makeRequest(body: unknown, headers: Record<string, string> = {}) {
  return new Request('http://localhost/api/razorpay/create-order', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

const AUTH_USER = { userId: 'user-123', email: 'test@example.com', isBusiness: false }

const MOCK_RAZORPAY_ORDER = { id: 'rzp_order_abc123' }

function mockRazorpayInstance() {
  const instance = {
    orders: {
      create: vi.fn().mockResolvedValue(MOCK_RAZORPAY_ORDER),
    },
  }
  vi.mocked(razorpayLib.getRazorpayInstanceFor).mockResolvedValue({
    instance,
    creds: { key_id: 'rzp_test_key', key_secret: 'secret', isOwn: false },
  } as any)
  return instance
}

// ------------------------------------------------------------------ tests

describe('POST /api/razorpay/create-order', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 400 when Razorpay is disabled', async () => {
    vi.mocked(razorpayLib.isRazorpayEnabled).mockResolvedValue(false)

    const res = await POST(makeRequest({ orderId: 'some-id' }) as any)
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toMatch(/not available/i)
  })

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(razorpayLib.isRazorpayEnabled).mockResolvedValue(true)
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(null)

    const res = await POST(makeRequest({ orderId: 'some-id' }) as any)
    const body = await res.json()

    expect(res.status).toBe(401)
    expect(body.error).toMatch(/unauthorized/i)
  })

  it('returns 400 when neither draftToken nor orderId is provided', async () => {
    vi.mocked(razorpayLib.isRazorpayEnabled).mockResolvedValue(true)
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)

    const res = await POST(makeRequest({}) as any)
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toMatch(/required/i)
  })

  it('creates a Razorpay order for a legacy orderId and returns razorpayOrderId + key fields', async () => {
    vi.mocked(razorpayLib.isRazorpayEnabled).mockResolvedValue(true)
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce({
        // order lookup
        id: 'order-uuid',
        order_number: 'ORD-999',
        user_id: 'user-123',
        total_amount: '500',
        payment_status: 'unpaid',
      })
      .mockResolvedValueOnce({ id: 'pmt-1' }) // payment insert RETURNING id

    const rzpInstance = mockRazorpayInstance()

    const res = await POST(makeRequest({ orderId: 'order-uuid' }) as any)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.razorpayOrderId).toBe('rzp_order_abc123')
    expect(body.amount).toBe(50000) // 500 * 100 paise
    expect(body.currency).toBe('INR')
    expect(body.orderId).toBe('order-uuid')
    expect(rzpInstance.orders.create).toHaveBeenCalledOnce()
  })

  it('returns 400 when legacy order is already paid', async () => {
    vi.mocked(razorpayLib.isRazorpayEnabled).mockResolvedValue(true)
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce({
      id: 'order-uuid',
      order_number: 'ORD-999',
      user_id: 'user-123',
      total_amount: '500',
      payment_status: 'paid',
    })

    const res = await POST(makeRequest({ orderId: 'order-uuid' }) as any)
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toMatch(/already paid/i)
  })

  it('creates a Razorpay order for a draftToken', async () => {
    vi.mocked(razorpayLib.isRazorpayEnabled).mockResolvedValue(true)
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(orderDraft.verifyDraftToken).mockResolvedValue({
      userId: 'user-123',
      mode: 'cart',
      cartHash: 'hash-abc',
      couponId: null,
      shippingAmount: 50,
      addressId: 'addr-1',
      notes: null,
    } as any)
    vi.mocked(orderCommit.loadActiveCart).mockResolvedValue([{ product_id: 'p1' }] as any)
    vi.mocked(orderCommit.cartItemsForHash).mockReturnValue([{ product_id: 'p1' }] as any)
    vi.mocked(orderDraft.hashCartItems).mockReturnValue('hash-abc')
    vi.mocked(orderCommit.cartSubtotal).mockReturnValue(450)

    const rzpInstance = mockRazorpayInstance()

    const res = await POST(makeRequest({ draftToken: 'tok_abc' }) as any)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.razorpayOrderId).toBe('rzp_order_abc123')
    expect(body.draftToken).toBe('tok_abc')
    expect(rzpInstance.orders.create).toHaveBeenCalledOnce()
  })

  it('returns 400 when draftToken is invalid/expired', async () => {
    vi.mocked(razorpayLib.isRazorpayEnabled).mockResolvedValue(true)
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(orderDraft.verifyDraftToken).mockResolvedValue(null)

    const res = await POST(makeRequest({ draftToken: 'bad-token' }) as any)
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toMatch(/invalid or expired/i)
  })

  it('returns 403 when draftToken userId does not match authenticated user', async () => {
    vi.mocked(razorpayLib.isRazorpayEnabled).mockResolvedValue(true)
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(orderDraft.verifyDraftToken).mockResolvedValue({
      userId: 'different-user-id',
      mode: 'cart',
      cartHash: 'hash-abc',
      couponId: null,
      shippingAmount: 0,
      addressId: null,
      notes: null,
    } as any)

    const res = await POST(makeRequest({ draftToken: 'tok_mismatch' }) as any)
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.error).toMatch(/unauthorized/i)
  })

  it('returns 400 when cart is empty for draftToken in cart mode', async () => {
    vi.mocked(razorpayLib.isRazorpayEnabled).mockResolvedValue(true)
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(orderDraft.verifyDraftToken).mockResolvedValue({
      userId: AUTH_USER.userId,
      mode: 'cart',
      cartHash: null,
      couponId: null,
      shippingAmount: 0,
      addressId: null,
      notes: null,
    } as any)
    vi.mocked(orderCommit.loadActiveCart).mockResolvedValue([] as any)

    const res = await POST(makeRequest({ draftToken: 'tok_empty' }) as any)
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toMatch(/cart is empty/i)
  })

  it('returns 409 when cart changed since draft was created', async () => {
    vi.mocked(razorpayLib.isRazorpayEnabled).mockResolvedValue(true)
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(orderDraft.verifyDraftToken).mockResolvedValue({
      userId: AUTH_USER.userId,
      mode: 'cart',
      cartHash: 'original-hash',
      couponId: null,
      shippingAmount: 0,
      addressId: null,
      notes: null,
    } as any)
    vi.mocked(orderCommit.loadActiveCart).mockResolvedValue([{ product_id: 'p1' }] as any)
    vi.mocked(orderCommit.cartItemsForHash).mockReturnValue([{ product_id: 'p1' }] as any)
    vi.mocked(orderDraft.hashCartItems).mockReturnValue('changed-hash') // different from cartHash

    const res = await POST(makeRequest({ draftToken: 'tok_changed' }) as any)
    const body = await res.json()

    expect(res.status).toBe(409)
    expect(body.error).toMatch(/cart changed/i)
  })

  it('returns 400 when draft mode is invalid (neither cart nor buyNow)', async () => {
    vi.mocked(razorpayLib.isRazorpayEnabled).mockResolvedValue(true)
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(orderDraft.verifyDraftToken).mockResolvedValue({
      userId: AUTH_USER.userId,
      mode: 'unknown',
      cartHash: null,
      couponId: null,
      shippingAmount: 0,
      addressId: null,
      notes: null,
    } as any)

    const res = await POST(makeRequest({ draftToken: 'tok_bad_mode' }) as any)
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toMatch(/invalid draft/i)
  })

  it('returns 400 when draft total is zero (fully discounted)', async () => {
    vi.mocked(razorpayLib.isRazorpayEnabled).mockResolvedValue(true)
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(orderDraft.verifyDraftToken).mockResolvedValue({
      userId: AUTH_USER.userId,
      mode: 'cart',
      cartHash: 'hash-abc',
      couponId: 'coupon-100',
      shippingAmount: 0,
      addressId: null,
      notes: null,
    } as any)
    vi.mocked(orderCommit.loadActiveCart).mockResolvedValue([{ product_id: 'p1' }] as any)
    vi.mocked(orderCommit.cartItemsForHash).mockReturnValue([{ product_id: 'p1' }] as any)
    vi.mocked(orderDraft.hashCartItems).mockReturnValue('hash-abc')
    vi.mocked(orderCommit.cartSubtotal).mockReturnValue(100)
    vi.mocked(orderCommit.validateCouponForUser).mockResolvedValue({ ok: true, appliedDiscount: 100 } as any)

    const res = await POST(makeRequest({ draftToken: 'tok_zero' }) as any)
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toMatch(/greater than zero/i)
  })

  it('creates Razorpay order for draftToken with buyNow mode', async () => {
    vi.mocked(razorpayLib.isRazorpayEnabled).mockResolvedValue(true)
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(orderDraft.verifyDraftToken).mockResolvedValue({
      userId: AUTH_USER.userId,
      mode: 'buyNow',
      buyNowItem: { productId: 'prod-1', variantId: null, price: 500, qty: 1 },
      cartHash: null,
      couponId: null,
      shippingAmount: 0,
      addressId: null,
      notes: null,
    } as any)

    mockRazorpayInstance()

    const res = await POST(makeRequest({ draftToken: 'tok_buynow' }) as any)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.razorpayOrderId).toBe('rzp_order_abc123')
    expect(body.draftToken).toBe('tok_buynow')
  })

  it('creates Razorpay order for legacy orderId with isBusiness header', async () => {
    vi.mocked(razorpayLib.isRazorpayEnabled).mockResolvedValue(true)
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue({ ...AUTH_USER, isBusiness: false } as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce({ email: AUTH_USER.email, phone: null }) // bizUser lookup
      .mockResolvedValueOnce({
        // order lookup
        id: 'order-uuid',
        order_number: 'ORD-BIZ',
        user_id: 'user-123',
        total_amount: '750',
        payment_status: 'unpaid',
      })
      .mockResolvedValueOnce({ id: 'pmt-2' }) // payment insert

    mockRazorpayInstance()

    const res = await POST(makeRequest({ orderId: 'order-uuid' }, { 'x-auth-portal': 'business' }) as any)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.razorpayOrderId).toBe('rzp_order_abc123')
  })

  it('returns 404 when legacy orderId not found', async () => {
    vi.mocked(razorpayLib.isRazorpayEnabled).mockResolvedValue(true)
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce(null) // order not found

    const res = await POST(makeRequest({ orderId: 'nonexistent-id' }) as any)
    const body = await res.json()

    expect(res.status).toBe(404)
    expect(body.error).toMatch(/not found/i)
  })
})
