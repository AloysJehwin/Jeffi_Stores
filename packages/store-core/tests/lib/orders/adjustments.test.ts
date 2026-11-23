import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))

const mockClient = { query: vi.fn() }
vi.mock('@/lib/shared/db', () => ({
  query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
  queryOne: vi.fn(async () => null),
  queryMany: vi.fn(async () => []),
  queryCount: vi.fn(async () => 0),
  getClient: vi.fn(),
  withTransaction: vi.fn(async (fn: any) => fn(mockClient)),
}))
vi.mock('@/lib/catalog/site-controls', () => ({
  getFeatureFlags: vi.fn(async () => ({ gstEnabled: true })),
  getBusinessValues: vi.fn(async () => ({ businessStateCode: '33', delhiveryOriginPincode: '600001' })),
}))
vi.mock('@/lib/catalog/unit-factor', () => ({
  sellingUnitsFor: vi.fn(async (lines: any[]) => lines.map(() => ({ unit: null, factor: 1 }))),
}))
vi.mock('@/lib/shared/activity', () => ({ logActivity: vi.fn(async () => {}) }))
vi.mock('@/lib/payments/route-settlement', () => ({ recordCapturedPayment: vi.fn(async () => {}) }))
vi.mock('@/lib/integrations/resolve', () => ({ resolveRazorpayCreds: vi.fn(async () => ({ isOwn: true })) }))
// resolveBuyNowItem is used by previewAdjustment switch lines; stub it so pricing is deterministic.
vi.mock('@/lib/orders/order-commit', () => ({
  resolveBuyNowItem: vi.fn(async () => ({ ok: true, item: { price: 100, productId: 'p9', variantId: null, subVariantId: null, qty: 1, buyMode: 'unit', buyUnit: null, isDigital: false } })),
}))

import {
  AdjustmentError,
  previewAdjustment,
  createAdjustment,
  recalcOrderTotals,
  applyAdjustment,
  settleAdjustmentPayment,
} from '@/lib/orders/adjustments'
import { queryOne, queryMany } from '@/lib/shared/db'
import { getFeatureFlags } from '@/lib/catalog/site-controls'
import { resolveBuyNowItem } from '@/lib/orders/order-commit'
import { logActivity } from '@/lib/shared/activity'

beforeEach(() => {
  vi.clearAllMocks()
  mockClient.query.mockReset()
})

const order = {
  id: 'o1', order_number: 'ORD-1', user_id: 'u1', status: 'confirmed', payment_status: 'paid', payment_mode: 'prepaid',
  awb_number: null, is_igst: false, subtotal: 200, discount_amount: 20, business_discount_amount: 0,
  shipping_amount: 0, cod_fee_amount: 0, total_amount: 180,
}
function item(over: any = {}) {
  return {
    id: 'it1', product_id: 'p1', variant_id: null, sub_variant_id: null, product_name: 'Widget', product_sku: 'S1',
    variant_name: null, sub_variant_name: null, quantity: '1', unit_price: '100', total_price: '100', mrp: '150',
    gst_rate: '18', hsn_code: 'H1', buy_mode: 'unit', buy_unit: null, sold_unit: null, sold_unit_factor: '1', is_digital: false,
    ...over,
  }
}

describe('AdjustmentError', () => {
  it('carries a status (defaults 400)', () => {
    expect(new AdjustmentError('x').status).toBe(400)
    expect(new AdjustmentError('x', 404).status).toBe(404)
  })
})

