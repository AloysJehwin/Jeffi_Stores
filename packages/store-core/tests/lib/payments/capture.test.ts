import { describe, it, expect, vi, beforeEach } from 'vitest'

const queryOne = vi.fn<(...a: any[]) => any>()
const queryMany = vi.fn<(...a: any[]) => any>()
const query = vi.fn<(...a: any[]) => any>(async () => ({ rows: [] as any[], rowCount: 1 }))
const mockClient = { query: vi.fn<(...a: any[]) => any>(async () => ({ rows: [] as any[], rowCount: 1 })) }
const withTransaction = vi.fn<(...a: any[]) => any>(async (fn: (c: any) => any) => fn(mockClient))

const recordCapturedPayment = vi.fn<(...a: any[]) => any>(async () => {})
const resolveRazorpayCreds = vi.fn<(...a: any[]) => any>(async () => ({ isOwn: false }))
const cpQuery = vi.fn<(...a: any[]) => any>(async () => ({ rows: [{ own_razorpay: false }] }))
const queueAdsConversion = vi.fn<(...a: any[]) => any>(async () => ({ action: 'none' }))
const settleVariantChangePayment = vi.fn<(...a: any[]) => any>(async () => ({ applied: true }))
const settleAdjustmentPayment = vi.fn<(...a: any[]) => any>(async () => ({ applied: true }))
const verifyDraftToken = vi.fn<(...a: any[]) => any>()
const hashCartItems = vi.fn<(...a: any[]) => any>(() => 'HASH')
const loadActiveCart = vi.fn<(...a: any[]) => any>()
const cartItemsForHash = vi.fn<(...a: any[]) => any>((c: any) => c)
const cartSubtotal = vi.fn<(...a: any[]) => any>(() => 1000)
const cartTaxAmount = vi.fn<(...a: any[]) => any>(() => 100)
const validateCouponForUser = vi.fn<(...a: any[]) => any>(async () => ({ ok: false }))
const commitOrder = vi.fn<(...a: any[]) => any>()
const createAutoTask = vi.fn<(...a: any[]) => any>(async () => {})
const createDraftInvoice = vi.fn<(...a: any[]) => any>(async () => {})
const generateOrderInvoice = vi.fn<(...a: any[]) => any>(async () => {})
const notifyAccessGranted = vi.fn<(...a: any[]) => any>(async () => {})
const getFeatureFlags = vi.fn<(...a: any[]) => any>(async () => ({ gstEnabled: true }))
const logActivity = vi.fn<(...a: any[]) => any>(async () => {})
const recordImplicitSignalsForProducts = vi.fn<(...a: any[]) => any>(async () => {})
const attributeConversion = vi.fn<(...a: any[]) => any>(async () => {})
const sendOrderConfirmationEmail = vi.fn<(...a: any[]) => any>(async () => {})
const sendNewOrderNotification = vi.fn<(...a: any[]) => any>(async () => {})
const sendPaymentStatusUpdate = vi.fn<(...a: any[]) => any>(async () => {})

