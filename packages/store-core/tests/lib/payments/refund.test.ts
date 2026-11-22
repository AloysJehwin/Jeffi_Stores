import { describe, it, expect, vi, beforeEach } from 'vitest'

const queryMany = vi.fn<(...a: any[]) => any>()
const query = vi.fn<(...a: any[]) => any>(async () => ({ rows: [], rowCount: 1 }))
const getBusinessValues = vi.fn<(...a: any[]) => any>(async () => ({ returnStandardCharge: 50 }))
const refundInstance = vi.fn<(...a: any[]) => any>()
const getRazorpayInstanceFor = vi.fn<(...a: any[]) => any>()
const applyRouteRefund = vi.fn<(...a: any[]) => any>(async () => ({ unrecoveredPaise: 0 }))
const recordRefund = vi.fn<(...a: any[]) => any>(async () => {})
const queueAdsConversion = vi.fn<(...a: any[]) => any>(async () => ({ action: 'none' }))
const phonePeRefund = vi.fn<(...a: any[]) => any>(async () => ({ state: 'COMPLETED', refundId: 'pp_1' }))
const credsForMerchantOrder = vi.fn<(...a: any[]) => any>(async () => ({ env: 'sandbox' }))

vi.mock('@/lib/shared/db', () => ({ queryMany: (...a: any[]) => queryMany(...a), query: (...a: any[]) => query(...a) }))
vi.mock('@/lib/catalog/site-controls', () => ({ getBusinessValues: (...a: any[]) => getBusinessValues(...a) }))
vi.mock('@/lib/payments/razorpay', () => ({ getRazorpayInstanceFor: (...a: any[]) => getRazorpayInstanceFor(...a) }))
vi.mock('@/lib/payments/route-settlement', () => ({ applyRouteRefund: (...a: any[]) => applyRouteRefund(...a) }))
vi.mock('@/lib/payments/refund-records', () => ({ recordRefund: (...a: any[]) => recordRefund(...a) }))
vi.mock('@/lib/google-ads/conversions/queue', () => ({ queueAdsConversion: (...a: any[]) => queueAdsConversion(...a) }))
vi.mock('@/lib/payments/upi/phonepe', () => ({ refund: (...a: any[]) => phonePeRefund(...a) }))
vi.mock('@/lib/payments/upi/settle', () => ({ credsForMerchantOrder: (...a: any[]) => credsForMerchantOrder(...a) }))

import { computeRefundableAmount, refundCapacity, refundAcrossPayments, recordExternalRefund, externalRefundCeiling } from '@/lib/payments/refund'

beforeEach(() => {
  vi.clearAllMocks()
  query.mockResolvedValue({ rows: [], rowCount: 1 })
  getBusinessValues.mockResolvedValue({ returnStandardCharge: 50 })
  refundInstance.mockImplementation(async (_id: string, o: { amount: number }) => ({ id: `rfnd_${o.amount}`, amount: o.amount }))
  getRazorpayInstanceFor.mockResolvedValue({ instance: { payments: { refund: refundInstance } } })
  applyRouteRefund.mockResolvedValue({ unrecoveredPaise: 0 })
  phonePeRefund.mockResolvedValue({ state: 'COMPLETED', refundId: 'pp_1' })
})

describe('computeRefundableAmount', () => {
  it('refunds the full order total for a non-return, rounded to paise', async () => {
    expect(await computeRefundableAmount({ status: 'delivered', total_amount: '199.999' }, null)).toBe(200)
    expect(await computeRefundableAmount({ status: 'cancelled', total_amount: 0 }, null)).toBe(0)
  })
  it('for a return: sums item refund amounts minus the standard charge', async () => {
    const r = await computeRefundableAmount(
      { status: 'returned', total_amount: '1000' },
      { items: [{ refund_amount: '300' }, { refund_amount: '200' }] }
    )
    expect(r).toBe(450) // 500 - 50
  })
  it('for a return with no items: uses the order total minus the charge', async () => {
    const r = await computeRefundableAmount({ status: 'returned', total_amount: '300' }, { items: [] })
    expect(r).toBe(250)
  })
  it('never returns negative', async () => {
    getBusinessValues.mockResolvedValueOnce({ returnStandardCharge: 1000 })
    const r = await computeRefundableAmount({ status: 'returned', total_amount: '100' }, null)
    expect(r).toBe(0)
  })
})

