import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks — declared before importing the module under test
// ---------------------------------------------------------------------------

vi.mock('@/lib/shared/db', () => ({
  queryOne: vi.fn(),
  withTransaction: vi.fn(),
}))

vi.mock('@/lib/catalog/site-controls', () => ({
  getFeatureFlags: vi.fn(),
}))

vi.mock('@/lib/shared/activity', () => ({
  logActivity: vi.fn().mockResolvedValue(undefined),
}))

// gst + pricing are pure → use the real implementations.

import {
  computeVariantChangePreview,
  loadVariantPriceRow,
  applyVariantChange,
  settleVariantChangePayment,
  type VariantPriceRow,
} from '@/lib/orders/variant-change'
import { queryOne, withTransaction } from '@/lib/shared/db'
import { getFeatureFlags } from '@/lib/catalog/site-controls'
import { logActivity } from '@/lib/shared/activity'

const mockQueryOne = vi.mocked(queryOne)
const mockWithTransaction = vi.mocked(withTransaction)
const mockGetFeatureFlags = vi.mocked(getFeatureFlags)
const mockLogActivity = vi.mocked(logActivity)

function makeVariant(overrides: Partial<VariantPriceRow> = {}): VariantPriceRow {
  return {
    id: 'v-1',
    name: 'Large',
    sku: 'SKU-L',
    product_name: 'Widget',
    parent_variant_name: null,
    price: 120,
    price_ex_gst: 100,
    mrp: 150,
    gst_percentage: '18',
    ...overrides,
  }
}

/**
 * Build a fake pg client whose `query` returns queued results in FIFO order.
 * Each queued item is the `.rows` array for that call.
 */
function makeClient(rowsQueue: any[][]) {
  const query = vi.fn().mockImplementation(() => {
    const rows = rowsQueue.shift() ?? []
    return Promise.resolve({ rows })
  })
  return { query }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetFeatureFlags.mockResolvedValue({ gstEnabled: true } as any)
  // withTransaction just invokes the callback with our fake client (set per-test)
})

// ---------------------------------------------------------------------------
// computeVariantChangePreview
// ---------------------------------------------------------------------------

describe('computeVariantChangePreview', () => {
  it('returns collect when new price is higher (GST on uses inclusive)', () => {
    const r = computeVariantChangePreview({
      oldUnitPrice: 100,
      qty: 2,
      newV: makeVariant({ price: 120, price_ex_gst: 100 }),
      gstEnabled: true,
    })
    expect(r.newUnitPrice).toBe(120)
    expect(r.priceDiff).toBe(40) // (120-100)*2
    expect(r.settlementType).toBe('collect')
    expect(r.oldUnitPrice).toBe(100)
    expect(r.codSettlement).toBe('cod_adjust')
  })

  it('returns refund when new price is lower (GST off uses ex-GST)', () => {
    const r = computeVariantChangePreview({
      oldUnitPrice: 100,
      qty: 1,
      newV: makeVariant({ price: 120, price_ex_gst: 80 }),
      gstEnabled: false,
    })
    expect(r.newUnitPrice).toBe(80) // ex-GST when flag off
    expect(r.priceDiff).toBe(-20)
    expect(r.settlementType).toBe('refund')
  })

  it('returns none when prices are equal', () => {
    const r = computeVariantChangePreview({
      oldUnitPrice: 120,
      qty: 3,
      newV: makeVariant({ price: 120 }),
      gstEnabled: true,
    })
    expect(r.priceDiff).toBe(0)
    expect(r.settlementType).toBe('none')
  })
})

// ---------------------------------------------------------------------------
// loadVariantPriceRow
// ---------------------------------------------------------------------------

