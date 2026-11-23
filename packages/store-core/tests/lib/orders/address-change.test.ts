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
vi.mock('@/lib/shipping/edd', () => ({
  transitDays: vi.fn((pin: string) => (pin === '110001' ? 5 : 2)),
  eddSettingsFromValues: vi.fn(() => ({})),
}))

import {
  snapshotAddress,
  sameAddress,
  addressChangeBlockReason,
  hasPendingAddressChange,
  listAddressChangeRequests,
  resplitTax,
  applyAddressChange,
  ADDRESS_SNAPSHOT_COLUMNS,
} from '@/lib/orders/address-change'
import { queryOne, queryMany } from '@/lib/shared/db'
import { getFeatureFlags } from '@/lib/catalog/site-controls'

beforeEach(() => {
  vi.clearAllMocks()
  mockClient.query.mockReset()
})

const addr = {
  full_name: 'A', phone: '9', address_line1: 'L1', address_line2: 'L2', landmark: 'LM',
  city: 'Chennai', state: 'Tamil Nadu', postal_code: '600001', country: 'IN',
}

describe('snapshotAddress / ADDRESS_SNAPSHOT_COLUMNS', () => {
  it('picks exactly the snapshot fields, nulls missing', () => {
    const s = snapshotAddress({ ...addr, extra: 'ignored' })
    expect(s).toEqual(addr)
    expect(snapshotAddress({}).full_name).toBeNull()
    expect(ADDRESS_SNAPSHOT_COLUMNS).toContain('postal_code')
  })
})

describe('sameAddress', () => {
  it('false when either side missing', () => {
    expect(sameAddress(null, addr)).toBe(false)
    expect(sameAddress(addr, undefined)).toBe(false)
  })
  it('case/space-insensitive compare of all fields', () => {
    expect(sameAddress(addr, { ...addr, city: '  CHENNAI ' })).toBe(true)
    expect(sameAddress(addr, { ...addr, city: 'Mumbai' })).toBe(false)
  })
})

describe('addressChangeBlockReason', () => {
  it('blocks on non-confirmed, awb, active irn, eway bill', () => {
    expect(addressChangeBlockReason({ status: 'processing' })).toMatch(/only be changed/)
    expect(addressChangeBlockReason({ status: 'confirmed', awb_number: 'AWB1' })).toMatch(/shipment/)
    expect(addressChangeBlockReason({ status: 'confirmed', irn: 'IRN', irn_status: 'active' })).toMatch(/e-invoice/)
    expect(addressChangeBlockReason({ status: 'confirmed', eway_bill_no: 'EWB' })).toMatch(/e-way bill/)
  })
  it('null when eligible (cancelled irn does not block)', () => {
    expect(addressChangeBlockReason({ status: 'confirmed', irn: 'IRN', irn_status: 'cancelled' })).toBeNull()
  })
})

describe('hasPendingAddressChange / listAddressChangeRequests', () => {
  it('true when a pending row exists, false on DB error', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce({ id: 'r1' })
    expect(await hasPendingAddressChange('o1')).toBe(true)
    vi.mocked(queryOne).mockRejectedValueOnce(new Error('no table'))
    expect(await hasPendingAddressChange('o1')).toBe(false)
  })
  it('returns rows, empty array on error', async () => {
    vi.mocked(queryMany).mockResolvedValueOnce([{ id: 'r1' } as any])
    expect(await listAddressChangeRequests('o1')).toHaveLength(1)
    vi.mocked(queryMany).mockRejectedValueOnce(new Error('no table'))
    expect(await listAddressChangeRequests('o1')).toEqual([])
  })
})

describe('resplitTax', () => {
  it('IGST → all into igst', () => {
    expect(resplitTax(36, true)).toEqual({ cgst: 0, sgst: 0, igst: 36 })
  })
  it('intra-state → half/half, remainder to sgst', () => {
    expect(resplitTax(36.01, false)).toEqual({ cgst: 18, sgst: 18.01, igst: 0 })
  })
})