describe('refundCapacity', () => {
  it('is the full amount when there are no prior refunds', () => {
    expect(refundCapacity({ amount: '500', gateway_response: {} })).toBe(500)
  })
  it('subtracts partial_refunds and the legacy variantChangeRefund (paise)', () => {
    const cap = refundCapacity({
      amount: '500',
      gateway_response: { partial_refunds: [{ amount: 100 }, { amount: 50 }], variantChangeRefund: { amount: 5000 } },
    })
    expect(cap).toBe(300) // 500 - 150 - 50
  })
  it('parses a JSON string gateway_response and clamps at 0', () => {
    const cap = refundCapacity({ amount: '100', gateway_response: JSON.stringify({ partial_refunds: [{ amount: 200 }] }) })
    expect(cap).toBe(0)
  })
})

describe('refundAcrossPayments — PhonePe + manual UPI branches', () => {
  it('refunds a PhonePe (upi_upg) payment via its refund API and records it', async () => {
    queryMany.mockResolvedValue([
      { id: 'p1', transaction_id: 'TXN1', amount: '300', gateway_response: { merchant_order_id: 'M1' }, payment_gateway: 'phonepe' },
    ])
    const r = await refundAcrossPayments({ orderId: 'o1', amount: 100, orderRef: 'ORD-1', purpose: 'return', tenantId: 'tx' })
    expect(phonePeRefund).toHaveBeenCalledTimes(1)
    const [, body] = vi.mocked(phonePeRefund).mock.calls[0]
    expect(body).toMatchObject({ originalMerchantOrderId: 'M1', amountPaise: 10000 })
    expect(r.refunded).toBe(100)
    expect(recordRefund).toHaveBeenCalledTimes(1)
    // No Razorpay instance needed for a pure-phonepe order
    expect(getRazorpayInstanceFor).not.toHaveBeenCalled()
    expect(applyRouteRefund).toHaveBeenCalledWith(expect.objectContaining({ paymentId: 'TXN1', refundPaise: 10000 }))
  })

  it('leaves a manual UPI transfer for an external refund and throws with manualUpi', async () => {
    queryMany.mockResolvedValue([
      { id: 'p1', transaction_id: 'TXN1', amount: '200', gateway_response: {}, payment_gateway: 'upi_manual' },
    ])
    await expect(refundAcrossPayments({ orderId: 'o1', amount: 150, orderRef: 'ORD-1', purpose: 'return' })).rejects.toMatchObject({ manualUpi: true })
    expect(phonePeRefund).not.toHaveBeenCalled()
  })

  it('throws a PhonePe error when the payment has no merchant order id', async () => {
    queryMany.mockResolvedValue([
      { id: 'p1', transaction_id: 'TXN1', amount: '300', gateway_response: {}, payment_gateway: 'phonepe' },
    ])
    await expect(refundAcrossPayments({ orderId: 'o1', amount: 100, orderRef: 'ORD-1', purpose: 'x' })).rejects.toThrow(/no PhonePe order/)
  })

  it('maps a PhonePe FAILED/pending state onto the refund record status', async () => {
    queryMany.mockResolvedValue([
      { id: 'p1', transaction_id: 'TXN1', amount: '300', gateway_response: { merchant_order_id: 'M1' }, payment_gateway: 'phonepe' },
    ])
    phonePeRefund.mockResolvedValueOnce({ state: 'FAILED', refundId: 'pp_x' })
    await refundAcrossPayments({ orderId: 'o1', amount: 50, orderRef: 'ORD-1', purpose: 'x' })
    const arg = vi.mocked(recordRefund).mock.calls[0][0] as any
    expect(arg.refund.status).toBe('failed')
  })
})

