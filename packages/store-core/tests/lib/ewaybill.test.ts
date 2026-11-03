import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

global.fetch = vi.fn()

import { generateEWayBill, isEWayBillConfigured, __resetTokenCacheForTests } from '@/lib/shipping/ewaybill'
import type { EWayBillPayload } from '@/lib/shipping/ewaybill'

const MOCK_PAYLOAD: EWayBillPayload = {
  supplyType: 'O',
  subSupplyType: '1',
  docType: 'INV',
  docNo: 'INV-2024-001',
  docDate: '01/01/2024',
  fromGstin: '22AAAAA0000A1Z5',
  fromTrdName: 'Seller Corp',
  fromAddr1: '123 Seller St',
  fromPlace: 'Raipur',
  fromPincode: 492001,
  fromStateCode: 22,
  toGstin: '22BBBBB0000B1Z5',
  toTrdName: 'Buyer Corp',
  toAddr1: '456 Buyer St',
  toPlace: 'Mumbai',
  toPincode: 400001,
  toStateCode: 27,
  totalValue: 1000,
  cgstValue: 90,
  sgstValue: 90,
  igstValue: 0,
  cessValue: 0,
  transMode: '1',
  transDistance: 500,
  vehicleNo: 'CG04AB1234',
  vehicleType: 'R',
  items: [
    {
      productName: 'Bolt M8',
      productDesc: 'Hex bolt',
      hsnCode: '7318',
      quantity: 100,
      qtyUnit: 'NOS',
      taxableAmount: 1000,
      sgstRate: 9,
      cgstRate: 9,
      igstRate: 0,
      cessRate: 0,
    },
  ],
}

function setEnvVars() {
  process.env.EWAYBILL_CLIENT_ID = 'ewb-client'
  process.env.EWAYBILL_CLIENT_SECRET = 'ewb-secret'
  process.env.EWAYBILL_USERNAME = 'ewb-user'
  process.env.EWAYBILL_PASSWORD = 'ewb-pass'
  process.env.EWAYBILL_GSTIN = '22AAAAA0000A1Z5'
}

function clearEnvVars() {
  delete process.env.EWAYBILL_CLIENT_ID
  delete process.env.EWAYBILL_CLIENT_SECRET
  delete process.env.EWAYBILL_USERNAME
  delete process.env.EWAYBILL_PASSWORD
  delete process.env.EWAYBILL_GSTIN
}

describe('isEWayBillConfigured', () => {
  afterEach(() => clearEnvVars())

  it('returns false when env vars are absent', () => {
    clearEnvVars()
    expect(isEWayBillConfigured()).toBe(false)
  })

  it('returns true when all env vars are set', () => {
    setEnvVars()
    expect(isEWayBillConfigured()).toBe(true)
  })
})

describe('generateEWayBill', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    __resetTokenCacheForTests()
  })

  afterEach(() => clearEnvVars())

  it('returns a stub when not configured', async () => {
    clearEnvVars()
    const result = await generateEWayBill(MOCK_PAYLOAD)
    expect(result.status).toBe('stub')
    expect(result.ewbNo).toContain('STUB-EWB-')
    expect(result.ewbDt).toBeTruthy()
    expect(result.ewbValidTill).toBeTruthy()
  })

  it('calls auth endpoint when configured', async () => {
    setEnvVars()
    const mockFetch = vi.mocked(global.fetch)
    // Auth
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ response: { authtoken: 'ewb-token' } }),
    } as Response)
    // Generate
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        response: {
          ewbNo: '12345678901234',
          ewbDt: '01/01/2024',
          ewbValidTill: '02/01/2024',
        },
      }),
    } as Response)

    const result = await generateEWayBill(MOCK_PAYLOAD)
    expect(result.ewbNo).toBe('12345678901234')
    expect(result.status).toBe('generated')
  })

  it('throws when auth fails', async () => {
    setEnvVars()
    const mockFetch = vi.mocked(global.fetch)
    mockFetch.mockResolvedValueOnce({
      ok: false,
      statusText: 'Unauthorized',
      json: async () => ({ message: 'Invalid creds' }),
    } as Response)

    await expect(generateEWayBill(MOCK_PAYLOAD)).rejects.toThrow('EWB auth failed')
  })

  it('throws when generate response has no ewbNo', async () => {
    setEnvVars()
    const mockFetch = vi.mocked(global.fetch)
    // Auth
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ response: { authtoken: 'tok' } }),
    } as Response)
    // Generate failure
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ message: 'validation error' }),
    } as Response)

    await expect(generateEWayBill(MOCK_PAYLOAD)).rejects.toThrow('E-way bill generation failed')
  })

  it('sends items in the request body', async () => {
    setEnvVars()
    const mockFetch = vi.mocked(global.fetch)
    // Auth
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ response: { authtoken: 'tok' } }),
    } as Response)
    // Generate
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        response: { ewbNo: '111', ewbDt: 'd', ewbValidTill: 'v' },
      }),
    } as Response)

    await generateEWayBill(MOCK_PAYLOAD)

    const generateCall = mockFetch.mock.calls[1]
    const body = JSON.parse(generateCall[1]!.body as string)
    expect(body.data.itemList).toHaveLength(1)
    expect(body.data.itemList[0].hsnCode).toBe('7318')
  })

  it('sets optional transporter fields to empty string when not provided', async () => {
    setEnvVars()
    const mockFetch = vi.mocked(global.fetch)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ response: { authtoken: 'tok' } }),
    } as Response)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ response: { ewbNo: '111', ewbDt: 'd', ewbValidTill: 'v' } }),
    } as Response)

    const payload = { ...MOCK_PAYLOAD }
    delete payload.transporterName
    delete payload.transporterId
    delete payload.vehicleNo
    delete payload.vehicleType

    await generateEWayBill(payload)

    const body = JSON.parse(mockFetch.mock.calls[1][1]!.body as string)
    expect(body.data.transporterName).toBe('')
    expect(body.data.transporterId).toBe('')
    expect(body.data.vehicleNo).toBe('')
    expect(body.data.vehicleType).toBe('R')
  })
})