describe('applyAddressChange', () => {
  const req = { id: 'r1', status: 'pending', new_address_id: 'a2', new_address_snapshot: addr, old_address_snapshot: { ...addr, postal_code: '600001' } }
  const order = { id: 'o1', order_number: 'ORD-1', user_id: 'u1', status: 'confirmed', awb_number: null, irn: null, irn_status: null, eway_bill_no: null, is_igst: false, cgst_amount: 18, sgst_amount: 18, igst_amount: 0 }

  function script(over: { req?: any; order?: any; live?: any } = {}) {
    mockClient.query.mockImplementation(async (sql: string) => {
      if (/FROM address_change_requests WHERE id = \$1 AND order_id/.test(sql)) return { rows: over.req === null ? [] : [over.req ?? req] }
      if (/FROM orders WHERE id = \$1 FOR UPDATE/.test(sql)) return { rows: over.order === null ? [] : [over.order ?? order] }
      if (/FROM addresses WHERE id/.test(sql)) return { rows: over.live === null ? [] : [over.live ?? addr] }
      if (/FROM order_items WHERE order_id/.test(sql)) return { rows: [] }
      return { rows: [] }
    })
  }

  it('request not found / not pending', async () => {
    script({ req: null })
    expect(await applyAddressChange({ requestId: 'r1', orderId: 'o1', adminId: 'adm' })).toMatchObject({ applied: false, reason: 'not_found' })
    script({ req: { ...req, status: 'approved' } })
    expect(await applyAddressChange({ requestId: 'r1', orderId: 'o1', adminId: 'adm' })).toMatchObject({ applied: false, reason: 'not_pending' })
  })
  it('order not found / not eligible', async () => {
    script({ order: null })
    expect(await applyAddressChange({ requestId: 'r1', orderId: 'o1', adminId: 'adm' })).toMatchObject({ applied: false, reason: 'order_not_found' })
    script({ order: { ...order, awb_number: 'AWB' } })
    expect(await applyAddressChange({ requestId: 'r1', orderId: 'o1', adminId: 'adm' })).toMatchObject({ applied: false, reason: 'order_not_eligible' })
  })
  it('live address no longer matches the request', async () => {
    script({ live: { ...addr, city: 'Mumbai' } })
    expect(await applyAddressChange({ requestId: 'r1', orderId: 'o1', adminId: 'adm' })).toMatchObject({ applied: false, reason: 'address_changed' })
  })
  it('applies, shifts EDD, no GST split change when state unchanged', async () => {
    script()
    const r = await applyAddressChange({ requestId: 'r1', orderId: 'o1', adminId: 'adm' })
    expect(r).toMatchObject({ applied: true, orderNumber: 'ORD-1', userId: 'u1', gstSplitChanged: false })
    // orders UPDATE ran with eddShift = transit(600001)=2 - transit(600001)=2 = 0
    const upd = mockClient.query.mock.calls.find(c => /UPDATE orders SET\s+shipping_address_id/.test(c[0]))!
    expect(upd[1][2]).toBe(0)
    // invoice pdf cache cleared + request approved
    expect(mockClient.query.mock.calls.some(c => /UPDATE invoices SET pdf_url = NULL/.test(c[0]))).toBe(true)
    expect(mockClient.query.mock.calls.some(c => /SET status = 'approved'/.test(c[0]))).toBe(true)
  })
  it('re-splits tax when the IGST status flips', async () => {
    // New delivery state Delhi (code 07) vs seller 33 → interstate → igst true, flips from false
    script({ live: { ...addr, state: 'Delhi', postal_code: '110001' }, req: { ...req, new_address_snapshot: { ...addr, state: 'Delhi', postal_code: '110001' } } })
    const r = await applyAddressChange({ requestId: 'r1', orderId: 'o1', adminId: 'adm' })
    expect(r).toMatchObject({ applied: true, gstSplitChanged: true })
    // order-level resplit UPDATE with is_igst = true
    const upd = mockClient.query.mock.calls.find(c => /UPDATE orders SET is_igst/.test(c[0]))!
    expect(upd[1][0]).toBe(true)
  })
  it('skips GST resplit when the flag is off', async () => {
    vi.mocked(getFeatureFlags).mockResolvedValueOnce({ gstEnabled: false } as any)
    script({ live: { ...addr, state: 'Delhi', postal_code: '110001' }, req: { ...req, new_address_snapshot: { ...addr, state: 'Delhi', postal_code: '110001' } } })
    const r = await applyAddressChange({ requestId: 'r1', orderId: 'o1', adminId: 'adm' })
    expect(r).toMatchObject({ applied: true, gstSplitChanged: false })
  })
})