describe('externalRefundCeiling', () => {
  it('returns null when the order has no completed payments', async () => {
    queryMany.mockResolvedValue([])
    expect(await externalRefundCeiling('o1')).toBeNull()
  })
  it('sums refund capacity across completed payments', async () => {
    queryMany.mockResolvedValue([
      { amount: '300', gateway_response: { partial_refunds: [{ amount: 100 }] } },
      { amount: '200', gateway_response: {} },
    ])
    expect(await externalRefundCeiling('o1')).toBe(400) // (300-100) + 200
  })
})

describe('recordExternalRefund', () => {
  it('inserts a manual refunded row when the order has no payments', async () => {
    queryMany.mockResolvedValue([])
    await recordExternalRefund({
      orderId: 'o1',
      amount: 500,
      full: true,
      refund: { method: 'cash', reference: null, note: null },
      purpose: 'goodwill',
      orderRef: 'ORD-1',
    })
    const insert = vi.mocked(query).mock.calls.find(c => String(c[0]).includes('INSERT INTO payments'))
    expect(insert).toBeTruthy()
    expect(insert![1]![2]).toBe('500.00') // amount.toFixed(2)
    expect(applyRouteRefund).not.toHaveBeenCalled()
  })

  it('marks completed payments refunded on a full external refund', async () => {
    queryMany.mockResolvedValue([
      { id: 'p1', transaction_id: 'pay_1', payment_gateway: 'razorpay', amount: '500', gateway_response: {} },
    ])
    await recordExternalRefund({
      orderId: 'o1',
      amount: 500,
      full: true,
      refund: { method: 'bank_transfer', reference: 'B1', note: null },
      purpose: 'return',
      orderRef: 'ORD-1',
    })
    const upd = vi.mocked(query).mock.calls.find(c => String(c[0]).includes('UPDATE payments'))
    expect(String(upd![0])).toContain("status = 'refunded'")
    // bank_transfer is not a Razorpay-only method -> no Route settle
    expect(applyRouteRefund).not.toHaveBeenCalled()
  })

  it('books a partial external refund and settles the Route share for a dispute', async () => {
    queryMany.mockResolvedValue([
      { id: 'p1', transaction_id: 'pay_1', payment_gateway: 'razorpay', amount: '500', gateway_response: {} },
    ])
    await recordExternalRefund({
      orderId: 'o1',
      amount: 200,
      full: false,
      refund: { method: 'razorpay_dispute', reference: 'disp_9', note: null },
      purpose: 'dispute',
      orderRef: 'ORD-1',
      tenantId: 'tx',
    })
    const upd = vi.mocked(query).mock.calls.find(c => String(c[0]).includes('UPDATE payments'))
    expect(String(upd![0])).not.toContain("status = 'refunded'") // partial keeps status
    expect(applyRouteRefund).toHaveBeenCalledTimes(1)
    expect(vi.mocked(applyRouteRefund).mock.calls[0][0]).toMatchObject({ paymentId: 'pay_1', refundId: 'disp_9', refundPaise: 20000 })
  })

  it('skips a partial entry when the payment has no remaining capacity', async () => {
    queryMany.mockResolvedValue([
      { id: 'p1', transaction_id: 'pay_1', payment_gateway: 'razorpay', amount: '100', gateway_response: { partial_refunds: [{ amount: 100 }] } },
    ])
    await recordExternalRefund({
      orderId: 'o1',
      amount: 50,
      full: false,
      refund: { method: 'razorpay_dashboard', reference: 'rfnd_x', note: null },
      purpose: 'x',
      orderRef: 'ORD-1',
    })
    const upd = vi.mocked(query).mock.calls.find(c => String(c[0]).includes('UPDATE payments'))
    expect(upd).toBeFalsy() // nothing to take -> continue
    expect(applyRouteRefund).not.toHaveBeenCalled()
  })
})
