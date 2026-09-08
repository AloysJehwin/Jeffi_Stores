import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks — vi.hoisted() ensures variables exist before vi.mock() factories run
// ---------------------------------------------------------------------------
const { mockQuery, mockFetch } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockFetch: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  query: mockQuery,
  queryOne: vi.fn(),
  queryMany: vi.fn(),
  withTransaction: vi.fn(),
}))

const mockGetBusinessValues = vi.hoisted(() => vi.fn())
vi.mock('@/lib/site-controls', () => ({
  getBusinessValues: mockGetBusinessValues,
  invalidateSiteControlsCache: vi.fn(),
}))

global.fetch = mockFetch

import { cancelDelhiveryShipment, createRVPShipment, listDelhiveryPickupLocations, setDefaultPickupLocation, deactivateDelhiveryPickupLocation } from '@/lib/delhivery'

describe('cancelDelhiveryShipment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.DELHIVERY_API_KEY = 'test-delhivery-key'
    mockQuery.mockResolvedValue({ rows: [] })
    mockGetBusinessValues.mockResolvedValue({
      pickupLocation: 'Jeffi Stores', delhiveryOriginPincode: '492001',
      sellerName: 'Jeffi Stores', sellerAddress: 'Raipur', sellerPhone: '9685354099',
    })
  })

  it('throws when DELHIVERY_API_KEY is not set', async () => {
    delete process.env.DELHIVERY_API_KEY
    await expect(cancelDelhiveryShipment('AWB123')).rejects.toThrow('DELHIVERY_API_KEY not configured')
  })

  it('throws when the API response is not ok', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ message: 'bad awb' }),
    })
    await expect(cancelDelhiveryShipment('AWB-BAD')).rejects.toThrow('Delhivery cancellation failed')
  })

  it('calls the Delhivery edit URL with cancellation payload', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({}),
    })

    await cancelDelhiveryShipment('AWB-001')

    expect(mockFetch).toHaveBeenCalledOnce()
    const [url, opts] = mockFetch.mock.calls[0]
    expect(url).toContain('track.delhivery.com')
    const body = JSON.parse(opts.body)
    expect(body.waybill).toBe('AWB-001')
    expect(body.cancellation).toBe('true')
  })

  it('updates the order record to clear awb_number after success', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) })

    await cancelDelhiveryShipment('AWB-001')

    expect(mockQuery).toHaveBeenCalledOnce()
    const [sql, params] = mockQuery.mock.calls[0]
    expect(sql).toContain('awb_number = NULL')
    expect(params[0]).toBe('AWB-001')
  })

  it('handles fetch json parse failure gracefully', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => { throw new Error('bad json') },
    })
    await expect(cancelDelhiveryShipment('AWB-BAD')).rejects.toThrow('Delhivery cancellation failed')
  })
})

// ---------------------------------------------------------------------------
// createRVPShipment
// ---------------------------------------------------------------------------

const BASE_RVP_PARAMS = {
  consigneeName: 'Test Customer',
  address: '123 Test Street',
  pin: '492001',
  city: 'Raipur',
  state: 'Chhattisgarh',
  phone: '9876543210',
  invoiceRef: 'INV-2024-001',
  totalAmount: '1000',
  orderDate: '2024-01-01',
  weightKg: 0.5,
  productDesc: 'Test product',
  quantity: 1,
}

describe('createRVPShipment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.DELHIVERY_API_KEY = 'test-delhivery-key'
    mockGetBusinessValues.mockResolvedValue({
      pickupLocation: 'Jeffi Stores', delhiveryOriginPincode: '492001',
      sellerName: 'Jeffi Stores', sellerAddress: 'Raipur', sellerPhone: '9685354099',
    })
  })

  it('throws when DELHIVERY_API_KEY is not set', async () => {
    delete process.env.DELHIVERY_API_KEY
    await expect(createRVPShipment(BASE_RVP_PARAMS)).rejects.toThrow('DELHIVERY_API_KEY not configured')
  })

  it('throws when response is not ok and no packages array', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      json: async () => ({ rmk: 'invalid pin' }),
    })
    await expect(createRVPShipment(BASE_RVP_PARAMS)).rejects.toThrow('invalid pin')
  })

  it('throws when packages array is empty', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ packages: [] }),
    })
    await expect(createRVPShipment(BASE_RVP_PARAMS)).rejects.toThrow('Delhivery RVP creation failed')
  })

  it('throws when package status is Fail', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        packages: [{ status: 'Fail', err_code: 'E001', remarks: ['Bad address'] }],
      }),
    })
    await expect(createRVPShipment(BASE_RVP_PARAMS)).rejects.toThrow('Bad address')
  })

  it('throws when no waybill is returned', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        packages: [{ status: 'Success', waybill: '' }],
      }),
    })
    await expect(createRVPShipment(BASE_RVP_PARAMS)).rejects.toThrow('No AWB returned')
  })

  it('returns waybill on success', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        packages: [{ status: 'Success', waybill: 'AWB-999' }],
      }),
    })
    const awb = await createRVPShipment(BASE_RVP_PARAMS)
    expect(awb).toBe('AWB-999')
  })

  it('normalises phone: strips 91 prefix from 12-digit number', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ packages: [{ status: 'Success', waybill: 'AWB-X' }] }),
    })

    await createRVPShipment({ ...BASE_RVP_PARAMS, phone: '919876543210' })

    const [, opts] = mockFetch.mock.calls[0]
    const formBody = new URLSearchParams(opts.body)
    const data = JSON.parse(formBody.get('data') as string)
    expect(data.shipments[0].phone).toBe('9876543210')
  })

  it('normalises phone: takes last 10 digits for other formats', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ packages: [{ status: 'Success', waybill: 'AWB-Y' }] }),
    })

    await createRVPShipment({ ...BASE_RVP_PARAMS, phone: '+91 98765 43210' })

    const [, opts] = mockFetch.mock.calls[0]
    const formBody = new URLSearchParams(opts.body)
    const data = JSON.parse(formBody.get('data') as string)
    expect(data.shipments[0].phone).toBe('9876543210')
  })

  it('sets order_type to reverse', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ packages: [{ status: 'Success', waybill: 'AWB-Z' }] }),
    })

    await createRVPShipment(BASE_RVP_PARAMS)

    const [, opts] = mockFetch.mock.calls[0]
    const formBody = new URLSearchParams(opts.body)
    const data = JSON.parse(formBody.get('data') as string)
    expect(data.shipments[0].order_type).toBe('reverse')
  })
})

