import { describe, it, expect, vi, beforeEach } from 'vitest'
import crypto from 'crypto'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/lib/shared/db', () => ({
  queryOne: vi.fn().mockResolvedValue(null),
  queryMany: vi.fn().mockResolvedValue([]),
  query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  withTransaction: vi
    .fn()
    .mockImplementation(async (fn: any) => fn({ query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }) })),
}))

vi.mock('@/lib/email', () => ({
  sendOrderConfirmationEmail: vi.fn().mockResolvedValue(undefined),
  sendNewOrderNotification: vi.fn().mockResolvedValue(undefined),
  sendPaymentStatusUpdate: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/shared/auto-tasks', () => ({
  createAutoTask: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/shared/marketing', () => ({
  attributeConversion: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/orders/order-draft', () => ({
  verifyDraftToken: vi.fn().mockResolvedValue(null),
  hashCartItems: vi.fn().mockReturnValue('hash'),
}))

vi.mock('@/lib/orders/order-commit', () => ({
  loadActiveCart: vi.fn().mockResolvedValue([]),
  cartSubtotal: vi.fn().mockReturnValue(100),
  cartTaxAmount: vi.fn().mockReturnValue(18),
  cartItemsForHash: vi.fn().mockReturnValue([]),
  validateCouponForUser: vi.fn().mockResolvedValue({ ok: false }),
  commitOrder: vi.fn().mockResolvedValue({ id: 'ord-1', order_number: 'JS-001', total_amount: '100' }),
}))

vi.mock('@/lib/documents/invoice', () => ({
  createDraftInvoice: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/shared/activity', () => ({
  logActivity: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/shared/ai-feedback', () => ({
  recordImplicitSignalsForProducts: vi.fn().mockResolvedValue(undefined),
}))

// getFeatureFlags() runs a real queryMany (site-controls) unless mocked, which
// would consume a queued db mock and desync the sequence. Stub it out.
vi.mock('@/lib/catalog/site-controls', () => ({
  getFeatureFlags: vi.fn().mockResolvedValue({ gstEnabled: true }),
}))

// ---------------------------------------------------------------------------

import { POST } from '@/app/api/(public)/webhooks/razorpay/route'
import * as db from '@/lib/shared/db'
import * as email from '@/lib/email'
import * as autoTasks from '@/lib/shared/auto-tasks'
import * as orderDraft from '@/lib/orders/order-draft'
import * as orderCommit from '@/lib/orders/order-commit'
import * as invoice from '@/lib/documents/invoice'
import * as activity from '@/lib/shared/activity'
import * as aiFeedback from '@/lib/shared/ai-feedback'
import * as marketing from '@/lib/shared/marketing'

const queryOne = db.queryOne as unknown as ReturnType<typeof vi.fn>
const queryMany = db.queryMany as unknown as ReturnType<typeof vi.fn>
const query = db.query as unknown as ReturnType<typeof vi.fn>
const withTransaction = db.withTransaction as unknown as ReturnType<typeof vi.fn>
const verifyDraftToken = orderDraft.verifyDraftToken as unknown as ReturnType<typeof vi.fn>
const loadActiveCart = orderCommit.loadActiveCart as unknown as ReturnType<typeof vi.fn>
const validateCouponForUser = orderCommit.validateCouponForUser as unknown as ReturnType<typeof vi.fn>
const commitOrder = orderCommit.commitOrder as unknown as ReturnType<typeof vi.fn>
const createAutoTask = autoTasks.createAutoTask as unknown as ReturnType<typeof vi.fn>

const WEBHOOK_SECRET = 'test-webhook-secret'

function signedRequest(bodyObj: any, secret = WEBHOOK_SECRET) {
  const body = JSON.stringify(bodyObj)
  const sig = crypto.createHmac('sha256', secret).update(body).digest('hex')
  return new Request('http://localhost/api/webhooks/razorpay', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-razorpay-signature': sig,
    },
    body,
  }) as any
}

// Convenience event envelopes ------------------------------------------------

function paymentCaptured(entity: any) {
  return { event: 'payment.captured', payload: { payment: { entity } } }
}
function paymentFailed(entity: any) {
  return { event: 'payment.failed', payload: { payment: { entity } } }
}
function paymentLinkPaid(entity: any) {
  return { event: 'payment_link.paid', payload: { payment_link: { entity } } }
}
function paymentLinkExpired(entity: any) {
  return { event: 'payment_link.expired', payload: { payment_link: { entity } } }
}
function qrCredited(entity: any) {
  return { event: 'qr_code.credited', payload: { qr_code: { entity } } }
}