vi.mock('@/lib/shared/db', () => ({
  queryOne: (...a: any[]) => queryOne(...a),
  queryMany: (...a: any[]) => queryMany(...a),
  query: (...a: any[]) => query(...a),
  withTransaction: (...a: any[]) => withTransaction(...a),
}))
vi.mock('@/lib/email', () => ({
  sendOrderConfirmationEmail: (...a: any[]) => sendOrderConfirmationEmail(...a),
  sendNewOrderNotification: (...a: any[]) => sendNewOrderNotification(...a),
  sendPaymentStatusUpdate: (...a: any[]) => sendPaymentStatusUpdate(...a),
}))
vi.mock('@/lib/shared/auto-tasks', () => ({ createAutoTask: (...a: any[]) => createAutoTask(...a) }))
vi.mock('@/lib/shared/marketing', () => ({ attributeConversion: (...a: any[]) => attributeConversion(...a) }))
vi.mock('@/lib/orders/order-draft', () => ({ hashCartItems: (...a: any[]) => hashCartItems(...a), verifyDraftToken: (...a: any[]) => verifyDraftToken(...a) }))
vi.mock('@/lib/orders/order-commit', () => ({
  loadActiveCart: (...a: any[]) => loadActiveCart(...a),
  cartItemsForHash: (...a: any[]) => cartItemsForHash(...a),
  cartSubtotal: (...a: any[]) => cartSubtotal(...a),
  cartTaxAmount: (...a: any[]) => cartTaxAmount(...a),
  validateCouponForUser: (...a: any[]) => validateCouponForUser(...a),
  commitOrder: (...a: any[]) => commitOrder(...a),
}))
vi.mock('@/lib/shared/notify', () => ({ notifyAccessGranted: (...a: any[]) => notifyAccessGranted(...a) }))
vi.mock('@/lib/documents/invoice', () => ({ createDraftInvoice: (...a: any[]) => createDraftInvoice(...a), generateOrderInvoice: (...a: any[]) => generateOrderInvoice(...a) }))
vi.mock('@/lib/catalog/site-controls', () => ({ getFeatureFlags: (...a: any[]) => getFeatureFlags(...a) }))
vi.mock('@/lib/orders/variant-change', () => ({ settleVariantChangePayment: (...a: any[]) => settleVariantChangePayment(...a) }))
vi.mock('@/lib/shared/activity', () => ({ logActivity: (...a: any[]) => logActivity(...a) }))
vi.mock('@/lib/shared/ai-feedback', () => ({ recordImplicitSignalsForProducts: (...a: any[]) => recordImplicitSignalsForProducts(...a) }))
vi.mock('@/lib/payments/route-settlement', () => ({ recordCapturedPayment: (...a: any[]) => recordCapturedPayment(...a) }))
vi.mock('@/lib/integrations/resolve', () => ({ resolveRazorpayCreds: (...a: any[]) => resolveRazorpayCreds(...a) }))
vi.mock('@/lib/tenant-registry', () => ({ controlPlanePool: () => ({ query: cpQuery }) }))
vi.mock('@/lib/google-ads/conversions/queue', () => ({ queueAdsConversion: (...a: any[]) => queueAdsConversion(...a) }))
vi.mock('@/lib/payments/webhook-tenant', () => ({ isFlagship: (t: any) => !t?.tenantId || t.tenantId === '00000000-0000-0000-0000-000000000000' }))
vi.mock('@/lib/orders/adjustments', () => ({ settleAdjustmentPayment: (...a: any[]) => settleAdjustmentPayment(...a) }))

import {
  routeCapturedPayment,
  recordPaymentDetails,
  markOrderPaid,
  applyCapturedPayment,
  applyLinkPayment,
  applyQrPayment,
  commitDraftFromCapture,
} from '@/lib/payments/capture'

const T = '11111111-1111-4111-8111-111111111111'
const NIL = '00000000-0000-0000-0000-000000000000'
const store = { tenantId: T, slug: 'acme' }

// Booking (routeCapturedPayment) is fire-and-forget; let its microtasks settle before asserting.
const flush = () => new Promise(r => setTimeout(r, 0))

beforeEach(() => {
  vi.clearAllMocks()
  query.mockResolvedValue({ rows: [], rowCount: 1 })
  mockClient.query.mockResolvedValue({ rows: [], rowCount: 1 })
  withTransaction.mockImplementation(async (fn: (c: any) => any) => fn(mockClient))
  cpQuery.mockResolvedValue({ rows: [{ own_razorpay: false }] })
  resolveRazorpayCreds.mockResolvedValue({ isOwn: false })
  queryOne.mockResolvedValue(null)
  queryMany.mockResolvedValue([])
})

