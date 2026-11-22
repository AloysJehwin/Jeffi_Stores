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
vi.mock('@/lib/catalog/site-controls', () => ({ getFeatureFlags: vi.fn(async () => ({ gstEnabled: true })) }))
vi.mock('@/lib/shared/activity', () => ({ logActivity: vi.fn(async () => {}) }))

import {
  computeVariantChangePreview,
  loadVariantPriceRow,
  applyVariantChange,
  settleVariantChangePayment,
} from '@/lib/orders/variant-change'
import { queryOne } from '@/lib/shared/db'
import { getFeatureFlags } from '@/lib/catalog/site-controls'
import { logActivity } from '@/lib/shared/activity'

beforeEach(() => {
  vi.clearAllMocks()
  mockClient.query.mockReset()
})

const priceRow = { id: 'v2', name: 'Blue', sku: 'SKU-B', product_name: 'Shirt', parent_variant_name: null, price: 236, price_ex_gst: 200, mrp: 300, gst_percentage: 18 }

describe('computeVariantChangePreview', () => {
  it('collect when new > old (GST on uses inclusive price)', () => {
    const r = computeVariantChangePreview({ oldUnitPrice: 118, qty: 2, newV: priceRow as any, gstEnabled: true })
    // newUnitPrice 236, diff (236-118)*2 = 236
    expect(r).toMatchObject({ newUnitPrice: 236, priceDiff: 236, settlementType: 'collect', codSettlement: 'cod_adjust' })
  })
  it('refund when new < old (GST off uses ex-gst)', () => {
    const r = computeVariantChangePreview({ oldUnitPrice: 236, qty: 1, newV: priceRow as any, gstEnabled: false })
    // newUnitPrice 200 (ex-gst), diff 200-236 = -36
    expect(r.newUnitPrice).toBe(200)
    expect(r.priceDiff).toBe(-36)
    expect(r.settlementType).toBe('refund')
  })
  it('none when equal', () => {
    const r = computeVariantChangePreview({ oldUnitPrice: 236, qty: 3, newV: priceRow as any, gstEnabled: true })
    expect(r.priceDiff).toBe(0)
    expect(r.settlementType).toBe('none')
  })
})

describe('loadVariantPriceRow', () => {
  it('sub-variant preferred', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce(priceRow as any)
    await loadVariantPriceRow('v1', 'sv1', 'p1')
    expect(vi.mocked(queryOne).mock.calls[0][0]).toMatch(/FROM product_sub_variants/)
    expect(vi.mocked(queryOne).mock.calls[0][1]).toEqual(['sv1', 'p1'])
  })
  it('variant path', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce(priceRow as any)
    await loadVariantPriceRow('v1', null, 'p1')
    expect(vi.mocked(queryOne).mock.calls[0][0]).toMatch(/FROM product_variants/)
    expect(vi.mocked(queryOne).mock.calls[0][1]).toEqual(['v1', 'p1'])
  })
  it('null when neither given', async () => {
    expect(await loadVariantPriceRow(null, null, 'p1')).toBeNull()
  })
})

