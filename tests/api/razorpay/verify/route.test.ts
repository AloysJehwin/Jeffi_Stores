import { describe, it, expect, vi, beforeEach } from 'vitest'
import crypto from 'crypto'

// Set env before module is imported so the route picks it up
process.env.RAZORPAY_KEY_SECRET = 'test_secret_key'

vi.mock('@/lib/jwt', () => ({
  authenticateAnyUser: vi.fn(),
}))
vi.mock('@/lib/db', () => ({
  queryOne: vi.fn(),
  queryMany: vi.fn(),
  query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  withTransaction: vi.fn(),
  resolveRequestTenant: vi.fn(async () => null),
}))
vi.mock('@/lib/email', () => ({
  sendOrderConfirmationEmail: vi.fn().mockResolvedValue(undefined),
  sendNewOrderNotification: vi.fn().mockResolvedValue(undefined),
  sendPaymentStatusUpdate: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/invoice', () => ({
  createDraftInvoice: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/order-draft', () => ({
  verifyDraftToken: vi.fn(),
  hashCartItems: vi.fn(),
}))
vi.mock('@/lib/order-commit', () => ({
  loadActiveCart: vi.fn(),
  cartSubtotal: vi.fn(),
  cartTaxAmount: vi.fn(),
  cartItemsForHash: vi.fn(),
  validateCouponForUser: vi.fn(),
  commitOrder: vi.fn(),
}))
vi.mock('@/lib/activity', () => ({
  logActivity: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/auto-tasks', () => ({
  createAutoTask: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/ai-feedback', () => ({
  recordImplicitSignalsForProducts: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/validate', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/validate')>()
  return { ...actual }
})
vi.mock('@/lib/sms', () => ({
  sendOrderConfirmedSMS: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/site-controls', () => ({
  getFeatureFlags: vi.fn().mockResolvedValue({ gstEnabled: true }),
}))
vi.mock('@/lib/razorpay', () => ({
  getRazorpayInstance: vi.fn(() => ({ orders: { fetch: vi.fn().mockResolvedValue({ amount: 15000 }) } })),
}))
vi.mock('@/lib/variant-change', () => ({
  settleVariantChangePayment: vi.fn(),
}))

import { POST } from '@/app/api/razorpay/verify/route'
import * as jwt from '@/lib/jwt'
import * as db from '@/lib/db'
import * as orderCommit from '@/lib/order-commit'
import * as variantChange from '@/lib/variant-change'

// ------------------------------------------------------------------ helpers

const SECRET = 'test_secret_key'

function computeSignature(orderId: string, paymentId: string): string {
  return crypto.createHmac('sha256', SECRET).update(`${orderId}|${paymentId}`).digest('hex')
}