describe('routeCapturedPayment', () => {
  it('does nothing for the flagship / null store', async () => {
    await routeCapturedPayment({ store: null, paymentId: 'pay_1', totalAmountInr: 100, orderId: 'o1', orderRef: 'ORD-1' })
    await routeCapturedPayment({ store: { tenantId: NIL }, paymentId: 'pay_1', totalAmountInr: 100, orderId: 'o1', orderRef: 'ORD-1' })
    expect(recordCapturedPayment).not.toHaveBeenCalled()
  })
  it("books on the platform account when own flag/creds say platform", async () => {
    await routeCapturedPayment({ store, paymentId: 'pay_1', totalAmountInr: 500, orderId: 'o1', orderRef: 'ORD-1' })
    expect(recordCapturedPayment).toHaveBeenCalledTimes(1)
    expect(vi.mocked(recordCapturedPayment).mock.calls[0][0]).toMatchObject({ tenantId: T, grossInr: 500, collectedOn: 'platform' })
  })
  it("collects on 'own' when both the flag and resolved creds are own", async () => {
    cpQuery.mockResolvedValue({ rows: [{ own_razorpay: true }] })
    resolveRazorpayCreds.mockResolvedValue({ isOwn: true })
    await routeCapturedPayment({ store, paymentId: 'pay_1', totalAmountInr: 500, orderId: 'o1', orderRef: 'ORD-1', isCod: true })
    expect(vi.mocked(recordCapturedPayment).mock.calls[0][0]).toMatchObject({ collectedOn: 'own', isCod: true })
  })
  it('warns but still books when flag and creds disagree', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    cpQuery.mockResolvedValue({ rows: [{ own_razorpay: true }] })
    resolveRazorpayCreds.mockResolvedValue({ isOwn: false })
    await routeCapturedPayment({ store, paymentId: 'pay_1', totalAmountInr: 100, orderId: 'o1', orderRef: 'ORD-1' })
    expect(warn).toHaveBeenCalled()
    expect(vi.mocked(recordCapturedPayment).mock.calls[0][0]).toMatchObject({ collectedOn: 'platform' })
    warn.mockRestore()
  })
})

describe('recordPaymentDetails', () => {
  it('does nothing without a payment id', async () => {
    await recordPaymentDetails(null)
    await recordPaymentDetails({})
    expect(query).not.toHaveBeenCalled()
  })
  it('fills method/card/fee/tax from the Razorpay payment, converting paise', async () => {
    await recordPaymentDetails(
      { id: 'pay_1', method: 'card', card: { network: 'Visa', type: 'credit', last4: '4242', issuer: 'HDFC' }, bank: null, wallet: null, fee: 236, tax: 36 },
      { account: 'own', capturedAt: new Date('2026-01-01T00:00:00Z') }
    )
    const params = vi.mocked(query).mock.calls[0][1]!
    expect(params[0]).toBe('pay_1')
    expect(params[1]).toBe('own')
    expect(params[2]).toBe('card')
    expect(params[3]).toBe('Visa')
    expect(params[10]).toBe(2.36) // fee paise -> inr
    expect(params[11]).toBe(0.36) // tax
  })
  it('reads the UPI vpa from payment.upi.vpa when vpa absent, nulls empty fee/tax', async () => {
    await recordPaymentDetails({ id: 'pay_2', method: 'upi', upi: { vpa: 'a@ybl' }, fee: '', tax: null })
    const params = vi.mocked(query).mock.calls[0][1]!
    expect(params[9]).toBe('a@ybl')
    expect(params[10]).toBeNull()
    expect(params[11]).toBeNull()
  })
})

