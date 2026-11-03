import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

global.fetch = vi.fn()

import { generateIRN, cancelIRN, isEInvoiceConfigured, __resetTokenCacheForTests } from '@/lib/shipping/einvoice'
import type { EInvoicePayload } from '@/lib/shipping/einvoice'

const MOCK_PAYLOAD: EInvoicePayload = {
  invoiceNumber: 'INV-2024-001',
  invoiceDate: '01/01/2024',
  supplyType: 'B2B',
  sellerGstin: '22AAAAA0000A1Z5',
  sellerLegalName: 'Seller Corp',
  sellerAddress1: '123 Seller Street',
  sellerCity: 'Raipur',
  sellerStateCode: '22',
  sellerPincode: 492001,
  buyerGstin: '22BBBBB0000B1Z5',
  buyerLegalName: 'Buyer Corp',
  buyerAddress1: '456 Buyer Street',
  buyerCity: 'Mumbai',
  buyerStateCode: '27',
  buyerPincode: 400001,
  buyerPos: '27',
  items: [
    {
      slNo: '1',
      productDesc: 'Bolt M8',
      isService: 'N',
      hsnCode: '7318',
      qty: 100,
      unit: 'NOS',
      unitPrice: 10,
      totalAmount: 1000,
      assAmt: 1000,
      gstRate: 18,
      igstAmt: 0,
      cgstAmt: 90,
      sgstAmt: 90,
      totalItemVal: 1180,
    },
  ],
  assVal: 1000,
  cgstVal: 90,
  sgstVal: 90,
  igstVal: 0,
  totalInvVal: 1180,
}

function setEnvVars() {
  process.env.EINVOICE_CLIENT_ID = 'client-id'
  process.env.EINVOICE_CLIENT_SECRET = 'client-secret'
  process.env.EINVOICE_USERNAME = 'user'
  process.env.EINVOICE_PASSWORD = 'pass'
  process.env.EINVOICE_GSTIN = '22AAAAA0000A1Z5'
}

function clearEnvVars() {
  delete process.env.EINVOICE_CLIENT_ID
  delete process.env.EINVOICE_CLIENT_SECRET
  delete process.env.EINVOICE_USERNAME
  delete process.env.EINVOICE_PASSWORD
  delete process.env.EINVOICE_GSTIN
}

// Helper: mock a successful auth response followed by a generate/cancel response
function mockAuthThen(...responses: any[]) {
  const mockFetch = vi.mocked(global.fetch)
  // Always prepend a fresh auth call so the module fetches a new token
  // (force-expire by using a past time — we can't reset the module cache directly)
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ Data: { AuthToken: `token-${Date.now()}` } }),
  } as Response)
  for (const r of responses) {
    mockFetch.mockResolvedValueOnce(r as Response)
  }
}

describe('isEInvoiceConfigured', () => {
  afterEach(() => clearEnvVars())

  it('returns false when env vars are absent', () => {
    clearEnvVars()
    expect(isEInvoiceConfigured()).toBe(false)
  })

  it('returns true when all env vars are set', () => {
    setEnvVars()
    expect(isEInvoiceConfigured()).toBe(true)
  })

  it('returns false when only some env vars are set', () => {
    clearEnvVars()
    process.env.EINVOICE_CLIENT_ID = 'id'
    expect(isEInvoiceConfigured()).toBe(false)
  })
})

describe('generateIRN', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    __resetTokenCacheForTests()
  })

  afterEach(() => clearEnvVars())

  it('returns a stub result when not configured', async () => {
    clearEnvVars()
    const result = await generateIRN(MOCK_PAYLOAD)
    expect(result.status).toBe('stub')
    expect(result.irn).toContain('STUB-')
    expect(result.ackNo).toContain('STUB-ACK-')
  })

  it('stub irn contains the invoice number', async () => {
    clearEnvVars()
    const result = await generateIRN(MOCK_PAYLOAD)
    expect(result.irn).toContain('INV-2024-001')
  })

  it('calls auth endpoint when configured and returns generated IRN', async () => {
    setEnvVars()
    const mockFetch = vi.mocked(global.fetch)
    // Auth call
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        Data: { AuthToken: 'test-token' },
      }),
    } as Response)
    // IRN call
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        Data: {
          Irn: 'test-irn-123',
          AckNo: 'ack-001',
          AckDt: '01/01/2024',
          SignedQRCode: 'qr-code',
        },
      }),
    } as Response)

    const result = await generateIRN(MOCK_PAYLOAD)
    expect(result.irn).toBe('test-irn-123')
    expect(result.ackNo).toBe('ack-001')
    expect(result.status).toBe('generated')
  })

  it('throws when auth fails', async () => {
    setEnvVars()
    const mockFetch = vi.mocked(global.fetch)
    mockFetch.mockResolvedValueOnce({
      ok: false,
      statusText: 'Unauthorized',
      json: async () => ({ message: 'Invalid credentials' }),
    } as Response)

    await expect(generateIRN(MOCK_PAYLOAD)).rejects.toThrow('IRP auth failed')
  })

  it('throws when IRN generation response is not ok', async () => {
    setEnvVars()
    const mockFetch = vi.mocked(global.fetch)
    // Auth succeeds
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ Data: { AuthToken: 'tok' } }),
    } as Response)
    // IRN fails
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ message: 'duplicate invoice' }),
    } as Response)

    await expect(generateIRN(MOCK_PAYLOAD)).rejects.toThrow('IRN generation failed')
  })
})

