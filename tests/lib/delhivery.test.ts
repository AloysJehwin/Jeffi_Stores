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

global.fetch = mockFetch

import { cancelDelhiveryShipment, createRVPShipment } from '@/lib/delhivery'

describe('cancelDelhiveryShipment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.DELHIVERY_API_KEY = 'test-delhivery-key'
    mockQuery.mockResolvedValue({ rows: [] })
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