describe('loadVariantPriceRow', () => {
  it('loads sub-variant when subVariantId provided', async () => {
    const row = makeVariant({ id: 'sv-1' })
    mockQueryOne.mockResolvedValue(row as any)
    const res = await loadVariantPriceRow('v-1', 'sv-1', 'prod-1')
    expect(res).toBe(row)
    const sql = mockQueryOne.mock.calls[0][0] as string
    expect(sql).toContain('product_sub_variants')
    expect(mockQueryOne.mock.calls[0][1]).toEqual(['sv-1', 'prod-1'])
  })

  it('loads variant when only variantId provided', async () => {
    const row = makeVariant()
    mockQueryOne.mockResolvedValue(row as any)
    const res = await loadVariantPriceRow('v-1', null, 'prod-1')
    expect(res).toBe(row)
    const sql = mockQueryOne.mock.calls[0][0] as string
    expect(sql).toContain('product_variants')
    expect(mockQueryOne.mock.calls[0][1]).toEqual(['v-1', 'prod-1'])
  })

  it('returns null when neither id provided', async () => {
    const res = await loadVariantPriceRow(null, null, 'prod-1')
    expect(res).toBeNull()
    expect(mockQueryOne).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// applyVariantChange
// ---------------------------------------------------------------------------

describe('applyVariantChange', () => {
  // wire withTransaction to invoke callback with a client built from the queue
  function runWith(rowsQueue: any[][]) {
    const client = makeClient(rowsQueue)
    mockWithTransaction.mockImplementation(async (cb: any) => cb(client))
    return client
  }

  const VCR = {
    id: 'vcr-1',
    order_id: 'order-1',
    order_item_id: 'item-1',
    new_variant_id: 'v-2',
    new_sub_variant_id: null,
    settlement_type: 'collect',
    price_diff: 40,
    status: 'pending_customer',
  }
  const ORDER = {
    id: 'order-1',
    order_number: 'ORD-1',
    user_id: 'user-1',
    status: 'confirmed',
    payment_status: 'paid',
    payment_mode: 'razorpay',
    awb_number: null,
    is_igst: false,
  }
  const ITEM = { id: 'item-1', product_id: 'prod-1', quantity: '2', gst_rate: '18' }

  it('applies successfully with GST on and logs activity', async () => {
    runWith([
      [VCR], // SELECT vcr FOR UPDATE
      [ORDER], // SELECT order FOR UPDATE
      [ITEM], // SELECT order_item
      [], // UPDATE order_items
      [{ subtotal: '240', taxable: '203.4', cgst: '18.3', sgst: '18.3', igst: '0', tax: '36.6' }], // sum
      [{ discount_amount: '0', business_discount_amount: '0', shipping_amount: '10' }], // current order
      [], // UPDATE orders
      [], // UPDATE vcr applied
    ])
    // loadVariantPriceRow uses queryOne (variant branch)
    mockQueryOne.mockResolvedValue(makeVariant({ id: 'v-2', price: 120, gst_percentage: '18' }) as any)

    const res = await applyVariantChange('vcr-1', 'admin-9')
    expect(res).toEqual({ applied: true })
    expect(mockLogActivity).toHaveBeenCalledTimes(1)
    expect(mockLogActivity.mock.calls[0][0]).toMatchObject({ actorId: 'admin-9', kind: 'variant_change' })
  })

  it('applies with GST off (zeros tax) and sub-variant, no user_id skips log', async () => {
    const vcrSub = { ...VCR, new_variant_id: null, new_sub_variant_id: 'sv-9' }
    const orderNoUser = { ...ORDER, user_id: null }
    mockGetFeatureFlags.mockResolvedValue({ gstEnabled: false } as any)
    runWith([
      [vcrSub],
      [orderNoUser],
      [ITEM],
      [],
      [{ subtotal: '160', taxable: '0', cgst: '0', sgst: '0', igst: '0', tax: '0' }],
      [{ discount_amount: null, business_discount_amount: null, shipping_amount: null }],
      [],
      [],
    ])
    mockQueryOne.mockResolvedValue(
      makeVariant({ id: 'sv-9', parent_variant_name: 'Colour', name: 'Red', price_ex_gst: 80 }) as any
    )

    const res = await applyVariantChange('vcr-1')
    expect(res).toEqual({ applied: true })
    expect(mockLogActivity).not.toHaveBeenCalled()
  })

  it('returns not_found when vcr missing', async () => {
    runWith([[]])
    const res = await applyVariantChange('missing')
    expect(res).toEqual({ applied: false, reason: 'not_found' })
  })

  it('returns already_applied when vcr already applied (idempotent)', async () => {
    runWith([[{ ...VCR, status: 'applied' }]])
    const res = await applyVariantChange('vcr-1')
    expect(res).toEqual({ applied: false, reason: 'already_applied' })
  })

  it('returns not_active when rejected or cancelled', async () => {
    runWith([[{ ...VCR, status: 'rejected' }]])
    expect(await applyVariantChange('vcr-1')).toEqual({ applied: false, reason: 'not_active' })
    runWith([[{ ...VCR, status: 'cancelled' }]])
    expect(await applyVariantChange('vcr-1')).toEqual({ applied: false, reason: 'not_active' })
  })

  it('returns order_not_found when order missing', async () => {
    runWith([[VCR], []])
    expect(await applyVariantChange('vcr-1')).toEqual({ applied: false, reason: 'order_not_found' })
  })

  it('returns order_not_eligible when not confirmed', async () => {
    runWith([[VCR], [{ ...ORDER, status: 'processing' }]])
    expect(await applyVariantChange('vcr-1')).toEqual({ applied: false, reason: 'order_not_eligible' })
  })

  it('returns order_not_eligible when awb present', async () => {
    runWith([[VCR], [{ ...ORDER, awb_number: 'AWB123' }]])
    expect(await applyVariantChange('vcr-1')).toEqual({ applied: false, reason: 'order_not_eligible' })
  })

  it('returns item_not_found when item missing', async () => {
    runWith([[VCR], [ORDER], []])
    expect(await applyVariantChange('vcr-1')).toEqual({ applied: false, reason: 'item_not_found' })
  })

  it('returns new_variant_unavailable when target variant not loadable', async () => {
    runWith([[VCR], [ORDER], [ITEM]])
    mockQueryOne.mockResolvedValue(null as any)
    expect(await applyVariantChange('vcr-1')).toEqual({ applied: false, reason: 'new_variant_unavailable' })
  })

  it('falls back to item.gst_rate and qty=1 when quantity invalid; igst path', async () => {
    const igstOrder = { ...ORDER, is_igst: true }
    runWith([
      [VCR],
      [igstOrder],
      [{ id: 'item-1', product_id: 'prod-1', quantity: 'x', gst_rate: '12' }], // NaN qty → 1
      [],
      [{ subtotal: '120', taxable: '107.14', cgst: '0', sgst: '0', igst: '12.86', tax: '12.86' }],
      [{ discount_amount: '5', business_discount_amount: '5', shipping_amount: '0' }],
      [],
      [],
    ])
    // variant without gst_percentage → uses item.gst_rate
    mockQueryOne.mockResolvedValue(makeVariant({ id: 'v-2', gst_percentage: null }) as any)
    const res = await applyVariantChange('vcr-1', null)
    expect(res).toEqual({ applied: true })
  })
})

// ---------------------------------------------------------------------------
// settleVariantChangePayment
// ---------------------------------------------------------------------------

describe('settleVariantChangePayment', () => {
  const params = { razorpayOrderId: 'rzp_1', razorpayPaymentId: 'pay_1', amountPaise: 4000 }

  it('returns no_request when vcr not found', async () => {
    mockQueryOne.mockResolvedValueOnce(null as any)
    const res = await settleVariantChangePayment(params)
    expect(res).toEqual({ applied: false, reason: 'no_request' })
  })

  it('returns already_applied when vcr already applied', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'vcr-1', status: 'applied' } as any)
    const res = await settleVariantChangePayment(params)
    expect(res).toEqual({ applied: false, reason: 'already_applied' })
  })

  it('records payment then applies the change', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ id: 'vcr-1', order_id: 'order-1', status: 'awaiting_payment' } as any) // find vcr
      .mockResolvedValueOnce({ id: 'pay-x' } as any) // INSERT payment
      .mockResolvedValueOnce({ id: 'vcr-1' } as any) // UPDATE vcr payment id

    // applyVariantChange path → withTransaction returns applied:true quickly via not_found short-circuit is undesirable;
    // stub the whole transaction to return a known result.
    mockWithTransaction.mockResolvedValue({ applied: true } as any)

    const res = await settleVariantChangePayment(params)
    expect(res).toEqual({ applied: true })
    // payment insert uses amount in rupees
    const insertCall = mockQueryOne.mock.calls[1]
    expect(insertCall[1]).toContain('40.00')
  })
})