beforeEach(() => {
  process.env.RAZORPAY_WEBHOOK_SECRET = WEBHOOK_SECRET
  // Reset default resolved values that vi.clearAllMocks() wipes.
  queryOne.mockResolvedValue(null)
  queryMany.mockResolvedValue([])
  query.mockResolvedValue({ rows: [], rowCount: 0 })
  withTransaction.mockImplementation(async (fn: any) =>
    fn({ query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }) })
  )
  verifyDraftToken.mockResolvedValue(null)
  loadActiveCart.mockResolvedValue([])
  validateCouponForUser.mockResolvedValue({ ok: false })
  commitOrder.mockResolvedValue({ id: 'ord-1', order_number: 'JS-001', total_amount: '100' })
})

// ===========================================================================
// commitDraftFromWebhook (reached via payment.captured with no payment record)
// ===========================================================================

function draftCaptured(entity: any) {
  return paymentCaptured(entity)
}

describe('commitDraftFromWebhook (draft-token recovery)', () => {
  function claimIntent(overrides: any = {}) {
    return { id: 'intent1', draft_token: 'tok', user_id: 'u1', amount_paise: 10000, ...overrides }
  }

  it('intent claim null → no-op', async () => {
    queryOne.mockResolvedValueOnce(null) // paymentRecord
    queryOne.mockResolvedValueOnce(null) // variant_change_requests lookup (no vcr)
    queryOne.mockResolvedValueOnce(null) // claim
    const res = await POST(signedRequest(draftCaptured({ id: 'pay_d', order_id: 'ro1', amount: 10000 })))
    expect(res.status).toBe(200)
    expect(verifyDraftToken).not.toHaveBeenCalled()
  })

  it('draft token expired → creates high-priority manual task', async () => {
    queryOne.mockResolvedValueOnce(null) // paymentRecord
    queryOne.mockResolvedValueOnce(null) // variant_change_requests lookup (no vcr)
    queryOne.mockResolvedValueOnce(claimIntent()) // claim
    verifyDraftToken.mockResolvedValueOnce(null) // expired
    ;(createAutoTask as any).mockRejectedValueOnce(new Error('task fail'))
    const res = await POST(signedRequest(draftCaptured({ id: 'pay_e', order_id: 'ro2', amount: 10000 })))
    await new Promise(r => setTimeout(r, 0))
    expect(res.status).toBe(200)
    expect(createAutoTask).toHaveBeenCalledWith(expect.objectContaining({ priority: 'high' }))
    expect(commitOrder).not.toHaveBeenCalled()
  })

  it('amount mismatch → creates high-priority mismatch task', async () => {
    queryOne.mockResolvedValueOnce(null)
    queryOne.mockResolvedValueOnce(null) // variant_change_requests lookup (no vcr)
    queryOne.mockResolvedValueOnce(claimIntent({ amount_paise: 10000 }))
    verifyDraftToken.mockResolvedValueOnce({ mode: 'cart', addressId: 'a1' })
    // captured amount far off
    const res = await POST(signedRequest(draftCaptured({ id: 'pay_m', order_id: 'ro3', amount: 99999 })))
    expect(res.status).toBe(200)
    expect(createAutoTask).toHaveBeenCalledWith(expect.objectContaining({ title: expect.stringContaining('mismatch') }))
    expect(commitOrder).not.toHaveBeenCalled()
  })

  it('user missing → early return', async () => {
    queryOne.mockResolvedValueOnce(null) // paymentRecord
    queryOne.mockResolvedValueOnce(null) // variant_change_requests lookup (no vcr)
    queryOne.mockResolvedValueOnce(claimIntent()) // claim
    verifyDraftToken.mockResolvedValueOnce({ mode: 'cart', addressId: 'a1' })
    queryOne.mockResolvedValueOnce(null) // user null
    const res = await POST(signedRequest(draftCaptured({ id: 'pay_u', order_id: 'ro4', amount: 10000 })))
    expect(res.status).toBe(200)
    expect(commitOrder).not.toHaveBeenCalled()
  })

  it('cart mode with empty cart → early return', async () => {
    queryOne.mockResolvedValueOnce(null) // paymentRecord
    queryOne.mockResolvedValueOnce(null) // variant_change_requests lookup (no vcr)
    queryOne.mockResolvedValueOnce(claimIntent()) // claim
    verifyDraftToken.mockResolvedValueOnce({ mode: 'cart', addressId: 'a1' })
    queryOne.mockResolvedValueOnce({ id: 'u1', email: 'a@b.com' }) // user
    loadActiveCart.mockResolvedValueOnce([]) // empty cart
    const res = await POST(signedRequest(draftCaptured({ id: 'pay_c0', order_id: 'ro5', amount: 10000 })))
    expect(res.status).toBe(200)
    expect(commitOrder).not.toHaveBeenCalled()
  })

  it('cart mode with items + coupon applied → commits order + full follow-ups', async () => {
    queryOne.mockResolvedValueOnce(null) // paymentRecord
    queryOne.mockResolvedValueOnce(null) // variant_change_requests lookup (no vcr)
    queryOne.mockResolvedValueOnce(claimIntent()) // claim
    verifyDraftToken.mockResolvedValueOnce({
      mode: 'cart',
      addressId: 'a1',
      notes: 'n',
      couponId: 'c1',
      shippingAmount: 0,
      businessDiscountAmount: 0,
    })
    queryOne.mockResolvedValueOnce({ id: 'u1', email: 'a@b.com', first_name: 'A', last_name: 'B' }) // user
    loadActiveCart.mockResolvedValueOnce([{ productId: 'p1' }]) // has items
    validateCouponForUser.mockResolvedValueOnce({ ok: true, appliedDiscount: 10 })
    queryMany.mockResolvedValueOnce([{ product_id: 'p1' }]) // order_items
    queryOne.mockResolvedValueOnce({ id: 'ord-1', order_number: 'JS-001', total_amount: '100' }) // fullOrder
    // Force every fire-and-forget follow-up to reject so their .catch(() => {}) arrows run.
    ;(invoice.createDraftInvoice as any).mockRejectedValueOnce(new Error('inv'))
    ;(email.sendOrderConfirmationEmail as any).mockRejectedValueOnce(new Error('e'))
    ;(email.sendNewOrderNotification as any).mockRejectedValueOnce(new Error('e'))
    ;(email.sendPaymentStatusUpdate as any).mockRejectedValueOnce(new Error('e'))
    ;(activity.logActivity as any).mockRejectedValueOnce(new Error('a'))
    ;(aiFeedback.recordImplicitSignalsForProducts as any).mockRejectedValueOnce(new Error('s'))
    ;(marketing.attributeConversion as any).mockRejectedValueOnce(new Error('c'))
    const res = await POST(signedRequest(draftCaptured({ id: 'pay_c1', order_id: 'ro6', amount: 10000 })))
    await new Promise(r => setTimeout(r, 0))
    expect(res.status).toBe(200)
    expect(commitOrder).toHaveBeenCalledWith(expect.objectContaining({ mode: 'cart', appliedDiscount: 10 }))
    expect(invoice.createDraftInvoice).toHaveBeenCalledWith('ord-1')
    expect(activity.logActivity).toHaveBeenCalled()
    expect(aiFeedback.recordImplicitSignalsForProducts).toHaveBeenCalledWith('u1', ['p1'], 'purchased')
  })

  it('buyNow mode with product found → commits buyNow order', async () => {
    queryOne.mockResolvedValueOnce(null) // paymentRecord
    queryOne.mockResolvedValueOnce(null) // variant_change_requests lookup (no vcr)
    queryOne.mockResolvedValueOnce(claimIntent()) // claim
    verifyDraftToken.mockResolvedValueOnce({
      mode: 'buyNow',
      addressId: 'a1',
      shippingAmount: 0,
      buyNowItem: { productId: 'p1', variantId: 'v1', subVariantId: 's1', price: 100, qty: 1 },
    })
    queryOne.mockResolvedValueOnce({ id: 'u1', email: 'a@b.com', first_name: '', last_name: '' }) // user
    queryOne.mockResolvedValueOnce({ id: 'p1', name: 'Prod', gst_percentage: '18' }) // product
    queryOne.mockResolvedValueOnce({ id: 'v1', variant_name: 'V', mrp: 100 }) // variant
    queryOne.mockResolvedValueOnce({ id: 's1', sub_variant_name: 'S', mrp: 100 }) // subVariant
    queryMany.mockResolvedValueOnce([{ product_id: 'p1' }]) // order_items
    queryOne.mockResolvedValueOnce({ id: 'ord-1', order_number: 'JS-002', total_amount: '100' }) // fullOrder
    const res = await POST(signedRequest(draftCaptured({ id: 'pay_bn', order_id: 'ro7', amount: 10000 })))
    expect(res.status).toBe(200)
    expect(commitOrder).toHaveBeenCalledWith(expect.objectContaining({ mode: 'buyNow' }))
  })

  it('buyNow mode with product NOT found → early return', async () => {
    queryOne.mockResolvedValueOnce(null) // paymentRecord
    queryOne.mockResolvedValueOnce(null) // variant_change_requests lookup (no vcr)
    queryOne.mockResolvedValueOnce(claimIntent()) // claim
    verifyDraftToken.mockResolvedValueOnce({
      mode: 'buyNow',
      addressId: 'a1',
      shippingAmount: 0,
      buyNowItem: { productId: 'pX', price: 100, qty: 1 },
    })
    queryOne.mockResolvedValueOnce({ id: 'u1', email: 'a@b.com' }) // user
    queryOne.mockResolvedValueOnce(null) // product null
    const res = await POST(signedRequest(draftCaptured({ id: 'pay_bn0', order_id: 'ro8', amount: 10000 })))
    expect(res.status).toBe(200)
    expect(commitOrder).not.toHaveBeenCalled()
  })

  it('buyNow mode with no buyNowItem → falls to else branch, early return', async () => {
    queryOne.mockResolvedValueOnce(null) // paymentRecord
    queryOne.mockResolvedValueOnce(null) // variant_change_requests lookup (no vcr)
    queryOne.mockResolvedValueOnce(claimIntent()) // claim
    verifyDraftToken.mockResolvedValueOnce({ mode: 'buyNow', addressId: 'a1' }) // no buyNowItem
    queryOne.mockResolvedValueOnce({ id: 'u1', email: 'a@b.com' }) // user
    const res = await POST(signedRequest(draftCaptured({ id: 'pay_bn1', order_id: 'ro9', amount: 10000 })))
    expect(res.status).toBe(200)
    expect(commitOrder).not.toHaveBeenCalled()
  })

  it('unknown draft mode → else branch early return', async () => {
    queryOne.mockResolvedValueOnce(null) // paymentRecord
    queryOne.mockResolvedValueOnce(null) // variant_change_requests lookup (no vcr)
    queryOne.mockResolvedValueOnce(claimIntent()) // claim
    verifyDraftToken.mockResolvedValueOnce({ mode: 'weird', addressId: 'a1' })
    queryOne.mockResolvedValueOnce({ id: 'u1', email: 'a@b.com' }) // user
    const res = await POST(signedRequest(draftCaptured({ id: 'pay_um', order_id: 'ro10', amount: 10000 })))
    expect(res.status).toBe(200)
    expect(commitOrder).not.toHaveBeenCalled()
  })

  it('buyNow without variant/subVariant ids → skips variant lookups', async () => {
    queryOne.mockResolvedValueOnce(null) // paymentRecord
    queryOne.mockResolvedValueOnce(null) // variant_change_requests lookup (no vcr)
    queryOne.mockResolvedValueOnce(claimIntent()) // claim
    verifyDraftToken.mockResolvedValueOnce({
      mode: 'buyNow',
      addressId: 'a1',
      shippingAmount: 0,
      buyNowItem: { productId: 'p1', price: 100, qty: 2 },
    })
    queryOne.mockResolvedValueOnce({ id: 'u1', email: 'a@b.com', first_name: 'X', last_name: 'Y' }) // user
    queryOne.mockResolvedValueOnce({ id: 'p1', name: 'Prod', gst_percentage: null }) // product, null gst
    queryMany.mockResolvedValueOnce([]) // order_items empty
    queryOne.mockResolvedValueOnce({ id: 'ord-1', order_number: 'JS-003', total_amount: '200' }) // fullOrder
    const res = await POST(signedRequest(draftCaptured({ id: 'pay_bn2', order_id: 'ro11', amount: 10000 })))
    expect(res.status).toBe(200)
    expect(commitOrder).toHaveBeenCalledWith(expect.objectContaining({ mode: 'buyNow' }))
  })
})
