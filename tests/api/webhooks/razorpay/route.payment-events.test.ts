import { describe, it, expect, vi, beforeEach } from 'vitest'
import crypto from 'crypto'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/lib/db', () => ({
  queryOne: vi.fn().mockResolvedValue(null),
  queryMany: vi.fn().mockResolvedValue([]),
  query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  withTransaction: vi.fn().mockImplementation(async (fn: any) =>
    fn({ query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }) })
  ),
}))

vi.mock('@/lib/email', () => ({
  sendOrderConfirmationEmail: vi.fn().mockResolvedValue(undefined),
  sendNewOrderNotification: vi.fn().mockResolvedValue(undefined),
  sendPaymentStatusUpdate: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/auto-tasks', () => ({
  createAutoTask: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/marketing', () => ({
  attributeConversion: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/order-draft', () => ({
  verifyDraftToken: vi.fn().mockResolvedValue(null),
  hashCartItems: vi.fn().mockReturnValue('hash'),
}))

vi.mock('@/lib/order-commit', () => ({
  loadActiveCart: vi.fn().mockResolvedValue([]),
  cartSubtotal: vi.fn().mockReturnValue(100),
  cartTaxAmount: vi.fn().mockReturnValue(18),
  cartItemsForHash: vi.fn().mockReturnValue([]),
  validateCouponForUser: vi.fn().mockResolvedValue({ ok: false }),
  commitOrder: vi.fn().mockResolvedValue({ id: 'ord-1', order_number: 'JS-001', total_amount: '100' }),
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

// getFeatureFlags() runs a real queryMany (site-controls) unless mocked, which
// would consume a queued db mock and desync the sequence. Stub it out.
vi.mock('@/lib/site-controls', () => ({
  getFeatureFlags: vi.fn().mockResolvedValue({ gstEnabled: true }),
}))

// ---------------------------------------------------------------------------

import { POST } from '@/app/api/webhooks/razorpay/route'
import * as db from '@/lib/db'
import * as email from '@/lib/email'
import * as autoTasks from '@/lib/auto-tasks'
import * as orderDraft from '@/lib/order-draft'
import * as orderCommit from '@/lib/order-commit'
import * as invoice from '@/lib/invoice'
import * as activity from '@/lib/activity'
import * as aiFeedback from '@/lib/ai-feedback'
import * as marketing from '@/lib/marketing'

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
// Signature / envelope guards (POST outer branches)
// ===========================================================================

describe('POST signature & envelope guards', () => {
  it('returns 400 when x-razorpay-signature header is missing', async () => {
    const req = new Request('http://localhost/api/webhooks/razorpay', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(paymentCaptured({ id: 'p', order_id: 'o' })),
    })
    const res = await POST(req as any)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/signature/i)
  })

  it('returns 500 when RAZORPAY_WEBHOOK_SECRET is not configured', async () => {
    delete process.env.RAZORPAY_WEBHOOK_SECRET
    const req = new Request('http://localhost/api/webhooks/razorpay', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-razorpay-signature': 'ignored' },
      body: JSON.stringify(paymentLinkExpired({ id: 'plink' })),
    })
    const res = await POST(req as any)
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/not configured/i)
  })

  it('returns 400 when signature does not match', async () => {
    const body = JSON.stringify(paymentCaptured({ id: 'p', order_id: 'o' }))
    const req = new Request('http://localhost/api/webhooks/razorpay', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-razorpay-signature': 'wrong' },
      body,
    })
    const res = await POST(req as any)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/signature/i)
  })

  it('returns 200 ok for an unhandled event type (no handler branch)', async () => {
    const res = await POST(signedRequest({ event: 'refund.processed', payload: {} }))
    expect(res.status).toBe(200)
    expect((await res.json()).status).toBe('ok')
  })

  it('returns 200 ok even when JSON body is invalid (outer catch)', async () => {
    const body = 'not-json{'
    const sig = crypto.createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex')
    const req = new Request('http://localhost/api/webhooks/razorpay', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-razorpay-signature': sig },
      body,
    })
    const res = await POST(req as any)
    expect(res.status).toBe(200)
    expect((await res.json()).status).toBe('ok')
  })
})

// ===========================================================================
// handlePaymentCaptured
// ===========================================================================