describe('markOrderPaid', () => {
  const record = { order_id: 'o1', user_id: 'u1', total_amount: '500.00', order_number: 'ORD-1' }

  it('flips the order to paid, clears the cart, queues ads + books the store share', async () => {
    mockClient.query
      .mockResolvedValueOnce({ rowCount: 1 }) // UPDATE orders -> flipped
      .mockResolvedValueOnce({ rowCount: 1 }) // UPDATE payments
      .mockResolvedValueOnce({ rowCount: 1 }) // CLEAR_CART
    queryOne.mockResolvedValue(null) // notifyOrderPaid: user null -> skip (user_id present but queryOne null => returns)
    const out = await markOrderPaid({ record, paymentId: 'pay_1', gatewayResponse: { x: 1 }, store })
    expect(out).toBe('paid')
    expect(queueAdsConversion).toHaveBeenCalledWith('o1', record)
    await flush()
    expect(recordCapturedPayment).toHaveBeenCalledTimes(1) // booked via routeCapturedPayment
  })

  it('inserts a completed payment row when none was pending and insertIfMissing is set', async () => {
    mockClient.query
      .mockResolvedValueOnce({ rowCount: 1 }) // UPDATE orders
      .mockResolvedValueOnce({ rowCount: 0 }) // UPDATE payments -> none
      .mockResolvedValueOnce({ rowCount: 1 }) // INSERT payments
      .mockResolvedValueOnce({ rowCount: 1 }) // CLEAR_CART
    await markOrderPaid({ record, paymentId: 'pay_1', gatewayResponse: {}, store, insertIfMissing: true })
    const inserted = mockClient.query.mock.calls.find(c => String(c[0]).includes('INSERT INTO payments'))
    expect(inserted).toBeTruthy()
  })

  it('does not book the store share when the order was already paid (not flipped)', async () => {
    mockClient.query
      .mockResolvedValueOnce({ rowCount: 0 }) // UPDATE orders -> not flipped
      .mockResolvedValueOnce({ rowCount: 0 }) // UPDATE payments
      .mockResolvedValueOnce({ rowCount: 1 }) // CLEAR_CART
    await markOrderPaid({ record, paymentId: 'pay_1', gatewayResponse: {}, store })
    expect(recordCapturedPayment).not.toHaveBeenCalled()
  })

  it('uses a custom gateway book fn when provided', async () => {
    const book = vi.fn(async () => {})
    mockClient.query.mockResolvedValue({ rowCount: 1 })
    await markOrderPaid({ record: { ...record, user_id: null }, paymentId: 'pay_1', gatewayResponse: {}, store, gw: { gateway: 'phonepe', book } })
    await flush()
    expect(book).toHaveBeenCalledTimes(1)
    expect(recordCapturedPayment).not.toHaveBeenCalled()
  })
})

describe('applyCapturedPayment', () => {
  it('settles an order-adjustment top-up', async () => {
    queryOne.mockResolvedValueOnce(null) // record lookup
    const r = await applyCapturedPayment({ id: 'pay_1', order_id: 'rzp_1', amount: 10000, notes: { purpose: 'order_adjustment' } }, store)
    expect(r).toBe('adjustment')
    expect(settleAdjustmentPayment).toHaveBeenCalledTimes(1)
    expect(vi.mocked(settleAdjustmentPayment).mock.calls[0][0]).toMatchObject({ razorpayOrderId: 'rzp_1', amountPaise: 10000, tenant: { tenantId: T, slug: 'acme' } })
  })

  it('settles a variant-change request when no payment record matches', async () => {
    queryOne
      .mockResolvedValueOnce(null) // payment record
      .mockResolvedValueOnce({ id: 'vcr_1' }) // variant_change_requests
    const r = await applyCapturedPayment({ id: 'pay_1', order_id: 'rzp_1', amount: 10000 }, store)
    expect(r).toBe('variant_change')
    expect(settleVariantChangePayment).toHaveBeenCalledTimes(1)
  })

  it("returns 'already_paid' when the matched order is paid", async () => {
    queryOne.mockResolvedValueOnce({ db_order_id: 'o1', payment_status: 'paid', order_number: 'ORD-1', total_amount: '500', user_id: 'u1' })
    const r = await applyCapturedPayment({ id: 'pay_1', order_id: 'rzp_1', amount: 10000 }, store)
    expect(r).toBe('already_paid')
  })

  it('marks a matched unpaid order paid', async () => {
    queryOne
      .mockResolvedValueOnce({ db_order_id: 'o1', order_id: 'o1', payment_status: 'unpaid', order_number: 'ORD-1', total_amount: '500', user_id: null })
      .mockResolvedValue(null)
    mockClient.query.mockResolvedValue({ rowCount: 1 })
    const r = await applyCapturedPayment({ id: 'pay_1', order_id: 'rzp_1', amount: 10000 }, store)
    expect(r).toBe('paid')
  })

  it("delegates to commitDraftFromCapture -> 'unmatched' when no intent is claimed", async () => {
    queryOne
      .mockResolvedValueOnce(null) // payment record
      .mockResolvedValueOnce(null) // variant change
      .mockResolvedValueOnce(null) // intent claim (commitDraftFromCapture) -> not_claimed
    const r = await applyCapturedPayment({ id: 'pay_1', order_id: 'rzp_1', amount: 10000 }, store)
    expect(r).toBe('unmatched')
  })
})