describe('previewAdjustment', () => {
  it('throws when order missing / not eligible', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce(null)
    await expect(previewAdjustment('o1', [{ orderItemId: 'it1', action: 'quantity', quantity: 2 }], true)).rejects.toThrow('Order not found')
    vi.mocked(queryOne).mockResolvedValueOnce({ ...order, status: 'processing' })
    await expect(previewAdjustment('o1', [{ orderItemId: 'it1', action: 'quantity', quantity: 2 }], true)).rejects.toThrow(/confirmed orders/)
  })
  it('validates line membership, duplicates, digital, qty, switch target, empty, remove-all', async () => {
    vi.mocked(queryOne).mockResolvedValue(order)
    vi.mocked(queryMany).mockResolvedValue([item(), item({ id: 'it2' })] as any)
    await expect(previewAdjustment('o1', [{ orderItemId: 'nope', action: 'quantity', quantity: 1 }], true)).rejects.toThrow(/not part of this order/)
    await expect(previewAdjustment('o1', [{ orderItemId: 'it1', action: 'quantity', quantity: 1 }, { orderItemId: 'it1', action: 'quantity', quantity: 2 }], true)).rejects.toThrow(/only be changed once/)
    await expect(previewAdjustment('o1', [{ orderItemId: 'it1', action: 'quantity', quantity: 0 }], true)).rejects.toThrow(/more than 0/)
    await expect(previewAdjustment('o1', [{ orderItemId: 'it1', action: 'switch', quantity: 1 }], true)).rejects.toThrow(/Pick the product/)
    await expect(previewAdjustment('o1', [], true)).rejects.toThrow('Nothing to change.')
    await expect(previewAdjustment('o1', [{ orderItemId: 'it1', action: 'remove' }, { orderItemId: 'it2', action: 'remove' }], true)).rejects.toThrow(/cancels the order/)
    // digital non-remove
    vi.mocked(queryMany).mockResolvedValueOnce([item({ is_digital: true }), item({ id: 'it2' })] as any)
    await expect(previewAdjustment('o1', [{ orderItemId: 'it1', action: 'quantity', quantity: 2 }], true)).rejects.toThrow(/Digital items/)
  })
  it('prices a quantity change and computes settlement = collect with carried discount rate', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce(order) // order
    vi.mocked(queryMany).mockResolvedValueOnce([item()] as any)
    // Change qty 1→2 on a ₹100 line. oldSubtotal 100, newSubtotal 200. oldDiscount 20 → rate 0.2.
    // settlePayment=true → newDiscount = min(20, 0.2*200=40) = 20. netDiff = (200-20) - (100-20) = 100 > 0 → collect.
    const r = await previewAdjustment('o1', [{ orderItemId: 'it1', action: 'quantity', quantity: 2 }], true)
    expect(r.oldSubtotal).toBe(100)
    expect(r.newSubtotal).toBe(200)
    expect(r.newDiscount).toBe(20)
    expect(r.netDiff).toBe(100)
    expect(r.settlementType).toBe('collect')
    // oldPaid 100*(1-0.2)=80 ; newPaid 200*(1-0.1)=180 → diff 100
    expect(r.lines[0].diff).toBe(100)
  })
  it('refund requires the order be paid online', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce({ ...order, payment_status: 'unpaid', payment_mode: 'prepaid' })
    vi.mocked(queryMany).mockResolvedValueOnce([item(), item({ id: 'it2', total_price: '100', unit_price: '100' })] as any)
    // remove it2 → newSubtotal 100 < old 200 → refund, but not paid → throws
    await expect(previewAdjustment('o1', [{ orderItemId: 'it2', action: 'remove' }], true)).rejects.toThrow(/nothing to refund/)
  })
  it('waived (settlePayment=false) → settlement none, discount absorbs the diff', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce(order)
    vi.mocked(queryMany).mockResolvedValueOnce([item()] as any)
    const r = await previewAdjustment('o1', [{ orderItemId: 'it1', action: 'quantity', quantity: 2 }], false)
    // newDiscount = max(0, newSubtotal - (oldSubtotal - oldDiscount)) = max(0, 200 - 80) = 120
    expect(r.newDiscount).toBe(120)
    expect(r.settlementType).toBe('none')
  })
  it('COD order → cod_adjust', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce({ ...order, payment_mode: 'cod', payment_status: 'unpaid' })
    vi.mocked(queryMany).mockResolvedValueOnce([item()] as any)
    const r = await previewAdjustment('o1', [{ orderItemId: 'it1', action: 'quantity', quantity: 2 }], true)
    expect(r.settlementType).toBe('cod_adjust')
  })
  it('switch line prices via resolveBuyNowItem + loadTarget', async () => {
    vi.mocked(queryOne)
      .mockResolvedValueOnce(order) // order
      .mockResolvedValueOnce({ product_name: 'New', variant_name: null, sub_variant_name: null, sku: 'NEW', mrp: 120, gst_percentage: 18, hsn_code: 'H2', weight_grams: 10, package_type: 'box', length_cm: 1, breadth_cm: 1, height_cm: 1, product_active: true }) // loadTarget
    vi.mocked(queryMany).mockResolvedValueOnce([item()] as any)
    const r = await previewAdjustment('o1', [{ orderItemId: 'it1', action: 'switch', productId: 'p9', quantity: 2 }], true)
    expect(vi.mocked(resolveBuyNowItem)).toHaveBeenCalled()
    expect(r.lines[0].new?.total).toBe(200) // 100 * 2
    expect(r.lines[0].new?.productName).toBe('New')
  })
  it('switch pricing failure surfaces as an AdjustmentError', async () => {
    vi.mocked(resolveBuyNowItem).mockResolvedValueOnce({ ok: false, error: 'oops' } as any)
    vi.mocked(queryOne).mockResolvedValueOnce(order)
    vi.mocked(queryMany).mockResolvedValueOnce([item()] as any)
    await expect(previewAdjustment('o1', [{ orderItemId: 'it1', action: 'switch', productId: 'p9', quantity: 1 }], true)).rejects.toThrow('oops')
  })
})