describe('listDelhiveryPickupLocations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.DELHIVERY_API_KEY = 'test-delhivery-key'
    mockGetBusinessValues.mockResolvedValue({
      pickupLocation: 'Jeffi Stores',
      delhiveryOriginPincode: '492001',
      sellerPhone: '9685354099',
      sellerAddress: 'Raipur',
    })
    mockQuery.mockResolvedValue({ rows: [] })
  })

  it('reads from the DB (no Delhivery GET call) and returns stored rows', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // upsert (backfill default)
      .mockResolvedValueOnce({
        rows: [
          { name: 'Jeffi Stores', pin: '492001', phone: '9685354099', address: 'Raipur', active: true },
          { name: 'Bengaluru Home', pin: '', phone: '', address: '', active: true },
        ],
      })

    const locs = await listDelhiveryPickupLocations()

    expect(mockFetch).not.toHaveBeenCalled()
    expect(locs.map(l => l.name)).toEqual(['Jeffi Stores', 'Bengaluru Home'])
  })

  it('backfills the default warehouse into the table on read', async () => {
    await listDelhiveryPickupLocations()
    const upsert = mockQuery.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO delhivery_pickup_locations'))
    expect(upsert).toBeTruthy()
    expect(upsert![1]).toContain('Jeffi Stores')
  })

  it('falls back to the default-only list when the DB read fails', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // upsert
      .mockRejectedValueOnce(new Error('db down')) // select
    const locs = await listDelhiveryPickupLocations()
    expect(locs).toEqual([{ name: 'Jeffi Stores', pin: '', phone: '', address: '', active: true }])
  })

  it('returns [] when there is no default and the table is empty', async () => {
    mockGetBusinessValues.mockResolvedValue({ pickupLocation: '', delhiveryOriginPincode: '', sellerPhone: '', sellerAddress: '' })
    mockQuery.mockResolvedValue({ rows: [] })
    const locs = await listDelhiveryPickupLocations()
    expect(locs).toEqual([])
  })
})

describe('setDefaultPickupLocation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockQuery.mockResolvedValue({ rows: [] })
  })

  it('rejects an unknown warehouse', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })
    const r = await setDefaultPickupLocation('Nope')
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/not found/i)
  })

  it('rejects a warehouse with no valid pincode', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ name: 'Bengaluru Home', pin: '', phone: '999', address: 'x' }] })
    const r = await setDefaultPickupLocation('Bengaluru Home')
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/pincode/i)
  })

  it('copies the full identity into the delhivery_* settings', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ name: 'Bengaluru Home', pin: '560001', phone: '9000000000', address: 'MG Road' }],
    })
    const r = await setDefaultPickupLocation('Bengaluru Home')
    expect(r.ok).toBe(true)

    const upserts = mockQuery.mock.calls.filter(([sql]) => String(sql).includes('INSERT INTO site_settings'))
    const written = Object.fromEntries(upserts.map(([, params]) => [params[0], params[1]]))
    expect(written['delhivery_pickup_location']).toBe('Bengaluru Home')
    expect(written['delhivery_seller_name']).toBe('Bengaluru Home')
    expect(written['delhivery_seller_address']).toBe('MG Road')
    expect(written['delhivery_seller_phone']).toBe('9000000000')
    expect(written['delhivery_origin_pincode']).toBe('560001')
  })
})

describe('deactivateDelhiveryPickupLocation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.DELHIVERY_API_KEY = 'test-delhivery-key'
    mockQuery.mockResolvedValue({ rows: [] })
  })

  it('marks the DB row inactive on Delhivery success', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) })
    const r = await deactivateDelhiveryPickupLocation('Bengaluru Home')
    expect(r.ok).toBe(true)
    const update = mockQuery.mock.calls.find(([sql]) =>
      String(sql).includes('UPDATE delhivery_pickup_locations') && String(sql).includes('active = false'))
    expect(update).toBeTruthy()
    expect(update![1]).toContain('Bengaluru Home')
  })

  it('treats a missing Delhivery warehouse as already removed and still flips the row', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: 'warehouse does not exist' }) })
    const r = await deactivateDelhiveryPickupLocation('Ghost')
    expect(r.ok).toBe(true)
    const update = mockQuery.mock.calls.find(([sql]) => String(sql).includes('UPDATE delhivery_pickup_locations'))
    expect(update).toBeTruthy()
  })
})