describe('applyLinkPayment', () => {
  it("returns 'unmatched' without a link id or order", async () => {
    expect(await applyLinkPayment({}, {}, store)).toBe('unmatched')
    queryOne.mockResolvedValueOnce(null)
    expect(await applyLinkPayment({ id: 'plink_1' }, {}, store)).toBe('unmatched')
  })
  it("returns 'already_paid' for a paid order", async () => {
    queryOne.mockResolvedValueOnce({ id: 'o1', payment_status: 'paid' })
    expect(await applyLinkPayment({ id: 'plink_1' }, {}, store)).toBe('already_paid')
  })
  it('flips the order paid, inserts the link payment and books the share', async () => {
    queryOne
      .mockResolvedValueOnce({ id: 'o1', payment_status: 'unpaid', user_id: null, order_number: 'ORD-1', total_amount: '500' }) // order
    mockClient.query.mockResolvedValue({ rowCount: 1 }) // UPDATE orders flipped
    const r = await applyLinkPayment({ id: 'plink_1' }, { id: 'pay_1' }, store)
    expect(r).toBe('paid')
    await flush()
    expect(recordCapturedPayment).toHaveBeenCalledTimes(1)
    expect(queueAdsConversion).toHaveBeenCalledWith('o1', expect.anything())
  })
  it('sends paid notifications when the order has a user', async () => {
    queryOne
      .mockResolvedValueOnce({ id: 'o1', payment_status: 'unpaid', user_id: 'u1', order_number: 'ORD-1', total_amount: '500' }) // order
      .mockResolvedValueOnce({ id: 'u1', email: 'c@x.com', first_name: 'C', last_name: 'X' }) // user
      .mockResolvedValueOnce({ id: 'o1', order_number: 'ORD-1', total_amount: '500' }) // full order
    queryMany.mockResolvedValueOnce([{ id: 'i1' }])
    mockClient.query.mockResolvedValue({ rowCount: 1 })
    await applyLinkPayment({ id: 'plink_1' }, { id: 'pay_1' }, store)
    expect(sendOrderConfirmationEmail).toHaveBeenCalled()
  })
})

describe('applyQrPayment', () => {
  it("returns 'unmatched' without a qr id or order", async () => {
    expect(await applyQrPayment({}, {}, store)).toBe('unmatched')
    queryOne.mockResolvedValueOnce(null)
    expect(await applyQrPayment({ id: 'qr_1' }, {}, store)).toBe('unmatched')
  })
  it("returns 'already_paid' for a paid order", async () => {
    queryOne.mockResolvedValueOnce({ id: 'o1', payment_status: 'paid' })
    expect(await applyQrPayment({ id: 'qr_1' }, {}, store)).toBe('already_paid')
  })
  it('flips the order paid, inserts the qr payment and books the share', async () => {
    queryOne.mockResolvedValueOnce({ id: 'o1', payment_status: 'unpaid', order_number: 'ORD-1', total_amount: '500' })
    query.mockResolvedValueOnce({ rowCount: 1 }) // UPDATE orders flipped
    query.mockResolvedValue({ rowCount: 1 }) // INSERT payments
    const r = await applyQrPayment({ id: 'qr_1' }, { id: 'pay_1' }, store)
    expect(r).toBe('paid')
    expect(queueAdsConversion).toHaveBeenCalledWith('o1', expect.anything())
    await flush()
    expect(recordCapturedPayment).toHaveBeenCalledTimes(1)
  })
  it('does not queue ads or book when the order was already flipped elsewhere', async () => {
    queryOne.mockResolvedValueOnce({ id: 'o1', payment_status: 'unpaid', order_number: 'ORD-1', total_amount: '500' })
    query.mockResolvedValueOnce({ rowCount: 0 }) // UPDATE not flipped
    query.mockResolvedValue({ rowCount: 1 })
    const r = await applyQrPayment({ id: 'qr_1' }, { id: 'pay_1' }, store)
    expect(r).toBe('paid')
    expect(queueAdsConversion).not.toHaveBeenCalled()
    expect(recordCapturedPayment).not.toHaveBeenCalled()
  })
})

