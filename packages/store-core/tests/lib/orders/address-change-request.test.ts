import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))
const db = vi.hoisted(() => ({ queryOne: vi.fn(), queryMany: vi.fn(), withTransaction: vi.fn() }))
vi.mock('@/lib/shared/db', () => db)
const ship = vi.hoisted(() => ({ checkPincodeServiceability: vi.fn(async () => ({ serviceable: true, cod: true })) }))
vi.mock('@/lib/shipping/delhivery', () => ship)
const act = vi.hoisted(() => ({ logActivity: vi.fn(async () => {}) }))
vi.mock('@/lib/shared/activity', () => act)
const notify = vi.hoisted(() => ({ createAdminNotification: vi.fn(async () => {}) }))
vi.mock('@/lib/shared/admin-notify', () => notify)
// address-change helpers are pure; needed deps are not invoked at import
vi.mock('@/lib/catalog/gst', () => ({ isInterState: vi.fn(), round2: (n: number) => n }))
vi.mock('@/lib/shipping/edd', () => ({ transitDays: vi.fn(() => 0), eddSettingsFromValues: vi.fn(() => ({})) }))
vi.mock('@/lib/catalog/site-controls', () => ({ getFeatureFlags: vi.fn(), getBusinessValues: vi.fn() }))

import { submitAddressChange, ORDER_ADDRESS_SELECT } from '@/lib/orders/address-change-request'
import { queryOne } from '@/lib/shared/db'
import { checkPincodeServiceability } from '@/lib/shipping/delhivery'
import { logActivity } from '@/lib/shared/activity'
import { createAdminNotification } from '@/lib/shared/admin-notify'

const addr = (over: Record<string, any> = {}) => ({
  id: 'addr-new',
  full_name: 'Cara',
  phone: '900',
  address_line1: 'L1',
  address_line2: null,
  landmark: null,
  city: 'Pune',
  state: 'MH',
  postal_code: '411001',
  country: 'IN',
  ...over,
})

const order = (over: Record<string, any> = {}) => ({
  id: 'o1',
  order_number: 'ORD-1',
  status: 'confirmed',
  awb_number: null,
  irn: null,
  irn_status: null,
  eway_bill_no: null,
  payment_mode: 'prepaid',
  payment_status: 'paid',
  shipping_address_id: 'addr-old',
  customer_name: 'Cara',
  current_address: { full_name: 'Cara', phone: '900', address_line1: 'OldL1', address_line2: null, landmark: null, city: 'Delhi', state: 'DL', postal_code: '110001', country: 'IN' },
  ...over,
})

beforeEach(() => {
  vi.mocked(checkPincodeServiceability).mockResolvedValue({ serviceable: true, cod: true } as any)
})

describe('ORDER_ADDRESS_SELECT', () => {
  it('selects the order with its resolved current address', () => {
    expect(ORDER_ADDRESS_SELECT).toContain('current_address')
    expect(ORDER_ADDRESS_SELECT).toContain('FROM orders o')
  })
})

describe('submitAddressChange guards', () => {
  it('400 when the order is not changeable (not confirmed)', async () => {
    const r = await submitAddressChange(order({ status: 'processing' }), 'addr-new', 'u1')
    expect(r).toEqual({ ok: false, status: 400, error: 'The delivery address can only be changed while the order is confirmed.' })
  })

  it('404 when the chosen address is not found for the user', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce(null) // address lookup
    const r = await submitAddressChange(order(), 'addr-new', 'u1')
    expect(r).toEqual({ ok: false, status: 404, error: 'Address not found' })
    const [sql, params] = vi.mocked(queryOne).mock.calls[0]
    expect(sql).toContain('FROM addresses WHERE id = $1 AND user_id = $2')
    expect(params).toEqual(['addr-new', 'u1'])
  })

  it('400 when the chosen address equals the current one', async () => {
    const same = { ...order().current_address }
    vi.mocked(queryOne).mockResolvedValueOnce(addr({ ...same, id: 'addr-new', postal_code: same.postal_code }))
    const r = await submitAddressChange(order(), 'addr-new', 'u1')
    expect(r).toEqual({ ok: false, status: 400, error: 'This is already the delivery address for this order.' })
  })

  it('422 when the new pincode is unserviceable', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce(addr())
    vi.mocked(checkPincodeServiceability).mockResolvedValueOnce({ serviceable: false, error: 'No reach' } as any)
    const r = await submitAddressChange(order(), 'addr-new', 'u1')
    expect(r).toEqual({ ok: false, status: 422, error: 'No reach', unserviceable: true })
    expect(checkPincodeServiceability).toHaveBeenCalledWith('411001')
  })

  it('422 when COD is unavailable for a COD order', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce(addr())
    vi.mocked(checkPincodeServiceability).mockResolvedValueOnce({ serviceable: true, cod: false } as any)
    const r = await submitAddressChange(order({ payment_mode: 'cod' }), 'addr-new', 'u1')
    expect(r).toEqual({ ok: false, status: 422, error: 'Cash on delivery is not available to this pincode.' })
  })

  it('skips the serviceability check when the pincode is unchanged', async () => {
    const curPin = order().current_address.postal_code
    vi.mocked(queryOne)
      .mockResolvedValueOnce(addr({ postal_code: curPin, city: 'Delhi', state: 'DL', address_line1: 'Different' }))
      .mockResolvedValueOnce({ id: 'req-1', created_at: '2026-01-01T00:00:00Z' })
    const r = await submitAddressChange(order(), 'addr-new', 'u1')
    expect(r.ok).toBe(true)
    expect(checkPincodeServiceability).not.toHaveBeenCalled()
  })
})