describe('createAdjustment', () => {
  it('rejects when an open change already exists', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce(order) // preview order
    vi.mocked(queryMany).mockResolvedValueOnce([item()] as any)
    vi.mocked(queryOne).mockResolvedValueOnce({ exists: 1 }) // open check
    await expect(createAdjustment({ orderId: 'o1', lines: [{ orderItemId: 'it1', action: 'quantity', quantity: 2 }], settlePayment: true })).rejects.toThrow(/already has a change/)
  })
  it('inserts adjustment + lines and returns id + preview', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce(order)
    vi.mocked(queryMany).mockResolvedValueOnce([item()] as any)
    vi.mocked(queryOne).mockResolvedValueOnce(null) // no open change
    mockClient.query.mockImplementation(async (sql: string) => {
      if (/INSERT INTO order_adjustments/.test(sql)) return { rows: [{ id: 'adj1' }] }
      return { rows: [] }
    })
    const r = await createAdjustment({ orderId: 'o1', lines: [{ orderItemId: 'it1', action: 'quantity', quantity: 2 }], settlePayment: true, adminId: 'adm' })
    expect(r.id).toBe('adj1')
    expect(r.preview.netDiff).toBe(100)
    expect(mockClient.query.mock.calls.some(c => /INSERT INTO order_adjustment_lines/.test(c[0]))).toBe(true)
  })
})