describe('commitDraftFromCapture', () => {
  it("returns 'not_claimed' when no intent is open", async () => {
    queryOne.mockResolvedValueOnce(null) // intent UPDATE
    const r = await commitDraftFromCapture('rzp_1', { id: 'pay_1', amount: 5000 }, store)
    expect(r).toEqual({ status: 'not_claimed' })
  })

  it('raises a manual task when the draft token has expired', async () => {
    queryOne.mockResolvedValueOnce({ id: 'intent_1', draft_token: 'd', user_id: 'u1', amount_paise: 5000 })
    verifyDraftToken.mockResolvedValueOnce(null)
    const r = await commitDraftFromCapture('rzp_1', { id: 'pay_1', amount: 5000 }, store)
    expect(r.status).toBe('needs_action')
    expect(createAutoTask).toHaveBeenCalledTimes(1)
  })

  it('needs_action without a task when paid:false and the draft expired', async () => {
    queryOne.mockResolvedValueOnce({ id: 'intent_1', draft_token: 'd', user_id: 'u1', amount_paise: 5000 })
    verifyDraftToken.mockResolvedValueOnce(null)
    const r = await commitDraftFromCapture('rzp_1', { id: 'pay_1', amount: 5000 }, store, { paid: false })
    expect(r).toEqual({ status: 'needs_action', reason: 'Payment captured but draft expired' })
    expect(createAutoTask).not.toHaveBeenCalled()
  })

  it('flags an amount mismatch', async () => {
    queryOne.mockResolvedValueOnce({ id: 'intent_1', draft_token: 'd', user_id: 'u1', amount_paise: 5000 })
    verifyDraftToken.mockResolvedValueOnce({ mode: 'cart' })
    const r = await commitDraftFromCapture('rzp_1', { id: 'pay_1', amount: 9999 }, store)
    expect(r).toMatchObject({ status: 'needs_action', reason: 'Payment amount mismatch' })
  })

  it('commits a cart draft and books the store share when paid', async () => {
    queryOne
      .mockResolvedValueOnce({ id: 'intent_1', draft_token: 'd', user_id: 'u1', amount_paise: 100000 }) // intent
      .mockResolvedValueOnce({ id: 'u1', email: 'c@x.com', first_name: 'C', last_name: 'X' }) // user
      .mockResolvedValueOnce({ id: 'o1', order_number: 'ORD-1', total_amount: '1000' }) // full order after commit
    verifyDraftToken.mockResolvedValueOnce({ mode: 'cart', cartHash: null, addressId: 'a1', shippingAmount: 0, codFeeAmount: 0 })
    loadActiveCart.mockResolvedValueOnce([{ id: 'ci1', product_id: 'p1' }])
    commitOrder.mockResolvedValueOnce({ id: 'o1', order_number: 'ORD-1', total_amount: '1000', status: 'placed' })
    queryMany.mockResolvedValueOnce([{ id: 'oi1', product_id: 'p1' }])
    const r = await commitDraftFromCapture('rzp_1', { id: 'pay_1', amount: 100000 }, store, { via: 'webhook' })
    expect(r.status).toBe('committed')
    expect(commitOrder).toHaveBeenCalledTimes(1)
    await flush()
    expect(recordCapturedPayment).toHaveBeenCalledTimes(1)
    expect(sendOrderConfirmationEmail).toHaveBeenCalled()
  })

  it('manual task when the cart is empty', async () => {
    queryOne.mockResolvedValueOnce({ id: 'intent_1', draft_token: 'd', user_id: 'u1', amount_paise: 5000 })
    verifyDraftToken.mockResolvedValueOnce({ mode: 'cart', cartHash: null })
    queryOne.mockResolvedValueOnce({ id: 'u1', email: 'c@x.com' }) // user
    loadActiveCart.mockResolvedValueOnce([])
    const r = await commitDraftFromCapture('rzp_1', { id: 'pay_1', amount: 5000 }, store)
    expect(r).toMatchObject({ status: 'needs_action', reason: 'Payment captured but the cart is empty' })
  })

  it('manual task when the cart changed after payment', async () => {
    queryOne.mockResolvedValueOnce({ id: 'intent_1', draft_token: 'd', user_id: 'u1', amount_paise: 5000 })
    queryOne.mockResolvedValueOnce({ id: 'u1', email: 'c@x.com' })
    verifyDraftToken.mockResolvedValueOnce({ mode: 'cart', cartHash: 'OLD' })
    loadActiveCart.mockResolvedValueOnce([{ id: 'ci1', product_id: 'p1' }])
    hashCartItems.mockReturnValueOnce('NEW')
    const r = await commitDraftFromCapture('rzp_1', { id: 'pay_1', amount: 5000 }, store)
    expect(r).toMatchObject({ status: 'needs_action', reason: 'Payment captured but the cart changed' })
  })

  it('commits a buyNow draft (does not book when paid:false)', async () => {
    queryOne
      .mockResolvedValueOnce({ id: 'intent_1', draft_token: 'd', user_id: 'u1', amount_paise: 50000 }) // intent
      .mockResolvedValueOnce({ id: 'u1', email: 'c@x.com', first_name: 'C' }) // user
      .mockResolvedValueOnce({ id: 'prod_1', name: 'P', gst_percentage: '18' }) // product
      .mockResolvedValueOnce({ id: 'o1', order_number: 'ORD-2', total_amount: '500' }) // full order
    verifyDraftToken.mockResolvedValueOnce({
      mode: 'buyNow',
      buyNowItem: { productId: 'prod_1', qty: 1, price: 500 },
      addressId: 'a1',
      shippingAmount: 0,
      codFeeAmount: 0,
    })
    commitOrder.mockResolvedValueOnce({ id: 'o1', order_number: 'ORD-2', total_amount: '500', status: 'placed' })
    queryMany.mockResolvedValueOnce([{ id: 'oi1', product_id: 'prod_1' }])
    const r = await commitDraftFromCapture('rzp_1', { id: 'pay_1', amount: 50000 }, store, { paid: false })
    expect(r.status).toBe('committed')
    expect(recordCapturedPayment).not.toHaveBeenCalled() // not paid -> not booked
    expect(sendOrderConfirmationEmail).toHaveBeenCalled()
  })

  it('generates an invoice and grants access for an all-digital (granted) order', async () => {
    queryOne
      .mockResolvedValueOnce({ id: 'intent_1', draft_token: 'd', user_id: 'u1', amount_paise: 100000 })
      .mockResolvedValueOnce({ id: 'u1', email: 'c@x.com' })
      .mockResolvedValueOnce({ id: 'o1', order_number: 'ORD-3', total_amount: '1000' })
    verifyDraftToken.mockResolvedValueOnce({ mode: 'cart', cartHash: null })
    loadActiveCart.mockResolvedValueOnce([{ id: 'ci1', product_id: 'p1' }])
    commitOrder.mockResolvedValueOnce({ id: 'o1', order_number: 'ORD-3', total_amount: '1000', status: 'granted' })
    queryMany.mockResolvedValueOnce([{ id: 'oi1', product_id: 'p1' }])
    await commitDraftFromCapture('rzp_1', { id: 'pay_1', amount: 100000 }, store)
    expect(createDraftInvoice).toHaveBeenCalledWith('o1')
    expect(notifyAccessGranted).toHaveBeenCalled()
  })

  it('raises a manual task when commitOrder throws', async () => {
    queryOne
      .mockResolvedValueOnce({ id: 'intent_1', draft_token: 'd', user_id: 'u1', amount_paise: 100000 })
      .mockResolvedValueOnce({ id: 'u1', email: 'c@x.com' })
    verifyDraftToken.mockResolvedValueOnce({ mode: 'cart', cartHash: null })
    loadActiveCart.mockResolvedValueOnce([{ id: 'ci1', product_id: 'p1' }])
    commitOrder.mockRejectedValueOnce(new Error('out of stock'))
    const r = await commitDraftFromCapture('rzp_1', { id: 'pay_1', amount: 100000 }, store)
    expect(r).toMatchObject({ status: 'needs_action', reason: 'Payment captured but the order failed' })
  })
})