describe('cancelIRN', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    __resetTokenCacheForTests()
  })

  afterEach(() => clearEnvVars())

  it('throws when not configured', async () => {
    clearEnvVars()
    await expect(cancelIRN('irn-001', 1, 'test')).rejects.toThrow('e-Invoice credentials not configured')
  })

  it('calls cancel endpoint with correct payload', async () => {
    setEnvVars()
    const mockFetch = vi.mocked(global.fetch)
    // Auth
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ Data: { AuthToken: 'tok' } }),
    } as Response)
    // Cancel succeeds
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    } as Response)

    await cancelIRN('irn-001', 1, 'Data entry error')

    const cancelCall = mockFetch.mock.calls[1]
    const body = JSON.parse(cancelCall[1]!.body as string)
    expect(body.Irn).toBe('irn-001')
    expect(body.CnlRsn).toBe(1)
    expect(body.CnlRem).toBe('Data entry error')
  })

  it('throws when cancel API fails', async () => {
    setEnvVars()
    const mockFetch = vi.mocked(global.fetch)
    // Auth
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ Data: { AuthToken: 'tok' } }),
    } as Response)
    // Cancel failure
    mockFetch.mockResolvedValueOnce({
      ok: false,
      statusText: 'Bad Request',
      json: async () => ({ message: 'IRN already cancelled' }),
    } as Response)

    await expect(cancelIRN('irn-001', 2, 'test')).rejects.toThrow('IRN cancellation failed')
  })
})

// ---------------------------------------------------------------------------
// Token cache — hit path
// ---------------------------------------------------------------------------

describe('token cache re-use', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    __resetTokenCacheForTests()
  })

  afterEach(() => clearEnvVars())

  it('reuses a cached token and does not call auth a second time', async () => {
    setEnvVars()
    const mockFetch = vi.mocked(global.fetch)

    // First generateIRN: auth + invoice
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ Data: { AuthToken: 'cached-token' } }),
    } as Response)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        Data: { Irn: 'irn-1', AckNo: 'ack-1', AckDt: '01/01/2024', SignedQRCode: 'qr' },
      }),
    } as Response)

    await generateIRN(MOCK_PAYLOAD)

    // Second generateIRN: should reuse the token (no second auth call)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        Data: { Irn: 'irn-2', AckNo: 'ack-2', AckDt: '01/01/2024', SignedQRCode: 'qr2' },
      }),
    } as Response)

    const result = await generateIRN(MOCK_PAYLOAD)
    expect(result.irn).toBe('irn-2')
    // Only 3 total fetch calls (auth + irn + irn) — no second auth
    expect(mockFetch).toHaveBeenCalledTimes(3)
  })
})

// ---------------------------------------------------------------------------
// generateIRN — additional error branches
// ---------------------------------------------------------------------------

describe('generateIRN – additional branches', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    __resetTokenCacheForTests()
  })

  afterEach(() => clearEnvVars())

  it('throws with data.error when IRN response has error object', async () => {
    setEnvVars()
    const mockFetch = vi.mocked(global.fetch)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ Data: { AuthToken: 'tok' } }),
    } as Response)
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: { code: 'DUPLICATE', desc: 'Duplicate IRN' } }),
    } as Response)

    await expect(generateIRN(MOCK_PAYLOAD)).rejects.toThrow('IRN generation failed')
  })

  it('throws when res.ok but Data is missing', async () => {
    setEnvVars()
    const mockFetch = vi.mocked(global.fetch)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ Data: { AuthToken: 'tok' } }),
    } as Response)
    // res.ok=true but no Data field
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ Status: 0, message: 'no data' }),
    } as Response)

    await expect(generateIRN(MOCK_PAYLOAD)).rejects.toThrow('IRN generation failed')
  })

  it('auth fails when AuthToken is missing from Data', async () => {
    setEnvVars()
    const mockFetch = vi.mocked(global.fetch)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ Data: {} }), // AuthToken missing
    } as Response)

    await expect(generateIRN(MOCK_PAYLOAD)).rejects.toThrow('IRP auth failed')
  })

  it('uses URP when buyerGstin is empty string', async () => {
    setEnvVars()
    const mockFetch = vi.mocked(global.fetch)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ Data: { AuthToken: 'tok' } }),
    } as Response)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        Data: { Irn: 'irn-x', AckNo: 'ack-x', AckDt: '01/01/2024', SignedQRCode: '' },
      }),
    } as Response)

    const payloadNoGstin: EInvoicePayload = { ...MOCK_PAYLOAD, buyerGstin: '' }
    await generateIRN(payloadNoGstin)

    const invoiceCall = mockFetch.mock.calls[1]
    const body = JSON.parse(invoiceCall[1]!.body as string)
    expect(body.BuyerDtls.Gstin).toBe('URP')
  })

  it('uses EINVOICE_BASE_URL when set', async () => {
    setEnvVars()
    process.env.EINVOICE_BASE_URL = 'https://custom-irp.example.com'
    const mockFetch = vi.mocked(global.fetch)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ Data: { AuthToken: 'tok' } }),
    } as Response)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        Data: { Irn: 'irn-y', AckNo: 'ack-y', AckDt: '01/01/2024', SignedQRCode: '' },
      }),
    } as Response)

    await generateIRN(MOCK_PAYLOAD)

    const authCall = mockFetch.mock.calls[0]
    expect(authCall[0] as string).toContain('https://custom-irp.example.com')
    delete process.env.EINVOICE_BASE_URL
  })
})
