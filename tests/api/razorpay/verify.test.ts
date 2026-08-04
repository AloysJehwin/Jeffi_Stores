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
vi.mock('@/lib/validate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/validate')>()
  return { ...actual }
})

import { POST } from '@/app/api/razorpay/verify/route'
import * as jwt from '@/lib/jwt'
import * as db from '@/lib/db'
import * as orderCommit from '@/lib/order-commit'

// ------------------------------------------------------------------ helpers

const SECRET = 'test_secret_key'

function computeSignature(orderId: string, paymentId: string): string {
  return crypto
    .createHmac('sha256', SECRET)
    .update(`${orderId}|${paymentId}`)
    .digest('hex')
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
    vi.mocked(db.queryMany).mockReset().mockResolvedValue([] as any)
    vi.mocked(db.query).mockReset().mockResolvedValue({ rows: [], rowCount: 0 } as any)
    vi.mocked(db.withTransaction).mockReset()
  })

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(null)

    const res = await POST(makeRequest({
      razorpay_order_id: RZP_ORDER_ID,
      razorpay_payment_id: RZP_PAYMENT_ID,
      razorpay_signature: VALID_SIGNATURE,
      orderId: ORDER_UUID,
    }) as any)
    const body = await res.json()

    expect(res.status).toBe(401)
    expect(body.error).toMatch(/unauthorized/i)
  })

  it('returns 400 when razorpay_signature is invalid', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)

    // orderId must be a valid UUID so parseBody passes — the HMAC check fires after
    const res = await POST(makeRequest({
      razorpay_order_id: RZP_ORDER_ID,
      razorpay_payment_id: RZP_PAYMENT_ID,
      razorpay_signature: 'badbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadb',
      orderId: ORDER_UUID,
    }) as any)
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toMatch(/invalid payment signature/i)
  })

  it('returns 400 when required fields are missing', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)

    // Missing razorpay_payment_id
    const res = await POST(makeRequest({
      razorpay_order_id: RZP_ORDER_ID,
      razorpay_signature: VALID_SIGNATURE,
    }) as any)
    const body = await res.json()

    // parseBody returns a 400-level error response
    expect(res.status).toBeGreaterThanOrEqual(400)
  })

  it('returns 400 when neither orderId nor draftToken is provided (valid signature)', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)

    const res = await POST(makeRequest({
      razorpay_order_id: RZP_ORDER_ID,
      razorpay_payment_id: RZP_PAYMENT_ID,
      razorpay_signature: VALID_SIGNATURE,
      // no orderId, no draftToken
    }) as any)
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toMatch(/required/i)
  })

  it('happy path with orderId: marks order paid and returns success', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)

    // markLegacyOrderPaid: order lookup, withTransaction, user + orderItems, final order
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce(MOCK_ORDER)        // order lookup for legacy path
      .mockResolvedValueOnce(MOCK_USER)         // user after transaction
      .mockResolvedValueOnce(MOCK_ORDER)        // updatedOrder after transaction

    vi.mocked(db.queryMany).mockResolvedValue([]) // orderItems

    vi.mocked(db.withTransaction).mockImplementation(async (fn: any) => {
      const client = {
        query: vi.fn().mockResolvedValue({ rows: [], rowCount: 1 }),
      }
      return fn(client)
    })

    const res = await POST(makeRequest({
      razorpay_order_id: RZP_ORDER_ID,
      razorpay_payment_id: RZP_PAYMENT_ID,
      razorpay_signature: VALID_SIGNATURE,
      orderId: ORDER_UUID,
    }) as any)
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

    const res = await POST(makeRequest({
      razorpay_order_id: RZP_ORDER_ID,
      razorpay_payment_id: RZP_PAYMENT_ID,
      razorpay_signature: VALID_SIGNATURE,
      orderId: ORDER_UUID,
    }) as any)
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

    const res = await POST(makeRequest({
      razorpay_order_id: RZP_ORDER_ID,
      razorpay_payment_id: RZP_PAYMENT_ID,
      razorpay_signature: VALID_SIGNATURE,
      orderId: ORDER_UUID,
    }) as any)
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
      .mockResolvedValueOnce(null)       // idempotency check: no existing payment
      .mockResolvedValueOnce(MOCK_USER)  // user lookup
      .mockResolvedValue(MOCK_ORDER)     // post-commit order/item lookups
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

    const res = await POST(makeRequest({
      razorpay_order_id: RZP_ORDER_ID,
      razorpay_payment_id: RZP_PAYMENT_ID,
      razorpay_signature: VALID_SIGNATURE,
      draftToken: 'tok_valid',
    }) as any)
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

    const res = await POST(makeRequest({
      razorpay_order_id: RZP_ORDER_ID,
      razorpay_payment_id: RZP_PAYMENT_ID,
      razorpay_signature: VALID_SIGNATURE,
      draftToken: 'bad-token',
    }) as any)
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

    const res = await POST(makeRequest({
      razorpay_order_id: RZP_ORDER_ID,
      razorpay_payment_id: RZP_PAYMENT_ID,
      razorpay_signature: VALID_SIGNATURE,
      draftToken: 'tok_mismatch',
    }) as any)
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

    const res = await POST(makeRequest({
      razorpay_order_id: RZP_ORDER_ID,
      razorpay_payment_id: RZP_PAYMENT_ID,
      razorpay_signature: VALID_SIGNATURE,
      draftToken: 'tok_nouser',
    }) as any)
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
      .mockResolvedValueOnce(null)      // idempotency check: no existing payment
      .mockResolvedValueOnce(MOCK_USER) // user lookup
    vi.mocked(orderCommit.loadActiveCart).mockResolvedValue([] as any)

    const res = await POST(makeRequest({
      razorpay_order_id: RZP_ORDER_ID,
      razorpay_payment_id: RZP_PAYMENT_ID,
      razorpay_signature: VALID_SIGNATURE,
      draftToken: 'tok_emptycart',
    }) as any)
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
      .mockResolvedValueOnce(null)      // idempotency check: no existing payment
      .mockResolvedValueOnce(MOCK_USER) // user lookup
    vi.mocked(orderCommit.loadActiveCart).mockResolvedValue([{ product_id: 'p1' }] as any)
    vi.mocked(orderCommit.cartItemsForHash).mockReturnValue([{ product_id: 'p1' }] as any)
    vi.mocked(hashCartItems).mockReturnValue('different-hash')

    const res = await POST(makeRequest({
      razorpay_order_id: RZP_ORDER_ID,
      razorpay_payment_id: RZP_PAYMENT_ID,
      razorpay_signature: VALID_SIGNATURE,
      draftToken: 'tok_changed',
    }) as any)
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
      .mockResolvedValueOnce(null)                          // idempotency check: no existing payment
      .mockResolvedValueOnce(MOCK_USER)                     // user
      .mockResolvedValueOnce({ id: 'prod-1', name: 'Bolt', sku: 'B001', gst_percentage: '18', hsn_code: '7318' }) // product
      .mockResolvedValueOnce(MOCK_USER)                     // post-commit queryOne calls
      .mockResolvedValueOnce({ id: 'order-new', order_number: 'ORD-NEW', total_amount: '500', payment_status: 'paid' })
    vi.mocked(db.queryMany).mockResolvedValue([])
    vi.mocked(orderCommit.commitOrder).mockResolvedValue({
      id: 'order-new',
      order_number: 'ORD-NEW',
      total_amount: '500',
    } as any)

    const res = await POST(makeRequest({
      razorpay_order_id: RZP_ORDER_ID,
      razorpay_payment_id: RZP_PAYMENT_ID,
      razorpay_signature: VALID_SIGNATURE,
      draftToken: 'tok_buynow',
    }) as any)
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
      .mockResolvedValueOnce(MOCK_ORDER)                               // order
      .mockResolvedValueOnce(MOCK_USER)                                // user post-transaction
      .mockResolvedValueOnce(MOCK_ORDER)                               // updatedOrder

    vi.mocked(db.queryMany).mockResolvedValue([])
    vi.mocked(db.withTransaction).mockImplementation(async (fn: any) => {
      const client = {
        query: vi.fn().mockResolvedValue({ rows: [], rowCount: 1 }),
      }
      return fn(client)
    })

    const res = await POST(makeRequest({
      razorpay_order_id: RZP_ORDER_ID,
      razorpay_payment_id: RZP_PAYMENT_ID,
      razorpay_signature: VALID_SIGNATURE,
      orderId: ORDER_UUID,
    }, { 'x-auth-portal': 'business' }) as any)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
  })

  it('markLegacyOrderPaid: inserts payment when update rowCount=0', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce(MOCK_ORDER) // order lookup
      .mockResolvedValueOnce(MOCK_USER)  // user post-tx
      .mockResolvedValueOnce(MOCK_ORDER) // updatedOrder

    vi.mocked(db.queryMany).mockResolvedValue([])
    vi.mocked(db.withTransaction).mockImplementation(async (fn: any) => {
      const client = {
        query: vi.fn()
          .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // UPDATE orders
          .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // UPDATE payments (no match → triggers INSERT)
          .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // INSERT payment
          .mockResolvedValue({ rows: [], rowCount: 1 }),    // DELETE cart
      }
      return fn(client)
    })

    const res = await POST(makeRequest({
      razorpay_order_id: RZP_ORDER_ID,
      razorpay_payment_id: RZP_PAYMENT_ID,
      razorpay_signature: VALID_SIGNATURE,
      orderId: ORDER_UUID,
    }) as any)
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
      .mockResolvedValueOnce(null)       // idempotency check: no existing payment
      .mockResolvedValueOnce(MOCK_USER)  // user lookup
      .mockResolvedValue(MOCK_ORDER)     // post-commit order/item lookups
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

    const res = await POST(makeRequest({
      razorpay_order_id: RZP_ORDER_ID,
      razorpay_payment_id: RZP_PAYMENT_ID,
      razorpay_signature: VALID_SIGNATURE,
      draftToken: 'tok_hv',
    }) as any)

    expect(res.status).toBe(200)
    expect(vi.mocked(createAutoTask)).toHaveBeenCalled()
  })

  it('returns 500 on unexpected error', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(db.queryOne).mockRejectedValue(new Error('DB crash'))

    const res = await POST(makeRequest({
      razorpay_order_id: RZP_ORDER_ID,
      razorpay_payment_id: RZP_PAYMENT_ID,
      razorpay_signature: VALID_SIGNATURE,
      orderId: ORDER_UUID,
    }) as any)

    expect(res.status).toBe(500)
  })
})