function makeRequest(body: unknown, headers: Record<string, string> = {}) {
  return new Request('http://localhost/api/razorpay/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

const AUTH_USER = { userId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479', email: 'test@example.com', isBusiness: false }

const RZP_ORDER_ID = 'order_rzp_abc'
const RZP_PAYMENT_ID = 'pay_rzp_xyz'
const VALID_SIGNATURE = computeSignature(RZP_ORDER_ID, RZP_PAYMENT_ID)

// Must be valid RFC-4122 UUIDs for zUuid schema
const ORDER_UUID = '550e8400-e29b-41d4-a716-446655440000'

const MOCK_ORDER = {
  id: ORDER_UUID,
  order_number: 'ORD-001',
  total_amount: '500',
  payment_status: 'unpaid',
  user_id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
}

const MOCK_USER = {
  id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
  email: 'test@example.com',
  first_name: 'Test',
  last_name: 'User',
  phone: '9999999999',
}

// ------------------------------------------------------------------ tests

describe('POST /api/razorpay/verify', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // clearAllMocks clears call history but NOT the mockResolvedValueOnce queue,
    // so leftover once-values from one test can leak into the next. Fully reset the
    // db query mocks (clears queued once-values), then restore safe defaults.
    vi.mocked(db.queryOne).mockReset()
    vi.mocked(db.queryMany)
      .mockReset()
      .mockResolvedValue([] as any)
    vi.mocked(db.query)
      .mockReset()
      .mockResolvedValue({ rows: [], rowCount: 0 } as any)
    vi.mocked(db.withTransaction).mockReset()
  })

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(null)

    const res = await POST(
      makeRequest({
        razorpay_order_id: RZP_ORDER_ID,
        razorpay_payment_id: RZP_PAYMENT_ID,
        razorpay_signature: VALID_SIGNATURE,
        orderId: ORDER_UUID,
      }) as any
    )
    const body = await res.json()

    expect(res.status).toBe(401)
    expect(body.error).toMatch(/unauthorized/i)
  })

  it('returns 400 when razorpay_signature is invalid', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)

    // orderId must be a valid UUID so parseBody passes — the HMAC check fires after
    const res = await POST(
      makeRequest({
        razorpay_order_id: RZP_ORDER_ID,
        razorpay_payment_id: RZP_PAYMENT_ID,
        razorpay_signature: 'badbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadb',
        orderId: ORDER_UUID,
      }) as any
    )
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toMatch(/invalid payment signature/i)
  })

  it('returns 400 when required fields are missing', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)

    // Missing razorpay_payment_id
    const res = await POST(
      makeRequest({
        razorpay_order_id: RZP_ORDER_ID,
        razorpay_signature: VALID_SIGNATURE,
      }) as any
    )
    const body = await res.json()

    // parseBody returns a 400-level error response
    expect(res.status).toBeGreaterThanOrEqual(400)
  })

  it('returns 400 when neither orderId nor draftToken is provided (valid signature)', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)

    const res = await POST(
      makeRequest({
        razorpay_order_id: RZP_ORDER_ID,
        razorpay_payment_id: RZP_PAYMENT_ID,
        razorpay_signature: VALID_SIGNATURE,
        // no orderId, no draftToken
      }) as any
    )
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toMatch(/required/i)
  })

  it('happy path with orderId: marks order paid and returns success', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)

    // markLegacyOrderPaid: order lookup, withTransaction, user + orderItems, final order
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce(MOCK_ORDER) // order lookup for legacy path
      .mockResolvedValueOnce(MOCK_USER) // user after transaction
      .mockResolvedValueOnce(MOCK_ORDER) // updatedOrder after transaction

    vi.mocked(db.queryMany).mockResolvedValue([]) // orderItems

    vi.mocked(db.withTransaction).mockImplementation(async (fn: any) => {
      const client = {
        query: vi.fn().mockResolvedValue({ rows: [], rowCount: 1 }),
      }
      return fn(client)
    })

    const res = await POST(
      makeRequest({
        razorpay_order_id: RZP_ORDER_ID,
        razorpay_payment_id: RZP_PAYMENT_ID,
        razorpay_signature: VALID_SIGNATURE,
        orderId: ORDER_UUID,
      }) as any
    )
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.order.paymentStatus).toBe('paid')
  })

  it('returns 200 immediately when order is already paid (idempotent)', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce({
      ...MOCK_ORDER,
      payment_status: 'paid',
    })

    const res = await POST(
      makeRequest({
        razorpay_order_id: RZP_ORDER_ID,
        razorpay_payment_id: RZP_PAYMENT_ID,
        razorpay_signature: VALID_SIGNATURE,
        orderId: ORDER_UUID,
      }) as any
    )
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.order.paymentStatus).toBe('paid')
    // withTransaction should NOT be called for idempotent path
    expect(db.withTransaction).not.toHaveBeenCalled()
  })

  it('returns 404 when orderId does not belong to user', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce(null) // order not found

    const res = await POST(
      makeRequest({
        razorpay_order_id: RZP_ORDER_ID,
        razorpay_payment_id: RZP_PAYMENT_ID,
        razorpay_signature: VALID_SIGNATURE,
        orderId: ORDER_UUID,
      }) as any
    )
    const body = await res.json()

    expect(res.status).toBe(404)
    expect(body.error).toMatch(/not found/i)
  })

  it('happy path with draftToken: commits order and returns success', async () => {
    const { verifyDraftToken, hashCartItems } = await import('@/lib/order-draft')

    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(verifyDraftToken).mockResolvedValue({
      userId: AUTH_USER.userId,
      mode: 'cart',
      cartHash: 'hash-abc',
      couponId: null,
      shippingAmount: 0,
      addressId: 'addr-1',
      notes: null,
    } as any)

    vi.mocked(db.queryOne)
      .mockResolvedValueOnce(null) // idempotency check: no existing payment
      .mockResolvedValueOnce(MOCK_USER) // user lookup
      .mockResolvedValue(MOCK_ORDER) // post-commit order/item lookups
    vi.mocked(db.queryMany).mockResolvedValue([])

    vi.mocked(orderCommit.loadActiveCart).mockResolvedValue([{ product_id: 'p1' }] as any)
    vi.mocked(orderCommit.cartItemsForHash).mockReturnValue([{ product_id: 'p1' }] as any)
    vi.mocked(hashCartItems).mockReturnValue('hash-abc')
    vi.mocked(orderCommit.cartSubtotal).mockReturnValue(500)
    vi.mocked(orderCommit.cartTaxAmount).mockReturnValue(76)
    vi.mocked(orderCommit.commitOrder).mockResolvedValue({
      id: 'order-new',
      order_number: 'ORD-NEW',
      total_amount: '500',
    } as any)

    const res = await POST(
      makeRequest({
        razorpay_order_id: RZP_ORDER_ID,
        razorpay_payment_id: RZP_PAYMENT_ID,
        razorpay_signature: VALID_SIGNATURE,
        draftToken: 'tok_valid',
      }) as any
    )
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.order.paymentStatus).toBe('paid')
    expect(orderCommit.commitOrder).toHaveBeenCalledOnce()
  })

  it('returns 400 when draftToken is invalid/expired', async () => {
    const { verifyDraftToken } = await import('@/lib/order-draft')
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(verifyDraftToken).mockResolvedValue(null)

    const res = await POST(
      makeRequest({
        razorpay_order_id: RZP_ORDER_ID,
        razorpay_payment_id: RZP_PAYMENT_ID,
        razorpay_signature: VALID_SIGNATURE,
        draftToken: 'bad-token',
      }) as any
    )
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toMatch(/invalid or expired/i)
  })

  it('returns 403 when draftToken userId does not match', async () => {
    const { verifyDraftToken } = await import('@/lib/order-draft')
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(verifyDraftToken).mockResolvedValue({
      userId: 'other-user-id',
      mode: 'cart',
      cartHash: null,
      couponId: null,
      shippingAmount: 0,
      addressId: null,
      notes: null,
    } as any)

    const res = await POST(
      makeRequest({
        razorpay_order_id: RZP_ORDER_ID,
        razorpay_payment_id: RZP_PAYMENT_ID,
        razorpay_signature: VALID_SIGNATURE,
        draftToken: 'tok_mismatch',
      }) as any
    )
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.error).toMatch(/unauthorized/i)
  })

  it('returns 404 when user not found in commitDraft', async () => {
    const { verifyDraftToken } = await import('@/lib/order-draft')
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(verifyDraftToken).mockResolvedValue({
      userId: AUTH_USER.userId,
      mode: 'cart',
      cartHash: null,
      couponId: null,
      shippingAmount: 0,
      addressId: null,
      notes: null,
    } as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce(null) // idempotency check: no existing payment
      .mockResolvedValueOnce(null) // user not found

    const res = await POST(
      makeRequest({
        razorpay_order_id: RZP_ORDER_ID,
        razorpay_payment_id: RZP_PAYMENT_ID,
        razorpay_signature: VALID_SIGNATURE,
        draftToken: 'tok_nouser',
      }) as any
    )
    const body = await res.json()

    expect(res.status).toBe(404)
    expect(body.error).toMatch(/user not found/i)
  })

  it('returns 400 when cart is empty in commitDraft cart mode', async () => {
    const { verifyDraftToken } = await import('@/lib/order-draft')
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(verifyDraftToken).mockResolvedValue({
      userId: AUTH_USER.userId,
      mode: 'cart',
      cartHash: null,
      couponId: null,
      shippingAmount: 0,
      addressId: null,
      notes: null,
    } as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce(null) // idempotency check: no existing payment
      .mockResolvedValueOnce(MOCK_USER) // user lookup
    vi.mocked(orderCommit.loadActiveCart).mockResolvedValue([] as any)

    const res = await POST(
      makeRequest({
        razorpay_order_id: RZP_ORDER_ID,
        razorpay_payment_id: RZP_PAYMENT_ID,
        razorpay_signature: VALID_SIGNATURE,
        draftToken: 'tok_emptycart',
      }) as any
    )
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toMatch(/cart is empty/i)
  })

  it('returns 409 when cart hash changed during payment in commitDraft', async () => {
    const { verifyDraftToken, hashCartItems } = await import('@/lib/order-draft')
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(verifyDraftToken).mockResolvedValue({
      userId: AUTH_USER.userId,
      mode: 'cart',
      cartHash: 'original-hash',
      couponId: null,
      shippingAmount: 0,
      addressId: null,
      notes: null,
    } as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce(null) // idempotency check: no existing payment
      .mockResolvedValueOnce(MOCK_USER) // user lookup
    vi.mocked(orderCommit.loadActiveCart).mockResolvedValue([{ product_id: 'p1' }] as any)
    vi.mocked(orderCommit.cartItemsForHash).mockReturnValue([{ product_id: 'p1' }] as any)
    vi.mocked(hashCartItems).mockReturnValue('different-hash')

    const res = await POST(
      makeRequest({
        razorpay_order_id: RZP_ORDER_ID,
        razorpay_payment_id: RZP_PAYMENT_ID,
        razorpay_signature: VALID_SIGNATURE,
        draftToken: 'tok_changed',
      }) as any
    )
    const body = await res.json()

    expect(res.status).toBe(409)
    expect(body.error).toMatch(/cart changed/i)
  })

  it('commits draftToken buyNow order successfully', async () => {
    const { verifyDraftToken } = await import('@/lib/order-draft')
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(verifyDraftToken).mockResolvedValue({
      userId: AUTH_USER.userId,
      mode: 'buyNow',
      buyNowItem: { productId: 'prod-1', variantId: null, subVariantId: null, price: 500, qty: 1 },
      cartHash: null,
      couponId: null,
      shippingAmount: 0,
      addressId: null,
      notes: null,
    } as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce(null) // idempotency check: no existing payment
      .mockResolvedValueOnce(MOCK_USER) // user
      .mockResolvedValueOnce({ id: 'prod-1', name: 'Bolt', sku: 'B001', gst_percentage: '18', hsn_code: '7318' }) // product
      .mockResolvedValueOnce(MOCK_USER) // post-commit queryOne calls
      .mockResolvedValueOnce({ id: 'order-new', order_number: 'ORD-NEW', total_amount: '500', payment_status: 'paid' })
    vi.mocked(db.queryMany).mockResolvedValue([])
    vi.mocked(orderCommit.commitOrder).mockResolvedValue({
      id: 'order-new',
      order_number: 'ORD-NEW',
      total_amount: '500',
    } as any)

    const res = await POST(
      makeRequest({
        razorpay_order_id: RZP_ORDER_ID,
        razorpay_payment_id: RZP_PAYMENT_ID,
        razorpay_signature: VALID_SIGNATURE,
        draftToken: 'tok_buynow',
      }) as any
    )
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(orderCommit.commitOrder).toHaveBeenCalledOnce()
  })

  it('markLegacyOrderPaid: uses business query when x-auth-portal header present', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue({ ...AUTH_USER, isBusiness: false } as any)
    // isBusiness branch: bizUser lookup, then order lookup
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce({ email: AUTH_USER.email, phone: null }) // bizUser
      .mockResolvedValueOnce(MOCK_ORDER) // order
      .mockResolvedValueOnce(MOCK_USER) // user post-transaction
      .mockResolvedValueOnce(MOCK_ORDER) // updatedOrder

    vi.mocked(db.queryMany).mockResolvedValue([])
    vi.mocked(db.withTransaction).mockImplementation(async (fn: any) => {
      const client = {
        query: vi.fn().mockResolvedValue({ rows: [], rowCount: 1 }),
      }
      return fn(client)
    })

    const res = await POST(
      makeRequest(
        {
          razorpay_order_id: RZP_ORDER_ID,
          razorpay_payment_id: RZP_PAYMENT_ID,
          razorpay_signature: VALID_SIGNATURE,
          orderId: ORDER_UUID,
        },
        { 'x-auth-portal': 'business' }
      ) as any
    )
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
  })

  it('markLegacyOrderPaid: inserts payment when update rowCount=0', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce(MOCK_ORDER) // order lookup
      .mockResolvedValueOnce(MOCK_USER) // user post-tx
      .mockResolvedValueOnce(MOCK_ORDER) // updatedOrder

    vi.mocked(db.queryMany).mockResolvedValue([])
    vi.mocked(db.withTransaction).mockImplementation(async (fn: any) => {
      const client = {
        query: vi
          .fn()
          .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // UPDATE orders
          .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // UPDATE payments (no match → triggers INSERT)
          .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // INSERT payment
          .mockResolvedValue({ rows: [], rowCount: 1 }), // DELETE cart
      }
      return fn(client)
    })

    const res = await POST(
      makeRequest({
        razorpay_order_id: RZP_ORDER_ID,
        razorpay_payment_id: RZP_PAYMENT_ID,
        razorpay_signature: VALID_SIGNATURE,
        orderId: ORDER_UUID,
      }) as any
    )
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
  })

  it('triggers high-value order auto-task when total >= 50000 in commitDraft', async () => {
    const { createAutoTask } = await import('@/lib/auto-tasks')
    const { verifyDraftToken, hashCartItems } = await import('@/lib/order-draft')

    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(verifyDraftToken).mockResolvedValue({
      userId: AUTH_USER.userId,
      mode: 'cart',
      cartHash: 'hash-hv',
      couponId: null,
      shippingAmount: 0,
      addressId: null,
      notes: null,
    } as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce(null) // idempotency check: no existing payment
      .mockResolvedValueOnce(MOCK_USER) // user lookup
      .mockResolvedValue(MOCK_ORDER) // post-commit order/item lookups
    vi.mocked(db.queryMany).mockResolvedValue([])
    vi.mocked(orderCommit.loadActiveCart).mockResolvedValue([{ product_id: 'p1' }] as any)
    vi.mocked(orderCommit.cartItemsForHash).mockReturnValue([{ product_id: 'p1' }] as any)
    vi.mocked(hashCartItems).mockReturnValue('hash-hv')
    vi.mocked(orderCommit.cartSubtotal).mockReturnValue(50000)
    vi.mocked(orderCommit.cartTaxAmount).mockReturnValue(7627)
    vi.mocked(orderCommit.commitOrder).mockResolvedValue({
      id: 'order-hv',
      order_number: 'ORD-HV',
      total_amount: '50000',
    } as any)

    const res = await POST(
      makeRequest({
        razorpay_order_id: RZP_ORDER_ID,
        razorpay_payment_id: RZP_PAYMENT_ID,
        razorpay_signature: VALID_SIGNATURE,
        draftToken: 'tok_hv',
      }) as any
    )

    expect(res.status).toBe(200)
    expect(vi.mocked(createAutoTask)).toHaveBeenCalled()
  })

  it('returns 500 on unexpected error', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(db.queryOne).mockRejectedValue(new Error('DB crash'))

    const res = await POST(
      makeRequest({
        razorpay_order_id: RZP_ORDER_ID,
        razorpay_payment_id: RZP_PAYMENT_ID,
        razorpay_signature: VALID_SIGNATURE,
        orderId: ORDER_UUID,
      }) as any
    )

    expect(res.status).toBe(500)
  })

  it('commitDraft idempotency: returns existing order when payment already committed', async () => {
    const { verifyDraftToken } = await import('@/lib/order-draft')
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(verifyDraftToken).mockResolvedValue({
      userId: AUTH_USER.userId,
      mode: 'cart',
      cartHash: null,
      couponId: null,
      shippingAmount: 0,
      addressId: null,
      notes: null,
    } as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce({ id: ORDER_UUID, order_number: 'ORD-001' })

    const res = await POST(
      makeRequest({
        razorpay_order_id: RZP_ORDER_ID,
        razorpay_payment_id: RZP_PAYMENT_ID,
        razorpay_signature: VALID_SIGNATURE,
        draftToken: 'tok_idem',
      }) as any
    )
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.order.orderNumber).toBe('ORD-001')
    expect(orderCommit.commitOrder).not.toHaveBeenCalled()
  })

  it('commitDraft: applies coupon discount when couponId is present', async () => {
    const { verifyDraftToken, hashCartItems } = await import('@/lib/order-draft')
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(verifyDraftToken).mockResolvedValue({
      userId: AUTH_USER.userId,
      mode: 'cart',
      cartHash: 'hash-coup',
      couponId: 'coup-uuid-1',
      shippingAmount: 0,
      addressId: null,
      notes: null,
      businessDiscountAmount: 0,
    } as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce(null).mockResolvedValueOnce(MOCK_USER).mockResolvedValue(MOCK_ORDER)
    vi.mocked(db.queryMany).mockResolvedValue([])
    vi.mocked(orderCommit.loadActiveCart).mockResolvedValue([{ product_id: 'p1' }] as any)
    vi.mocked(orderCommit.cartItemsForHash).mockReturnValue([{ product_id: 'p1' }] as any)
    vi.mocked(hashCartItems).mockReturnValue('hash-coup')
    vi.mocked(orderCommit.cartSubtotal).mockReturnValue(500)
    vi.mocked(orderCommit.cartTaxAmount).mockReturnValue(76)
    vi.mocked(orderCommit.validateCouponForUser).mockResolvedValue({ ok: true, appliedDiscount: 50 } as any)
    vi.mocked(orderCommit.commitOrder).mockResolvedValue({
      id: 'order-coup',
      order_number: 'ORD-C',
      total_amount: '450',
    } as any)

    const res = await POST(
      makeRequest({
        razorpay_order_id: RZP_ORDER_ID,
        razorpay_payment_id: RZP_PAYMENT_ID,
        razorpay_signature: VALID_SIGNATURE,
        draftToken: 'tok_coupon',
      }) as any
    )

    expect(res.status).toBe(200)
    expect(orderCommit.validateCouponForUser).toHaveBeenCalledWith(expect.objectContaining({ couponId: 'coup-uuid-1' }))
  })

  it('commitDraft buyNow: returns 404 when product not found', async () => {
    const { verifyDraftToken } = await import('@/lib/order-draft')
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(verifyDraftToken).mockResolvedValue({
      userId: AUTH_USER.userId,
      mode: 'buyNow',
      buyNowItem: { productId: 'missing-prod', variantId: null, subVariantId: null, price: 100, qty: 1 },
      cartHash: null,
      couponId: null,
      shippingAmount: 0,
      addressId: null,
      notes: null,
    } as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce(null).mockResolvedValueOnce(MOCK_USER).mockResolvedValueOnce(null) // product not found

    const res = await POST(
      makeRequest({
        razorpay_order_id: RZP_ORDER_ID,
        razorpay_payment_id: RZP_PAYMENT_ID,
        razorpay_signature: VALID_SIGNATURE,
        draftToken: 'tok_noprod',
      }) as any
    )
    const body = await res.json()

    expect(res.status).toBe(404)
    expect(body.error).toMatch(/product not found/i)
  })

  it('commitDraft buyNow: looks up variant and sub-variant when IDs present', async () => {
    const { verifyDraftToken } = await import('@/lib/order-draft')
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(verifyDraftToken).mockResolvedValue({
      userId: AUTH_USER.userId,
      mode: 'buyNow',
      buyNowItem: { productId: 'prod-1', variantId: 'var-1', subVariantId: 'sv-1', price: 500, qty: 2 },
      cartHash: null,
      couponId: null,
      shippingAmount: 0,
      addressId: null,
      notes: null,
      businessDiscountAmount: 0,
    } as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(MOCK_USER)
      .mockResolvedValueOnce({ id: 'prod-1', name: 'Bolt', sku: 'B001', gst_percentage: '18', hsn_code: '7318' })
      .mockResolvedValueOnce({ id: 'var-1', variant_name: 'M8', sku: 'B001-M8', mrp: '600' })
      .mockResolvedValueOnce({ id: 'sv-1', sub_variant_name: 'Box/10', sku: 'B001-M8-10', mrp: '550' })
      .mockResolvedValue(MOCK_ORDER)
    vi.mocked(db.queryMany).mockResolvedValue([])
    vi.mocked(orderCommit.commitOrder).mockResolvedValue({
      id: 'order-bn',
      order_number: 'ORD-BN',
      total_amount: '1000',
    } as any)

    const res = await POST(
      makeRequest({
        razorpay_order_id: RZP_ORDER_ID,
        razorpay_payment_id: RZP_PAYMENT_ID,
        razorpay_signature: VALID_SIGNATURE,
        draftToken: 'tok_bn_variant',
      }) as any
    )

    expect(res.status).toBe(200)
    expect(orderCommit.commitOrder).toHaveBeenCalledWith(expect.objectContaining({ mode: 'buyNow' }))
  })

  it('commitDraft: returns 400 when draft mode is neither cart nor buyNow', async () => {
    const { verifyDraftToken } = await import('@/lib/order-draft')
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(verifyDraftToken).mockResolvedValue({
      userId: AUTH_USER.userId,
      mode: 'unknown_mode',
      cartHash: null,
      couponId: null,
      shippingAmount: 0,
      addressId: null,
      notes: null,
    } as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce(null).mockResolvedValueOnce(MOCK_USER)

    const res = await POST(
      makeRequest({
        razorpay_order_id: RZP_ORDER_ID,
        razorpay_payment_id: RZP_PAYMENT_ID,
        razorpay_signature: VALID_SIGNATURE,
        draftToken: 'tok_bad_mode',
      }) as any
    )
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toMatch(/invalid draft/i)
  })

  it('markLegacyOrderPaid: inserts payment when UPDATE rowCount=0', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce(MOCK_ORDER)
      .mockResolvedValueOnce(MOCK_USER)
      .mockResolvedValueOnce(MOCK_ORDER)
    vi.mocked(db.queryMany).mockResolvedValue([])
    vi.mocked(db.withTransaction).mockImplementation(async (fn: any) => {
      const client = {
        query: vi
          .fn()
          .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // UPDATE orders
          .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // UPDATE payments → no match
          .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // INSERT payment
          .mockResolvedValue({ rows: [], rowCount: 1 }), // DELETE cart
      }
      return fn(client)
    })

    const res = await POST(
      makeRequest({
        razorpay_order_id: RZP_ORDER_ID,
        razorpay_payment_id: RZP_PAYMENT_ID,
        razorpay_signature: VALID_SIGNATURE,
        orderId: ORDER_UUID,
      }) as any
    )
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
  })

  it('triggers high-value order auto-task when total >= 50000 in commitDraft', async () => {
    const { createAutoTask } = await import('@/lib/auto-tasks')
    const { verifyDraftToken, hashCartItems } = await import('@/lib/order-draft')

    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(verifyDraftToken).mockResolvedValue({
      userId: AUTH_USER.userId,
      mode: 'cart',
      cartHash: 'hash-hv',
      couponId: null,
      shippingAmount: 0,
      addressId: null,
      notes: null,
    } as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce(null).mockResolvedValueOnce(MOCK_USER).mockResolvedValue(MOCK_ORDER)
    vi.mocked(db.queryMany).mockResolvedValue([])
    vi.mocked(orderCommit.loadActiveCart).mockResolvedValue([{ product_id: 'p1' }] as any)
    vi.mocked(orderCommit.cartItemsForHash).mockReturnValue([{ product_id: 'p1' }] as any)
    vi.mocked(hashCartItems).mockReturnValue('hash-hv')
    vi.mocked(orderCommit.cartSubtotal).mockReturnValue(50000)
    vi.mocked(orderCommit.cartTaxAmount).mockReturnValue(7627)
    vi.mocked(orderCommit.commitOrder).mockResolvedValue({
      id: 'order-hv',
      order_number: 'ORD-HV',
      total_amount: '50000',
    } as any)

    const res = await POST(
      makeRequest({
        razorpay_order_id: RZP_ORDER_ID,
        razorpay_payment_id: RZP_PAYMENT_ID,
        razorpay_signature: VALID_SIGNATURE,
        draftToken: 'tok_hv',
      }) as any
    )

    expect(res.status).toBe(200)
    expect(vi.mocked(createAutoTask)).toHaveBeenCalled()
  })

  // ── variant-change top-up path (no draftToken/orderId) ────────────────────

  it('variant-change: applies swap and returns success', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    // vcr lookup returns a pending variant_change_request
    vi.mocked(db.queryOne).mockResolvedValueOnce({ id: 'vcr-1', amountPaise: null } as any)
    vi.mocked(variantChange.settleVariantChangePayment).mockResolvedValue({ applied: true } as any)

    const res = await POST(
      makeRequest({
        razorpay_order_id: RZP_ORDER_ID,
        razorpay_payment_id: RZP_PAYMENT_ID,
        razorpay_signature: VALID_SIGNATURE,
      }) as any
    )
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.settlement).toBe('variant_change_applied')
    expect(variantChange.settleVariantChangePayment).toHaveBeenCalled()
  })

  it('variant-change: returns success when already_applied', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce({ id: 'vcr-2', amountPaise: 15000 } as any)
    vi.mocked(variantChange.settleVariantChangePayment).mockResolvedValue({
      applied: false,
      reason: 'already_applied',
    } as any)

    const res = await POST(
      makeRequest({
        razorpay_order_id: RZP_ORDER_ID,
        razorpay_payment_id: RZP_PAYMENT_ID,
        razorpay_signature: VALID_SIGNATURE,
      }) as any
    )
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.settlement).toBe('variant_change_applied')
  })

  it('variant-change: returns 409 when settle fails for another reason', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce({ id: 'vcr-3', amountPaise: 15000 } as any)
    vi.mocked(variantChange.settleVariantChangePayment).mockResolvedValue({
      applied: false,
      reason: 'out_of_stock',
    } as any)

    const res = await POST(
      makeRequest({
        razorpay_order_id: RZP_ORDER_ID,
        razorpay_payment_id: RZP_PAYMENT_ID,
        razorpay_signature: VALID_SIGNATURE,
      }) as any
    )
    const body = await res.json()

    expect(res.status).toBe(409)
    expect(body.error).toMatch(/could not be applied/i)
  })

  it('variant-change: falls back to amount 0 when rzp fetch throws', async () => {
    const { getRazorpayInstance } = await import('@/lib/razorpay')
    vi.mocked(getRazorpayInstance).mockReturnValueOnce({
      orders: { fetch: vi.fn().mockRejectedValue(new Error('rzp down')) },
    } as any)
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce({ id: 'vcr-4', amountPaise: null } as any)
    vi.mocked(variantChange.settleVariantChangePayment).mockResolvedValue({ applied: true } as any)

    const res = await POST(
      makeRequest({
        razorpay_order_id: RZP_ORDER_ID,
        razorpay_payment_id: RZP_PAYMENT_ID,
        razorpay_signature: VALID_SIGNATURE,
      }) as any
    )

    expect(res.status).toBe(200)
    expect(variantChange.settleVariantChangePayment).toHaveBeenCalledWith(expect.objectContaining({ amountPaise: 0 }))
  })

  it('commitDraft: sends SMS when user notification_channel is sms', async () => {
    const { verifyDraftToken, hashCartItems } = await import('@/lib/order-draft')
    const { sendOrderConfirmedSMS } = await import('@/lib/sms')
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(verifyDraftToken).mockResolvedValue({
      userId: AUTH_USER.userId,
      mode: 'cart',
      cartHash: 'hash-sms',
      couponId: null,
      shippingAmount: 0,
      addressId: null,
      notes: null,
      businessDiscountAmount: 0,
    } as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ ...MOCK_USER, notification_channel: 'sms', phone: '9999999999' })
      .mockResolvedValue(MOCK_ORDER)
    vi.mocked(db.queryMany).mockResolvedValue([])
    vi.mocked(orderCommit.loadActiveCart).mockResolvedValue([{ product_id: 'p1' }] as any)
    vi.mocked(orderCommit.cartItemsForHash).mockReturnValue([{ product_id: 'p1' }] as any)
    vi.mocked(hashCartItems).mockReturnValue('hash-sms')
    vi.mocked(orderCommit.cartSubtotal).mockReturnValue(500)
    vi.mocked(orderCommit.cartTaxAmount).mockReturnValue(76)
    vi.mocked(orderCommit.commitOrder).mockResolvedValue({
      id: 'order-sms',
      order_number: 'ORD-SMS',
      total_amount: '500',
    } as any)

    const res = await POST(
      makeRequest({
        razorpay_order_id: RZP_ORDER_ID,
        razorpay_payment_id: RZP_PAYMENT_ID,
        razorpay_signature: VALID_SIGNATURE,
        draftToken: 'tok_sms',
      }) as any
    )

    expect(res.status).toBe(200)
    expect(vi.mocked(sendOrderConfirmedSMS)).toHaveBeenCalled()
  })

  it('markLegacyOrderPaid: sends SMS when user notification_channel is sms', async () => {
    const { sendOrderConfirmedSMS } = await import('@/lib/sms')
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce(MOCK_ORDER)
      .mockResolvedValueOnce({ ...MOCK_USER, notification_channel: 'sms', phone: '9999999999' })
      .mockResolvedValueOnce(MOCK_ORDER)
    vi.mocked(db.queryMany).mockResolvedValue([])
    vi.mocked(db.withTransaction).mockImplementation(async (fn: any) => {
      const client = { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 1 }) }
      return fn(client)
    })

    const res = await POST(
      makeRequest({
        razorpay_order_id: RZP_ORDER_ID,
        razorpay_payment_id: RZP_PAYMENT_ID,
        razorpay_signature: VALID_SIGNATURE,
        orderId: ORDER_UUID,
      }) as any
    )

    expect(res.status).toBe(200)
    expect(vi.mocked(sendOrderConfirmedSMS)).toHaveBeenCalled()
  })

  it('commitDraft: exercises fire-and-forget catch handlers and item maps on rejection', async () => {
    const { verifyDraftToken, hashCartItems } = await import('@/lib/order-draft')
    const email = await import('@/lib/email')
    const invoice = await import('@/lib/invoice')
    const activity = await import('@/lib/activity')
    const aiFeedback = await import('@/lib/ai-feedback')
    const autoTasks = await import('@/lib/auto-tasks')
    const sms = await import('@/lib/sms')

    // Make every fire-and-forget reject so its .catch(() => {}) closure runs.
    vi.mocked(email.sendOrderConfirmationEmail).mockRejectedValue(new Error('x'))
    vi.mocked(email.sendNewOrderNotification).mockRejectedValue(new Error('x'))
    vi.mocked(email.sendPaymentStatusUpdate).mockRejectedValue(new Error('x'))
    vi.mocked(invoice.createDraftInvoice).mockRejectedValue(new Error('x'))
    vi.mocked(activity.logActivity).mockRejectedValue(new Error('x'))
    vi.mocked(aiFeedback.recordImplicitSignalsForProducts).mockRejectedValue(new Error('x'))
    vi.mocked(autoTasks.createAutoTask).mockRejectedValue(new Error('x'))
    vi.mocked(sms.sendOrderConfirmedSMS).mockRejectedValue(new Error('x'))
    // pending_payment_intents UPDATE rejects → its .catch fires
    vi.mocked(db.query).mockRejectedValue(new Error('x'))

    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(verifyDraftToken).mockResolvedValue({
      userId: AUTH_USER.userId,
      mode: 'cart',
      cartHash: 'hash-ff',
      couponId: null,
      shippingAmount: 0,
      addressId: null,
      notes: null,
      businessDiscountAmount: 0,
    } as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ ...MOCK_USER, notification_channel: 'sms', phone: '9999999999' })
      .mockResolvedValue({ ...MOCK_ORDER, total_amount: '60000' })
    // Non-empty order items so the .map() product_id callbacks execute
    vi.mocked(db.queryMany).mockResolvedValue([{ product_id: 'p1' }, { product_id: 'p2' }] as any)
    vi.mocked(orderCommit.loadActiveCart).mockResolvedValue([{ product_id: 'p1' }] as any)
    vi.mocked(orderCommit.cartItemsForHash).mockReturnValue([{ product_id: 'p1' }] as any)
    vi.mocked(hashCartItems).mockReturnValue('hash-ff')
    vi.mocked(orderCommit.cartSubtotal).mockReturnValue(60000)
    vi.mocked(orderCommit.cartTaxAmount).mockReturnValue(9152)
    vi.mocked(orderCommit.commitOrder).mockResolvedValue({
      id: 'order-ff',
      order_number: 'ORD-FF',
      total_amount: '60000',
    } as any)

    const res = await POST(
      makeRequest({
        razorpay_order_id: RZP_ORDER_ID,
        razorpay_payment_id: RZP_PAYMENT_ID,
        razorpay_signature: VALID_SIGNATURE,
        draftToken: 'tok_ff',
      }) as any
    )

    expect(res.status).toBe(200)
    // Give queued microtasks a tick so rejected .catch closures run before assertions end
    await new Promise(r => setTimeout(r, 0))
    expect(vi.mocked(email.sendOrderConfirmationEmail)).toHaveBeenCalled()
  })

  it('markLegacyOrderPaid: exercises catch handlers and maps with non-empty items', async () => {
    const email = await import('@/lib/email')
    const invoice = await import('@/lib/invoice')
    const aiFeedback = await import('@/lib/ai-feedback')
    const sms = await import('@/lib/sms')

    vi.mocked(email.sendOrderConfirmationEmail).mockRejectedValue(new Error('x'))
    vi.mocked(email.sendNewOrderNotification).mockRejectedValue(new Error('x'))
    vi.mocked(email.sendPaymentStatusUpdate).mockRejectedValue(new Error('x'))
    vi.mocked(invoice.createDraftInvoice).mockRejectedValue(new Error('x'))
    vi.mocked(aiFeedback.recordImplicitSignalsForProducts).mockRejectedValue(new Error('x'))
    vi.mocked(sms.sendOrderConfirmedSMS).mockRejectedValue(new Error('x'))

    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce(MOCK_ORDER)
      .mockResolvedValueOnce({ ...MOCK_USER, notification_channel: 'sms', phone: '9999999999' })
      .mockResolvedValueOnce(MOCK_ORDER)
    vi.mocked(db.queryMany).mockResolvedValue([{ product_id: 'p1' }] as any)
    vi.mocked(db.withTransaction).mockImplementation(async (fn: any) => {
      const client = { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 1 }) }
      return fn(client)
    })

    const res = await POST(
      makeRequest({
        razorpay_order_id: RZP_ORDER_ID,
        razorpay_payment_id: RZP_PAYMENT_ID,
        razorpay_signature: VALID_SIGNATURE,
        orderId: ORDER_UUID,
      }) as any
    )

    expect(res.status).toBe(200)
    await new Promise(r => setTimeout(r, 0))
    expect(vi.mocked(invoice.createDraftInvoice)).toHaveBeenCalled()
  })

  it('commitDraft buyNow: GST disabled → taxAmount 0 and missing gst_percentage fallback', async () => {
    const { verifyDraftToken } = await import('@/lib/order-draft')
    const { getFeatureFlags } = await import('@/lib/site-controls')
    vi.mocked(getFeatureFlags).mockResolvedValueOnce({ gstEnabled: false } as any)
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(verifyDraftToken).mockResolvedValue({
      userId: AUTH_USER.userId,
      mode: 'buyNow',
      buyNowItem: { productId: 'prod-1', variantId: null, subVariantId: null, price: 500, qty: 1 },
      cartHash: null,
      couponId: null,
      shippingAmount: 0,
      addressId: null,
      notes: null,
      businessDiscountAmount: 0,
    } as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(MOCK_USER)
      .mockResolvedValueOnce({ id: 'prod-1', name: 'Bolt', sku: 'B001', gst_percentage: null, hsn_code: '7318' })
      .mockResolvedValue(MOCK_ORDER)
    vi.mocked(db.queryMany).mockResolvedValue([])
    vi.mocked(orderCommit.commitOrder).mockResolvedValue({
      id: 'order-nogst',
      order_number: 'ORD-NG',
      total_amount: '500',
    } as any)

    const res = await POST(
      makeRequest({
        razorpay_order_id: RZP_ORDER_ID,
        razorpay_payment_id: RZP_PAYMENT_ID,
        razorpay_signature: VALID_SIGNATURE,
        draftToken: 'tok_nogst',
      }) as any
    )

    expect(res.status).toBe(200)
    expect(orderCommit.commitOrder).toHaveBeenCalledWith(expect.objectContaining({ taxAmount: 0 }))
  })

  it('commitDraft: does not apply discount when coupon validation is not ok', async () => {
    const { verifyDraftToken, hashCartItems } = await import('@/lib/order-draft')
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(verifyDraftToken).mockResolvedValue({
      userId: AUTH_USER.userId,
      mode: 'cart',
      cartHash: 'hash-cx',
      couponId: 'coup-bad',
      shippingAmount: 0,
      addressId: null,
      notes: null,
      businessDiscountAmount: 0,
    } as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce(null).mockResolvedValueOnce(MOCK_USER).mockResolvedValue(MOCK_ORDER)
    vi.mocked(db.queryMany).mockResolvedValue([])
    vi.mocked(orderCommit.loadActiveCart).mockResolvedValue([{ product_id: 'p1' }] as any)
    vi.mocked(orderCommit.cartItemsForHash).mockReturnValue([{ product_id: 'p1' }] as any)
    vi.mocked(hashCartItems).mockReturnValue('hash-cx')
    vi.mocked(orderCommit.cartSubtotal).mockReturnValue(500)
    vi.mocked(orderCommit.cartTaxAmount).mockReturnValue(76)
    vi.mocked(orderCommit.validateCouponForUser).mockResolvedValue({ ok: false } as any)
    vi.mocked(orderCommit.commitOrder).mockResolvedValue({
      id: 'order-cx',
      order_number: 'ORD-CX',
      total_amount: '500',
    } as any)

    const res = await POST(
      makeRequest({
        razorpay_order_id: RZP_ORDER_ID,
        razorpay_payment_id: RZP_PAYMENT_ID,
        razorpay_signature: VALID_SIGNATURE,
        draftToken: 'tok_couponbad',
      }) as any
    )

    expect(res.status).toBe(200)
    expect(orderCommit.commitOrder).toHaveBeenCalledWith(expect.objectContaining({ appliedDiscount: 0 }))
  })

  it('markLegacyOrderPaid: isBusiness=true uses business order lookup, user null skips notifications', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue({ ...AUTH_USER, isBusiness: true } as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce({ email: 'biz@example.com', phone: '8888888888' }) // bizUser
      .mockResolvedValueOnce(MOCK_ORDER) // order
      .mockResolvedValueOnce(null) // user null post-tx
    vi.mocked(db.queryMany).mockResolvedValue([])
    vi.mocked(db.withTransaction).mockImplementation(async (fn: any) => {
      const client = { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 1 }) }
      return fn(client)
    })

    const res = await POST(
      makeRequest({
        razorpay_order_id: RZP_ORDER_ID,
        razorpay_payment_id: RZP_PAYMENT_ID,
        razorpay_signature: VALID_SIGNATURE,
        orderId: ORDER_UUID,
      }) as any
    )
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
  })

  it('markLegacyOrderPaid: bizUser null yields empty email/phone fallbacks', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue({ ...AUTH_USER, isBusiness: true } as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce(null) // bizUser null → '' email, null phone
      .mockResolvedValueOnce(MOCK_ORDER) // order
      .mockResolvedValueOnce({ ...MOCK_USER, first_name: null, last_name: null }) // user w/o names → 'Customer'
      .mockResolvedValueOnce(null) // updatedOrder null → falls back to order
    vi.mocked(db.queryMany).mockResolvedValue([{ product_id: 'p1' }] as any)
    vi.mocked(db.withTransaction).mockImplementation(async (fn: any) => {
      const client = { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 1 }) }
      return fn(client)
    })

    const res = await POST(
      makeRequest({
        razorpay_order_id: RZP_ORDER_ID,
        razorpay_payment_id: RZP_PAYMENT_ID,
        razorpay_signature: VALID_SIGNATURE,
        orderId: ORDER_UUID,
      }) as any
    )

    expect(res.status).toBe(200)
  })

  it('returns 500 with generic message when a non-Error is thrown', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    // queryOne rejects with a non-Error (no .message) → error?.message is undefined → fallback string
    vi.mocked(db.queryOne).mockRejectedValue('boom')

    const res = await POST(
      makeRequest({
        razorpay_order_id: RZP_ORDER_ID,
        razorpay_payment_id: RZP_PAYMENT_ID,
        razorpay_signature: VALID_SIGNATURE,
        orderId: ORDER_UUID,
      }) as any
    )
    const body = await res.json()

    expect(res.status).toBe(500)
    expect(body.error).toMatch(/payment verification failed/i)
  })
})