describe('recalcOrderTotals', () => {
  it('re-sums items and keeps existing discounts when none given', async () => {
    mockClient.query.mockImplementation(async (sql: string) => {
      if (/SUM\(total_price\)/.test(sql)) return { rows: [{ subtotal: 300, taxable: 254.24, cgst: 22.88, sgst: 22.88, igst: 0, tax: 45.76 }] }
      if (/discount_amount, business_discount_amount, shipping_amount, cod_fee_amount/.test(sql)) return { rows: [{ discount_amount: 20, business_discount_amount: 0, shipping_amount: 50, cod_fee_amount: 0 }] }
      return { rows: [] }
    })
    const total = await recalcOrderTotals(mockClient as any, 'o1', true)
    // 300 - 20 - 0 + 50 = 330
    expect(total).toBe(330)
    const upd = mockClient.query.mock.calls.find(c => /UPDATE orders SET subtotal/.test(c[0]))!
    expect(upd[1][0]).toBe(300) // subtotal
    expect(upd[1][6]).toBe(20) // coupon kept
  })
  it('replaces discounts and zeroes tax when GST off', async () => {
    mockClient.query.mockImplementation(async (sql: string) => {
      if (/SUM\(total_price\)/.test(sql)) return { rows: [{ subtotal: 300, taxable: 254, cgst: 23, sgst: 23, igst: 0, tax: 46 }] }
      if (/discount_amount, business_discount_amount, shipping_amount, cod_fee_amount/.test(sql)) return { rows: [{ discount_amount: 99, business_discount_amount: 99, shipping_amount: 0, cod_fee_amount: 0 }] }
      return { rows: [] }
    })
    const total = await recalcOrderTotals(mockClient as any, 'o1', false, { coupon: 10, business: 5 })
    // 300 - 10 - 5 = 285
    expect(total).toBe(285)
    const upd = mockClient.query.mock.calls.find(c => /UPDATE orders SET subtotal/.test(c[0]))!
    expect(upd[1][1]).toBe(0) // taxable zeroed (GST off)
    expect(upd[1][6]).toBe(10) // coupon replaced
    expect(upd[1][7]).toBe(5) // business replaced
  })
})

describe('applyAdjustment', () => {
  const adj = { id: 'adj1', order_id: 'o1', status: 'pending_customer', new_discount: 20, new_business_discount: 0, settlement_type: 'collect', net_diff: 100 }
  function script(over: { adj?: any; order?: any; lines?: any } = {}) {
    mockClient.query.mockImplementation(async (sql: string) => {
      if (/FROM order_adjustments WHERE id = \$1 FOR UPDATE/.test(sql)) return { rows: over.adj === null ? [] : [over.adj ?? adj] }
      if (/FROM orders WHERE id = \$1 FOR UPDATE/.test(sql)) return { rows: over.order === null ? [] : [over.order ?? order] }
      if (/FROM order_adjustment_lines/.test(sql)) return { rows: over.lines ?? [] }
      if (/SUM\(total_price\)/.test(sql)) return { rows: [{ subtotal: 200, taxable: 169, cgst: 15, sgst: 15, igst: 0, tax: 30 }] }
      if (/discount_amount, business_discount_amount, shipping_amount, cod_fee_amount/.test(sql)) return { rows: [{ discount_amount: 0, business_discount_amount: 0, shipping_amount: 0, cod_fee_amount: 0 }] }
      return { rows: [] }
    })
  }
  it('guards: not found / already applied / inactive / order gone / not eligible', async () => {
    script({ adj: null })
    expect(await applyAdjustment('adj1')).toEqual({ applied: false, reason: 'not_found' })
    script({ adj: { ...adj, status: 'applied' } })
    expect(await applyAdjustment('adj1')).toEqual({ applied: false, reason: 'already_applied' })
    script({ adj: { ...adj, status: 'rejected' } })
    expect(await applyAdjustment('adj1')).toEqual({ applied: false, reason: 'not_active' })
    script({ order: null })
    expect(await applyAdjustment('adj1')).toEqual({ applied: false, reason: 'order_not_found' })
    script({ order: { ...order, awb_number: 'AWB' } })
    expect(await applyAdjustment('adj1')).toEqual({ applied: false, reason: 'order_not_eligible' })
  })
  it('applies remove / quantity / switch lines then recalcs + logs', async () => {
    script({ lines: [
      { action: 'remove', order_item_id: 'it-rm', new_line: null },
      { action: 'quantity', order_item_id: 'it-q', new_line: { quantity: 2, total: 200, gstRate: 18 } },
      { action: 'switch', order_item_id: 'it-s', new_line: { productId: 'p9', variantId: null, subVariantId: null, productName: 'N', sku: 'S', variantName: null, subVariantName: null, quantity: 1, unitPrice: 100, total: 100, mrp: 120, gstRate: 18, hsn: 'H', unit: 'unit', factor: 1, weightGrams: 1, packageType: 'box', lengthCm: 1, breadthCm: 1, heightCm: 1 } },
    ] })
    const r = await applyAdjustment('adj1', 'adm')
    expect(r).toEqual({ applied: true })
    expect(mockClient.query.mock.calls.some(c => /DELETE FROM order_items/.test(c[0]))).toBe(true)
    expect(mockClient.query.mock.calls.some(c => /UPDATE order_items SET quantity = \$1/.test(c[0]))).toBe(true)
    expect(mockClient.query.mock.calls.some(c => /UPDATE order_items SET product_id = \$1/.test(c[0]))).toBe(true)
    expect(mockClient.query.mock.calls.some(c => /SET status = 'applied'/.test(c[0]))).toBe(true)
    expect(vi.mocked(logActivity)).toHaveBeenCalled()
  })
})