describe('submitAddressChange success', () => {
  it('inserts the request, logs activity, notifies admins', async () => {
    vi.mocked(queryOne)
      .mockResolvedValueOnce(addr()) // address lookup
      .mockResolvedValueOnce({ id: 'req-1', created_at: '2026-01-01T00:00:00Z' }) // insert
    const r = await submitAddressChange(order(), 'addr-new', 'u1')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.request.id).toBe('req-1')
      expect(r.request.status).toBe('pending')
      expect(r.request.newAddress.postal_code).toBe('411001')
      expect(r.request.createdAt).toBe('2026-01-01T00:00:00Z')
    }
    const [insSql, insParams] = vi.mocked(queryOne).mock.calls[1] as [string, any[]]
    expect(insSql).toContain('INSERT INTO address_change_requests')
    expect(insParams[0]).toBe('o1')
    expect(insParams[1]).toBe('u1')
    expect(insParams[3]).toBe('addr-new')
    expect(logActivity).toHaveBeenCalledWith(expect.objectContaining({ kind: 'address_change', referenceId: 'o1' }))
    expect(createAdminNotification).toHaveBeenCalledWith(expect.objectContaining({ type: 'address_change_requested', entityId: 'req-1' }))
  })

  it('409 on a unique-violation insert', async () => {
    vi.mocked(queryOne)
      .mockResolvedValueOnce(addr())
      .mockRejectedValueOnce({ code: '23505' })
    const r = await submitAddressChange(order(), 'addr-new', 'u1')
    expect(r).toEqual({ ok: false, status: 409, error: 'An address change request is already pending for this order.' })
  })

  it('rethrows a non-unique insert error', async () => {
    vi.mocked(queryOne)
      .mockResolvedValueOnce(addr())
      .mockRejectedValueOnce(new Error('db exploded'))
    await expect(submitAddressChange(order(), 'addr-new', 'u1')).rejects.toThrow('db exploded')
  })
})

describe('submitAddressChange edge branches', () => {
  it('treats payment_status starting with cod as a COD order', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce(addr())
    vi.mocked(checkPincodeServiceability).mockResolvedValueOnce({ serviceable: true, cod: false } as any)
    const r = await submitAddressChange(order({ payment_mode: 'prepaid', payment_status: 'cod_pending' }), 'addr-new', 'u1')
    expect(r).toEqual({ ok: false, status: 422, error: 'Cash on delivery is not available to this pincode.' })
  })

  it('handles a null current_address (null old snapshot, pincode check runs)', async () => {
    vi.mocked(queryOne)
      .mockResolvedValueOnce(addr())
      .mockResolvedValueOnce({ id: 'req-1', created_at: '2026-01-01T00:00:00Z' })
    const r = await submitAddressChange(order({ current_address: null }), 'addr-new', 'u1')
    expect(r.ok).toBe(true)
    // old_address_snapshot param (index 4) is null when there is no current address
    const insParams = vi.mocked(queryOne).mock.calls[1][1] as any[]
    expect(insParams[4]).toBeNull()
    expect(checkPincodeServiceability).toHaveBeenCalledWith('411001')
  })

  it('succeeds and swallows rejecting activity/notification side effects', async () => {
    vi.mocked(queryOne)
      .mockResolvedValueOnce(addr())
      .mockResolvedValueOnce({ id: 'req-9', created_at: '2026-02-02T00:00:00Z' })
    vi.mocked(logActivity).mockRejectedValueOnce(new Error('log down'))
    vi.mocked(createAdminNotification).mockRejectedValueOnce(new Error('notify down'))
    const r = await submitAddressChange(order({ customer_name: null }), 'addr-new', 'u1')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.request.id).toBe('req-9')
    // customer_name null -> 'Customer' fallback in the notification message
    expect(createAdminNotification).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('Customer') }))
  })
})