describe('payment.captured', () => {
  it('no payment record → falls into draft flow (intent claim returns null → no-op)', async () => {
    // paymentRecord lookup null, then commitDraftFromWebhook: intent claim null
    queryOne.mockResolvedValueOnce(null) // paymentRecord
    queryOne.mockResolvedValueOnce(null) // intent claim
    const res = await POST(signedRequest(paymentCaptured({ id: 'pay_1', order_id: 'order_1', amount: 10000 })))
    expect(res.status).toBe(200)
    expect(verifyDraftToken).not.toHaveBeenCalled()
  })

  it('payment already paid → returns early, no transaction', async () => {
    queryOne.mockResolvedValueOnce({ order_id: 'o1', payment_status: 'paid', user_id: 'u1' })
    const res = await POST(signedRequest(paymentCaptured({ id: 'pay_2', order_id: 'order_2', amount: 10000 })))
    expect(res.status).toBe(200)
    expect(withTransaction).not.toHaveBeenCalled()
  })

  it('unpaid record with user_id → runs transaction, deletes cart, sends emails (email failures swallowed by .catch)', async () => {
    queryOne
      .mockResolvedValueOnce({ order_id: 'o1', payment_status: 'unpaid', user_id: 'u1', order_number: 'N1', total_amount: '100' }) // paymentRecord
      .mockResolvedValueOnce({ id: 'u1', email: 'a@b.com', first_name: 'Jo', last_name: 'Do' }) // user
      .mockResolvedValueOnce({ id: 'o1', order_number: 'N1', total_amount: '100' }) // order
    queryMany.mockResolvedValueOnce([{ product_id: 'pr1' }]) // orderItems
    // Force the fire-and-forget promises to reject so their .catch(() => {}) arrows execute.
    ;(email.sendOrderConfirmationEmail as any).mockRejectedValueOnce(new Error('smtp down'))
    ;(email.sendNewOrderNotification as any).mockRejectedValueOnce(new Error('smtp down'))
    ;(email.sendPaymentStatusUpdate as any).mockRejectedValueOnce(new Error('smtp down'))
    ;(marketing.attributeConversion as any).mockRejectedValueOnce(new Error('attr down'))
    const res = await POST(signedRequest(paymentCaptured({ id: 'pay_3', order_id: 'order_3', amount: 10000 })))
    // Let the microtask queue drain so the rejected promises hit their .catch handlers.
    await new Promise((r) => setTimeout(r, 0))
    expect(res.status).toBe(200)
    expect(withTransaction).toHaveBeenCalled()
    expect(email.sendOrderConfirmationEmail).toHaveBeenCalledWith('a@b.com', expect.anything(), expect.anything())
    expect(marketing.attributeConversion).toHaveBeenCalledWith('u1', 'o1')
  })

  it('unpaid record with NO user_id → transaction runs but no email/cart delete', async () => {
    queryOne.mockResolvedValueOnce({ order_id: 'o2', payment_status: 'unpaid', user_id: null })
    const res = await POST(signedRequest(paymentCaptured({ id: 'pay_4', order_id: 'order_4', amount: 5000 })))
    expect(res.status).toBe(200)
    expect(withTransaction).toHaveBeenCalled()
    expect(email.sendOrderConfirmationEmail).not.toHaveBeenCalled()
  })

  it('unpaid record with user_id but user/order missing → no emails', async () => {
    queryOne
      .mockResolvedValueOnce({ order_id: 'o3', payment_status: 'unpaid', user_id: 'u9' }) // paymentRecord
      .mockResolvedValueOnce(null) // user null
      .mockResolvedValueOnce(null) // order null
    const res = await POST(signedRequest(paymentCaptured({ id: 'pay_5', order_id: 'order_5', amount: 5000 })))
    expect(res.status).toBe(200)
    expect(email.sendOrderConfirmationEmail).not.toHaveBeenCalled()
  })
})

// ===========================================================================
// handlePaymentFailed
// ===========================================================================

describe('payment.failed', () => {
  it('no payment record → early return, no order update task', async () => {
    queryOne.mockResolvedValueOnce(null)
    const res = await POST(signedRequest(paymentFailed({ id: 'p', order_id: 'order_x' })))
    expect(res.status).toBe(200)
    expect(createAutoTask).not.toHaveBeenCalled()
  })

  it('record found + order has user_id → creates follow-up task', async () => {
    queryOne
      .mockResolvedValueOnce({ order_id: 'o1' }) // paymentRecord
      .mockResolvedValueOnce(undefined) // UPDATE payments
      .mockResolvedValueOnce(undefined) // UPDATE orders
      .mockResolvedValueOnce({ user_id: 'u1', order_number: 'N1', total_amount: '250' }) // orderRow
    ;(createAutoTask as any).mockRejectedValueOnce(new Error('task fail'))
    const res = await POST(signedRequest(paymentFailed({ id: 'p', order_id: 'order_y' })))
    await new Promise((r) => setTimeout(r, 0))
    expect(res.status).toBe(200)
    expect(createAutoTask).toHaveBeenCalledWith(expect.objectContaining({ sourceKind: 'contact_failed_payment', userId: 'u1' }))
  })

  it('record found but order has no user_id → no task', async () => {
    queryOne
      .mockResolvedValueOnce({ order_id: 'o2' })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ user_id: null, order_number: 'N2', total_amount: '10' })
    const res = await POST(signedRequest(paymentFailed({ id: 'p', order_id: 'order_z' })))
    expect(res.status).toBe(200)
    expect(createAutoTask).not.toHaveBeenCalled()
  })
})

// ===========================================================================
// handlePaymentLinkPaid
// ===========================================================================