describe('applyVariantChange', () => {
  const vcr = { id: 'vc1', order_id: 'o1', order_item_id: 'it1', new_variant_id: 'v2', new_sub_variant_id: null, new_unit_price: 236, qty: 2, price_diff: 236, settlement_type: 'collect', status: 'awaiting_payment' }
  const order = { id: 'o1', order_number: 'ORD-1', user_id: 'u1', status: 'confirmed', payment_status: 'paid', payment_mode: 'prepaid', awb_number: null, is_igst: false }
  const item = { id: 'it1', product_id: 'p1', quantity: '2', gst_rate: '18' }

  function script(over: { vcr?: any; order?: any; item?: any; newV?: any } = {}) {
    // loadVariantPriceRow uses the pool queryOne, not the tx client.
    vi.mocked(queryOne).mockResolvedValue(over.newV === undefined ? (priceRow as any) : (over.newV === null ? null : over.newV))
    mockClient.query.mockImplementation(async (sql: string) => {
      if (/FROM variant_change_requests WHERE id/.test(sql)) return { rows: over.vcr === null ? [] : [over.vcr ?? vcr] }
      if (/FROM orders WHERE id = \$1 FOR UPDATE/.test(sql)) return { rows: over.order === null ? [] : [over.order ?? order] }
      if (/FROM order_items WHERE id = \$1 AND order_id/.test(sql)) return { rows: over.item === null ? [] : [over.item ?? item] }
      if (/SUM\(total_price\)/.test(sql)) return { rows: [{ subtotal: 472, taxable: 400, cgst: 36, sgst: 36, igst: 0, tax: 72 }] }
      if (/discount_amount, business_discount_amount, shipping_amount FROM orders/.test(sql)) return { rows: [{ discount_amount: 0, business_discount_amount: 0, shipping_amount: 0 }] }
      return { rows: [] }
    })
  }

  it('not found / already applied / inactive', async () => {
    script({ vcr: null })
    expect(await applyVariantChange('vc1')).toEqual({ applied: false, reason: 'not_found' })
    script({ vcr: { ...vcr, status: 'applied' } })
    expect(await applyVariantChange('vc1')).toEqual({ applied: false, reason: 'already_applied' })
    script({ vcr: { ...vcr, status: 'cancelled' } })
    expect(await applyVariantChange('vc1')).toEqual({ applied: false, reason: 'not_active' })
  })
  it('order not found / not eligible / item missing / variant gone', async () => {
    script({ order: null })
    expect(await applyVariantChange('vc1')).toEqual({ applied: false, reason: 'order_not_found' })
    script({ order: { ...order, status: 'processing' } })
    expect(await applyVariantChange('vc1')).toEqual({ applied: false, reason: 'order_not_eligible' })
    script({ item: null })
    expect(await applyVariantChange('vc1')).toEqual({ applied: false, reason: 'item_not_found' })
    script({ newV: null })
    expect(await applyVariantChange('vc1')).toEqual({ applied: false, reason: 'new_variant_unavailable' })
  })
  it('applies: swaps the item, re-sums totals, logs activity', async () => {
    script()
    const r = await applyVariantChange('vc1', 'adm')
    expect(r).toEqual({ applied: true })
    // order_items swap UPDATE used unit_price 236 (inclusive) and itemTotal 472
    const upd = mockClient.query.mock.calls.find(c => /UPDATE order_items SET\s+variant_id/.test(c[0]))!
    expect(upd[1][5]).toBe(236) // unit_price
    expect(upd[1][6]).toBe(472) // total_price
    // orders totals UPDATE: subtotal 472, total = 472 - 0 - 0 + 0
    const ou = mockClient.query.mock.calls.find(c => /UPDATE orders SET\s+subtotal/.test(c[0]))!
    expect(ou[1][0]).toBe(472)
    expect(ou[1][6]).toBe(472)
    expect(mockClient.query.mock.calls.some(c => /SET status = 'applied'/.test(c[0]))).toBe(true)
    expect(vi.mocked(logActivity)).toHaveBeenCalled()
  })
  it("'none' settlement keeps the quoted new_unit_price", async () => {
    script({ vcr: { ...vcr, settlement_type: 'none', new_unit_price: 150 } })
    await applyVariantChange('vc1')
    const upd = mockClient.query.mock.calls.find(c => /UPDATE order_items SET\s+variant_id/.test(c[0]))!
    expect(upd[1][5]).toBe(150)
  })
  it('GST off zeroes order tax columns', async () => {
    vi.mocked(getFeatureFlags).mockResolvedValueOnce({ gstEnabled: false } as any)
    script()
    await applyVariantChange('vc1')
    const ou = mockClient.query.mock.calls.find(c => /UPDATE orders SET\s+subtotal/.test(c[0]))!
    expect(ou[1][1]).toBe(0) // taxable
    expect(ou[1][5]).toBe(0) // tax
  })
  it('sub-variant swap builds the full product name with the parent variant', async () => {
    const subRow = { id: 'sv2', name: 'Large', sku: 'SKU-L', product_name: 'Shirt', parent_variant_name: 'Blue', price: 236, price_ex_gst: 200, mrp: 300, gst_percentage: 18 }
    script({ vcr: { ...vcr, new_variant_id: null, new_sub_variant_id: 'sv2' }, newV: subRow })
    await applyVariantChange('vc1')
    const upd = mockClient.query.mock.calls.find(c => /UPDATE order_items SET\s+variant_id/.test(c[0]))!
    expect(upd[1][4]).toBe('Shirt - Blue - Large') // product_name (index 4)
  })
})

describe('settleVariantChangePayment', () => {
  const vcr = { id: 'vc1', order_id: 'o1', order_number: 'ORD-1', status: 'awaiting_payment' }

  it('no request found', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce(null)
    expect(await settleVariantChangePayment({ razorpayOrderId: 'ro', razorpayPaymentId: 'pay', amountPaise: 23600 })).toEqual({ applied: false, reason: 'no_request' })
  })
  it('already applied', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce({ ...vcr, status: 'applied' })
    expect(await settleVariantChangePayment({ razorpayOrderId: 'ro', razorpayPaymentId: 'pay', amountPaise: 23600 })).toEqual({ applied: false, reason: 'already_applied' })
  })
  it('records the payment, calls gw.book, then applies (apply returns order_not_found here)', async () => {
    const book = vi.fn(async () => {})
    vi.mocked(queryOne)
      .mockResolvedValueOnce(vcr as any)            // find vcr by razorpay_order_id
      .mockResolvedValueOnce({ id: 'pay-row' })     // INSERT payments RETURNING id
      .mockResolvedValueOnce({ id: 'vc1' })         // UPDATE vcr razorpay_payment_id
    // applyVariantChange runs withTransaction → our mockClient; make the vcr lookup empty so it short-circuits
    mockClient.query.mockResolvedValue({ rows: [] })
    const r = await settleVariantChangePayment({ razorpayOrderId: 'ro', razorpayPaymentId: 'pay', amountPaise: 23600, gw: { gateway: 'upi_phonepe', method: 'upi', book } })
    expect(book).toHaveBeenCalledWith(expect.objectContaining({ paymentId: 'pay', grossInr: 236, orderId: 'o1' }))
    expect(r).toEqual({ applied: false, reason: 'not_found' })
    // payment insert carried the gw gateway/method
    const insCall = vi.mocked(queryOne).mock.calls.find(c => /INSERT INTO payments/.test(c[0] as string))!
    expect(insCall[1]).toEqual(expect.arrayContaining(['upi', 'upi_phonepe']))
  })
})
