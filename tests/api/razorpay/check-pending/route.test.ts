import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/jwt', () => ({
  authenticateAnyUser: vi.fn(),
}))
vi.mock('@/lib/db', () => ({
  queryOne: vi.fn(),
  queryMany: vi.fn(),
  query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
}))
vi.mock('@/lib/razorpay', () => ({
  getRazorpayInstance: vi.fn(),
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
vi.mock('@/lib/email', () => ({
  sendOrderConfirmationEmail: vi.fn().mockResolvedValue(undefined),
  sendNewOrderNotification: vi.fn().mockResolvedValue(undefined),
  sendPaymentStatusUpdate: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/invoice', () => ({
  createDraftInvoice: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/activity', () => ({
  logActivity: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/ai-feedback', () => ({
  recordImplicitSignalsForProducts: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/auto-tasks', () => ({
  createAutoTask: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/validate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/validate')>()
  return { ...actual }
})

import { POST } from '@/app/api/razorpay/check-pending/route'
import * as jwt from '@/lib/jwt'
import * as db from '@/lib/db'
import * as razorpay from '@/lib/razorpay'
import * as orderDraft from '@/lib/order-draft'
import * as orderCommit from '@/lib/order-commit'

// ------------------------------------------------------------------ helpers

function makeRequest(body: unknown) {
  return new Request('http://localhost/api/razorpay/check-pending', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const AUTH_USER = { userId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479', email: 'test@example.com', isBusiness: false }
const RZP_ORDER_ID = 'order_rzp_abc'

const MOCK_USER = {
  id: AUTH_USER.userId,
  email: 'test@example.com',
  first_name: 'Test',
  last_name: 'User',
}

const CAPTURED_PAYMENT = { id: 'pay_captured_1', status: 'captured', amount: 50000 }

function draft(overrides: Record<string, unknown> = {}) {
  return {
    userId: AUTH_USER.userId,
    mode: 'cart',
    couponId: null,
    shippingAmount: 0,
    businessDiscountAmount: 0,
    addressId: 'addr-1',
    notes: null,
    ...overrides,
  }
}

// Configure a razorpay instance mock with the given order + payments behavior
function mockRazorpay(orderResult: any, paymentsResult?: any) {
  vi.mocked(razorpay.getRazorpayInstance).mockReturnValue({
    orders: {
      fetch: vi.fn().mockResolvedValue(orderResult),
      fetchPayments: vi.fn().mockResolvedValue(paymentsResult ?? { items: [] }),
    },
  } as any)
}

const VALID_BODY = { razorpayOrderId: RZP_ORDER_ID, draftToken: 'tok_valid' }

// ------------------------------------------------------------------ tests

describe('POST /api/razorpay/check-pending', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(db.queryOne).mockReset()
    vi.mocked(db.queryMany).mockReset().mockResolvedValue([] as any)
    vi.mocked(db.query).mockReset().mockResolvedValue({ rows: [], rowCount: 0 } as any)
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(orderDraft.verifyDraftToken).mockResolvedValue(draft() as any)
  })

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(null)
    const res = await POST(makeRequest(VALID_BODY) as any)
    const body = await res.json()
    expect(res.status).toBe(401)
    expect(body.error).toMatch(/unauthorized/i)
  })

  it('returns 400 when required fields are missing (validation)', async () => {
    const res = await POST(makeRequest({ razorpayOrderId: '' }) as any)
    expect(res.status).toBeGreaterThanOrEqual(400)
  })

  it('returns 400 when draft token is invalid/expired', async () => {
    vi.mocked(orderDraft.verifyDraftToken).mockResolvedValue(null)
    const res = await POST(makeRequest(VALID_BODY) as any)
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.error).toMatch(/invalid or expired/i)
  })

  it('returns 403 when draft userId does not match auth user', async () => {
    vi.mocked(orderDraft.verifyDraftToken).mockResolvedValue(draft({ userId: 'someone-else' }) as any)
    const res = await POST(makeRequest(VALID_BODY) as any)
    const body = await res.json()
    expect(res.status).toBe(403)
    expect(body.error).toMatch(/unauthorized/i)
  })

  it('returns existing order when payment already committed (idempotent)', async () => {
    // existingOrder query returns a row; intent query returns null
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce({ id: 'ord-existing', order_number: 'ORD-EX' }) // existingOrder
      .mockResolvedValueOnce(null) // intent
    const res = await POST(makeRequest(VALID_BODY) as any)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.order).toEqual({ id: 'ord-existing', orderNumber: 'ORD-EX' })
    // Razorpay should not be fetched on the idempotent path
    expect(razorpay.getRazorpayInstance).not.toHaveBeenCalled()
  })

  it('returns status=pending when razorpay order is created', async () => {
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce(null) // existingOrder
      .mockResolvedValueOnce(null) // intent
    mockRazorpay({ status: 'created' })
    const res = await POST(makeRequest(VALID_BODY) as any)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.status).toBe('pending')
    expect(body.error).toMatch(/not yet completed/i)
  })

  it('returns status=pending when razorpay order is attempted', async () => {
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
    mockRazorpay({ status: 'attempted' })
    const res = await POST(makeRequest(VALID_BODY) as any)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.status).toBe('pending')
  })

  it('returns status=not_paid for any other razorpay order status', async () => {
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
    mockRazorpay({ status: 'failed' })
    const res = await POST(makeRequest(VALID_BODY) as any)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.status).toBe('not_paid')
    expect(body.error).toMatch(/cart has been restored/i)
  })

  it('returns pending when order paid but no captured payment found', async () => {
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
    mockRazorpay({ status: 'paid' }, { items: [{ id: 'p1', status: 'failed' }] })
    const res = await POST(makeRequest(VALID_BODY) as any)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.status).toBe('pending')
    expect(body.error).toMatch(/payment processing/i)
  })

  it('returns pending when payments payload is null/undefined', async () => {
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
    mockRazorpay({ status: 'paid' }, null)
    const res = await POST(makeRequest(VALID_BODY) as any)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.status).toBe('pending')
  })

  it('paid but claim fails, then webhook committed order is found', async () => {
    vi.useFakeTimers()
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce(null) // existingOrder
      .mockResolvedValueOnce(null) // intent
      .mockResolvedValueOnce(null) // claim UPDATE returns nothing (already claimed)
      .mockResolvedValueOnce({ id: 'ord-web', order_number: 'ORD-WEB' }) // committed lookup after wait
    mockRazorpay({ status: 'paid' }, { items: [CAPTURED_PAYMENT] })

    const promise = POST(makeRequest(VALID_BODY) as any)
    await vi.advanceTimersByTimeAsync(1000)
    const res = await promise
    const body = await res.json()
    vi.useRealTimers()

    expect(res.status).toBe(200)
    expect(body.order).toEqual({ id: 'ord-web', orderNumber: 'ORD-WEB' })
  })

  it('paid but claim fails and no committed order found yet -> pending', async () => {
    vi.useFakeTimers()
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce(null) // existingOrder
      .mockResolvedValueOnce(null) // intent
      .mockResolvedValueOnce(null) // claim fails
      .mockResolvedValueOnce(null) // committed lookup still null
    mockRazorpay({ status: 'paid' }, { items: [CAPTURED_PAYMENT] })

    const promise = POST(makeRequest(VALID_BODY) as any)
    await vi.advanceTimersByTimeAsync(1000)
    const res = await promise
    const body = await res.json()
    vi.useRealTimers()

    expect(res.status).toBe(200)
    expect(body.status).toBe('pending')
    expect(body.error).toMatch(/being processed/i)
  })

  it('returns 404 when user not found after successful claim', async () => {
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce(null) // existingOrder
      .mockResolvedValueOnce(null) // intent
      .mockResolvedValueOnce({ id: 'intent-1' }) // claim succeeds
      .mockResolvedValueOnce(null) // user not found
    mockRazorpay({ status: 'paid' }, { items: [CAPTURED_PAYMENT] })
    const res = await POST(makeRequest(VALID_BODY) as any)
    const body = await res.json()
    expect(res.status).toBe(404)
    expect(body.error).toMatch(/user not found/i)
  })

  it('returns 409 when cart is empty in cart mode', async () => {
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce(null) // existingOrder
      .mockResolvedValueOnce(null) // intent
      .mockResolvedValueOnce({ id: 'intent-1' }) // claim
      .mockResolvedValueOnce(MOCK_USER) // user
    vi.mocked(orderCommit.loadActiveCart).mockResolvedValue([] as any)
    mockRazorpay({ status: 'paid' }, { items: [CAPTURED_PAYMENT] })
    const res = await POST(makeRequest(VALID_BODY) as any)
    const body = await res.json()
    expect(res.status).toBe(409)
    expect(body.error).toMatch(/cart is empty/i)
  })

  it('commits a cart-mode order successfully (happy path with coupon)', async () => {
    // Force the fire-and-forget side-effects to reject so their .catch() closures execute
    const invoice = await import('@/lib/invoice')
    const email = await import('@/lib/email')
    const activity = await import('@/lib/activity')
    const aiFeedback = await import('@/lib/ai-feedback')
    vi.mocked(invoice.createDraftInvoice).mockRejectedValue(new Error('x'))
    vi.mocked(email.sendOrderConfirmationEmail).mockRejectedValue(new Error('x'))
    vi.mocked(email.sendNewOrderNotification).mockRejectedValue(new Error('x'))
    vi.mocked(email.sendPaymentStatusUpdate).mockRejectedValue(new Error('x'))
    vi.mocked(activity.logActivity).mockRejectedValue(new Error('x'))
    vi.mocked(aiFeedback.recordImplicitSignalsForProducts).mockRejectedValue(new Error('x'))

    vi.mocked(orderDraft.verifyDraftToken).mockResolvedValue(draft({ couponId: 'coupon-1' }) as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce(null) // existingOrder
      .mockResolvedValueOnce(null) // intent
      .mockResolvedValueOnce({ id: 'intent-1' }) // claim
      .mockResolvedValueOnce(MOCK_USER) // user
      .mockResolvedValueOnce({ ...MOCK_USER }) // fullOrder lookup
    vi.mocked(db.queryMany).mockResolvedValue([{ product_id: 'p1' }] as any)
    vi.mocked(orderCommit.loadActiveCart).mockResolvedValue([{ product_id: 'p1' }] as any)
    vi.mocked(orderCommit.cartSubtotal).mockReturnValue(500)
    vi.mocked(orderCommit.cartTaxAmount).mockReturnValue(76)
    vi.mocked(orderCommit.validateCouponForUser).mockResolvedValue({ ok: true, appliedDiscount: 50 } as any)
    vi.mocked(orderCommit.commitOrder).mockResolvedValue({
      id: 'order-new', order_number: 'ORD-NEW', total_amount: '450',
    } as any)

    mockRazorpay({ status: 'paid' }, { items: [CAPTURED_PAYMENT] })
    const res = await POST(makeRequest(VALID_BODY) as any)
    const body = await res.json()
    // allow fire-and-forget .catch() handlers to run
    await new Promise((r) => setTimeout(r, 0))
    expect(res.status).toBe(200)
    expect(body.order).toEqual({ id: 'order-new', orderNumber: 'ORD-NEW' })
    expect(orderCommit.commitOrder).toHaveBeenCalledOnce()
    expect(orderCommit.validateCouponForUser).toHaveBeenCalledOnce()
  })

  it('commits cart-mode order when coupon validation fails (no discount applied)', async () => {
    vi.mocked(orderDraft.verifyDraftToken).mockResolvedValue(draft({ couponId: 'coupon-bad' }) as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'intent-1' })
      .mockResolvedValueOnce(MOCK_USER)
      .mockResolvedValueOnce({ ...MOCK_USER })
    vi.mocked(orderCommit.loadActiveCart).mockResolvedValue([{ product_id: 'p1' }] as any)
    vi.mocked(orderCommit.cartSubtotal).mockReturnValue(500)
    vi.mocked(orderCommit.cartTaxAmount).mockReturnValue(76)
    vi.mocked(orderCommit.validateCouponForUser).mockResolvedValue({ ok: false } as any)
    vi.mocked(orderCommit.commitOrder).mockResolvedValue({
      id: 'order-nc', order_number: 'ORD-NC', total_amount: '500',
    } as any)

    mockRazorpay({ status: 'paid' }, { items: [CAPTURED_PAYMENT] })
    const res = await POST(makeRequest(VALID_BODY) as any)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.order.id).toBe('order-nc')
  })

  it('buyNow mode: returns 404 when product not found', async () => {
    vi.mocked(orderDraft.verifyDraftToken).mockResolvedValue(draft({
      mode: 'buyNow',
      buyNowItem: { productId: 'prod-1', variantId: null, subVariantId: null, price: 500, qty: 1 },
    }) as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce(null) // existingOrder
      .mockResolvedValueOnce(null) // intent
      .mockResolvedValueOnce({ id: 'intent-1' }) // claim
      .mockResolvedValueOnce(MOCK_USER) // user
      .mockResolvedValueOnce(null) // product not found
    mockRazorpay({ status: 'paid' }, { items: [CAPTURED_PAYMENT] })
    const res = await POST(makeRequest(VALID_BODY) as any)
    const body = await res.json()
    expect(res.status).toBe(404)
    expect(body.error).toMatch(/product not found/i)
  })

  it('buyNow mode: commits order successfully with variant and subVariant', async () => {
    vi.mocked(orderDraft.verifyDraftToken).mockResolvedValue(draft({
      mode: 'buyNow',
      buyNowItem: { productId: 'prod-1', variantId: 'var-1', subVariantId: 'sub-1', price: 500, qty: 2 },
    }) as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce(null) // existingOrder
      .mockResolvedValueOnce(null) // intent
      .mockResolvedValueOnce({ id: 'intent-1' }) // claim
      .mockResolvedValueOnce(MOCK_USER) // user
      .mockResolvedValueOnce({ id: 'prod-1', name: 'Bolt', sku: 'B001', gst_percentage: '18', hsn_code: '7318' }) // product
      .mockResolvedValueOnce({ id: 'var-1', variant_name: 'M8', sku: 'B001-M8', mrp: '600' }) // variant
      .mockResolvedValueOnce({ id: 'sub-1', sub_variant_name: '30mm', sku: 'B001-M8-30', mrp: '650' }) // subVariant
      .mockResolvedValueOnce({ ...MOCK_USER }) // fullOrder lookup
    vi.mocked(orderCommit.commitOrder).mockResolvedValue({
      id: 'order-bn', order_number: 'ORD-BN', total_amount: '1000',
    } as any)

    mockRazorpay({ status: 'paid' }, { items: [CAPTURED_PAYMENT] })
    const res = await POST(makeRequest(VALID_BODY) as any)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.order.id).toBe('order-bn')
    expect(orderCommit.commitOrder).toHaveBeenCalledOnce()
  })

  it('buyNow mode: handles missing gst_percentage (defaults to 0)', async () => {
    vi.mocked(orderDraft.verifyDraftToken).mockResolvedValue(draft({
      mode: 'buyNow',
      buyNowItem: { productId: 'prod-2', variantId: null, subVariantId: null, price: 100, qty: 1 },
    }) as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'intent-1' })
      .mockResolvedValueOnce(MOCK_USER)
      .mockResolvedValueOnce({ id: 'prod-2', name: 'Nut', sku: 'N001', gst_percentage: null, hsn_code: '7318' })
      .mockResolvedValueOnce({ ...MOCK_USER })
    vi.mocked(orderCommit.commitOrder).mockResolvedValue({
      id: 'order-bn2', order_number: 'ORD-BN2', total_amount: '100',
    } as any)

    mockRazorpay({ status: 'paid' }, { items: [CAPTURED_PAYMENT] })
    const res = await POST(makeRequest(VALID_BODY) as any)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.order.id).toBe('order-bn2')
  })

  it('returns 400 when draft mode is invalid (not cart or buyNow)', async () => {
    vi.mocked(orderDraft.verifyDraftToken).mockResolvedValue(draft({ mode: 'unknown' }) as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'intent-1' })
      .mockResolvedValueOnce(MOCK_USER)
    mockRazorpay({ status: 'paid' }, { items: [CAPTURED_PAYMENT] })
    const res = await POST(makeRequest(VALID_BODY) as any)
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.error).toMatch(/invalid draft/i)
  })

  it('returns 400 when buyNow mode has no buyNowItem', async () => {
    vi.mocked(orderDraft.verifyDraftToken).mockResolvedValue(draft({ mode: 'buyNow', buyNowItem: null }) as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'intent-1' })
      .mockResolvedValueOnce(MOCK_USER)
    mockRazorpay({ status: 'paid' }, { items: [CAPTURED_PAYMENT] })
    const res = await POST(makeRequest(VALID_BODY) as any)
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.error).toMatch(/invalid draft/i)
  })

  it('returns 500 on unexpected error', async () => {
    vi.mocked(db.queryOne).mockRejectedValue(new Error('DB crash'))
    const res = await POST(makeRequest(VALID_BODY) as any)
    const body = await res.json()
    expect(res.status).toBe(500)
    expect(body.error).toMatch(/db crash/i)
  })

  it('returns 500 with fallback message when error has no message', async () => {
    vi.mocked(db.queryOne).mockRejectedValue({})
    const res = await POST(makeRequest(VALID_BODY) as any)
    const body = await res.json()
    expect(res.status).toBe(500)
    expect(body.error).toMatch(/could not check payment status/i)
  })
})