describe('payment_link.paid', () => {
  it('no matching order → early return', async () => {
    queryOne.mockResolvedValueOnce(null)
    const res = await POST(signedRequest(paymentLinkPaid({ id: 'plink_1' })))
    expect(res.status).toBe(200)
    expect(withTransaction).not.toHaveBeenCalled()
  })

  it('order already paid → early return', async () => {
    queryOne.mockResolvedValueOnce({ id: 'o1', payment_status: 'paid' })
    const res = await POST(signedRequest(paymentLinkPaid({ id: 'plink_2' })))
    expect(res.status).toBe(200)
    expect(withTransaction).not.toHaveBeenCalled()
  })

  it('unpaid order with user_id + payments array → transaction, emails (failures swallowed)', async () => {
    queryOne
      .mockResolvedValueOnce({ id: 'o1', payment_status: 'unpaid', user_id: 'u1', order_number: 'N1', total_amount: '300' }) // order
      .mockResolvedValueOnce({ id: 'u1', email: 'x@y.com', first_name: 'A', last_name: 'B' }) // user
      .mockResolvedValueOnce({ id: 'o1', order_number: 'N1', total_amount: '300' }) // fullOrder
    queryMany.mockResolvedValueOnce([])
    ;(email.sendOrderConfirmationEmail as any).mockRejectedValueOnce(new Error('x'))
    ;(email.sendNewOrderNotification as any).mockRejectedValueOnce(new Error('x'))
    ;(email.sendPaymentStatusUpdate as any).mockRejectedValueOnce(new Error('x'))
    const res = await POST(signedRequest(paymentLinkPaid({ id: 'plink_3', payments: [{ payment_id: 'pl_pay_1' }] })))
    await new Promise((r) => setTimeout(r, 0))
    expect(res.status).toBe(200)
    expect(withTransaction).toHaveBeenCalled()
    expect(email.sendPaymentStatusUpdate).toHaveBeenCalled()
  })

  it('unpaid order without user_id (uses fallback link id for txn) → no emails', async () => {
    queryOne.mockResolvedValueOnce({ id: 'o2', payment_status: 'unpaid', user_id: null, order_number: 'N2', total_amount: '50' })
    const res = await POST(signedRequest(paymentLinkPaid({ id: 'plink_4' })))
    expect(res.status).toBe(200)
    expect(withTransaction).toHaveBeenCalled()
    expect(email.sendOrderConfirmationEmail).not.toHaveBeenCalled()
  })

  it('unpaid order with user_id but user/fullOrder missing → no emails', async () => {
    queryOne
      .mockResolvedValueOnce({ id: 'o3', payment_status: 'unpaid', user_id: 'u3', order_number: 'N3', total_amount: '99' })
      .mockResolvedValueOnce(null) // user
      .mockResolvedValueOnce(null) // fullOrder
    queryMany.mockResolvedValueOnce([])
    const res = await POST(signedRequest(paymentLinkPaid({ id: 'plink_5' })))
    expect(res.status).toBe(200)
    expect(email.sendOrderConfirmationEmail).not.toHaveBeenCalled()
  })
})

// ===========================================================================
// handleQrCodeCredited
// ===========================================================================

describe('qr_code.credited', () => {
  it('no qr id → early return', async () => {
    const res = await POST(signedRequest(qrCredited({})))
    expect(res.status).toBe(200)
    expect(query).not.toHaveBeenCalled()
  })

  it('no matching order → early return', async () => {
    queryOne.mockResolvedValueOnce(null)
    const res = await POST(signedRequest(qrCredited({ id: 'qr_1' })))
    expect(res.status).toBe(200)
    expect(query).not.toHaveBeenCalled()
  })

  it('order already paid → early return', async () => {
    queryOne.mockResolvedValueOnce({ id: 'o1', payment_status: 'paid', total_amount: '100' })
    const res = await POST(signedRequest(qrCredited({ id: 'qr_2' })))
    expect(res.status).toBe(200)
    expect(query).not.toHaveBeenCalled()
  })

  it('unpaid order with payments array → updates + inserts payment', async () => {
    queryOne.mockResolvedValueOnce({ id: 'o1', payment_status: 'unpaid', total_amount: '100' })
    const res = await POST(signedRequest(qrCredited({ id: 'qr_3', payments: [{ razorpay_payment_id: 'qrp1' }] })))
    expect(res.status).toBe(200)
    expect(query).toHaveBeenCalledTimes(2)
  })

  it('unpaid order without payments array → falls back to qr id', async () => {
    queryOne.mockResolvedValueOnce({ id: 'o2', payment_status: 'unpaid', total_amount: '200' })
    const res = await POST(signedRequest(qrCredited({ id: 'qr_4' })))
    expect(res.status).toBe(200)
    expect(query).toHaveBeenCalledTimes(2)
  })
})

// ===========================================================================
// handlePaymentLinkExpired
// ===========================================================================

describe('payment_link.expired', () => {
  it('runs the expiry update', async () => {
    const res = await POST(signedRequest(paymentLinkExpired({ id: 'plink_exp' })))
    expect(res.status).toBe(200)
    expect(queryOne).toHaveBeenCalledWith(expect.stringContaining("payment_link_status = 'expired'"), ['plink_exp'])
  })
})