describe('settleAdjustmentPayment', () => {
  const adj = { id: 'adj1aaaa', order_id: 'o1', order_number: 'ORD-1', status: 'awaiting_payment', net_diff: 50 }
  it('no request / already applied', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce(null)
    expect(await settleAdjustmentPayment({ razorpayOrderId: 'ro', razorpayPaymentId: 'pay', amountPaise: 5000 })).toEqual({ applied: false, reason: 'no_request' })
    vi.mocked(queryOne).mockResolvedValueOnce({ ...adj, status: 'applied' })
    expect(await settleAdjustmentPayment({ razorpayOrderId: 'ro', razorpayPaymentId: 'pay', amountPaise: 5000 })).toEqual({ applied: false, reason: 'already_applied' })
  })
  it('records payment via gw.book then applies (apply short-circuits not_found)', async () => {
    const book = vi.fn(async () => {})
    vi.mocked(queryOne)
      .mockResolvedValueOnce(adj as any)        // find adj
      .mockResolvedValueOnce({ id: 'pay-row' }) // insert payment
      .mockResolvedValueOnce({ id: adj.id })    // update razorpay_payment_id
    mockClient.query.mockResolvedValue({ rows: [] }) // applyAdjustment → adj not found
    const r = await settleAdjustmentPayment({ razorpayOrderId: 'ro', razorpayPaymentId: 'pay', amountPaise: 5000, gw: { gateway: 'upi_phonepe', method: 'upi', book } })
    expect(book).toHaveBeenCalledWith(expect.objectContaining({ paymentId: 'pay', grossInr: 50, orderId: 'o1' }))
    expect(r).toEqual({ applied: false, reason: 'not_found' })
  })
  it('books the tenant share via route-settlement when a tenant is given (own creds)', async () => {
    vi.mocked(queryOne)
      .mockResolvedValueOnce(adj as any)
      .mockResolvedValueOnce({ id: 'pay-row' })
      .mockResolvedValueOnce({ id: adj.id })
    mockClient.query.mockResolvedValue({ rows: [] })
    const { recordCapturedPayment } = await import('@/lib/payments/route-settlement')
    const r = await settleAdjustmentPayment({ razorpayOrderId: 'ro', razorpayPaymentId: 'pay', amountPaise: 5000, tenant: { tenantId: 't1', slug: 'acme' } })
    expect(vi.mocked(recordCapturedPayment)).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't1', tenantSlug: 'acme', grossInr: 50, collectedOn: 'own' }))
    expect(r).toEqual({ applied: false, reason: 'not_found' })
  })

  it('falls back to abs(net_diff) when amountPaise is 0', async () => {
    vi.mocked(queryOne)
      .mockResolvedValueOnce({ ...adj, net_diff: -75 } as any)
      .mockResolvedValueOnce({ id: 'pay-row' })
      .mockResolvedValueOnce({ id: adj.id })
    mockClient.query.mockResolvedValue({ rows: [] })
    await settleAdjustmentPayment({ razorpayOrderId: 'ro', razorpayPaymentId: 'pay', amountPaise: 0 })
    const insCall = vi.mocked(queryOne).mock.calls.find(c => /INSERT INTO payments/.test(c[0] as string))!
    expect(insCall[1]).toContain('75.00') // amount = abs(-75)
  })
})
