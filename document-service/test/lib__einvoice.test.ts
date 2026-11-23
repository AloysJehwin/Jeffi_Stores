import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { generateIRN, cancelIRN, isEInvoiceConfigured, __resetTokenCacheForTests } from '../src/lib/einvoice.js'
import type { EInvoicePayload } from '../src/lib/einvoice.js'

const CREDS = {
  EINVOICE_CLIENT_ID: 'test-cid',
  EINVOICE_CLIENT_SECRET: 'test-fake-value-not-a-secret',
  EINVOICE_USERNAME: 'test-user',
  EINVOICE_PASSWORD: 'test-fake-value-not-a-password',
  EINVOICE_GSTIN: '22AAAAA0000A1Z5',
}

function setCreds() {
  for (const [k, v] of Object.entries(CREDS)) vi.stubEnv(k, v)
}

function jsonRes(ok: boolean, body: unknown, statusText = 'Error') {
  return { ok, statusText, json: async () => body } as any
}

const payload: EInvoicePayload = {
  invoiceNumber: 'JS/2025-26/001',
  invoiceDate: '01/06/2025',
  supplyType: 'B2B',
  sellerGstin: '22AAAAA0000A1Z5',
  sellerLegalName: 'Jeffi Stores',
  sellerAddress1: 'Station Road',
  sellerCity: 'Raipur',
  sellerStateCode: '22',
  sellerPincode: 492001,
  buyerGstin: '27BBBBB1111B1Z5',
  buyerLegalName: 'Acme',
  buyerAddress1: '123 Main',
  buyerCity: 'Mumbai',
  buyerStateCode: '27',
  buyerPincode: 400001,
  buyerPos: '27',
  items: [
    {
      slNo: '1',
      productDesc: 'Widget',
      isService: 'N',
      hsnCode: '8481',
      qty: 2,
      unit: 'NOS',
      unitPrice: 500,
      totalAmount: 1000,
      assAmt: 847.46,
      gstRate: 18,
      igstAmt: 0,
      cgstAmt: 76.27,
      sgstAmt: 76.27,
      totalItemVal: 1000,
    },
  ],
  assVal: 847.46,
  cgstVal: 76.27,
  sgstVal: 76.27,
  igstVal: 0,
  totalInvVal: 1000,
}

describe('einvoice', () => {
  beforeEach(() => {
    __resetTokenCacheForTests()
    vi.unstubAllEnvs()
    // Clear all einvoice creds so the default is "not configured".
    for (const k of Object.keys(CREDS)) vi.stubEnv(k, '')
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  describe('isConfigured / stub path', () => {
    it('isEInvoiceConfigured is false without creds, true with', () => {
      expect(isEInvoiceConfigured()).toBe(false)
      setCreds()
      expect(isEInvoiceConfigured()).toBe(true)
    })

    it('returns a synthesized stub IRN when creds absent (no fetch)', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch' as any)
      const r = await generateIRN(payload)
      expect(r.status).toBe('stub')
      expect(r.irn).toContain('STUB-')
      expect(r.irn).toContain(payload.invoiceNumber)
      expect(r.ackNo).toContain('STUB-ACK-')
      expect(r.signedQRCode).toBe('')
      expect(fetchSpy).not.toHaveBeenCalled()
    })
  })

  describe('authenticated generate path', () => {
    it('logs in, generates IRN, returns status generated', async () => {
      setCreds()
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(jsonRes(true, { Data: { AuthToken: 'tok-1' } }))
        .mockResolvedValueOnce(
          jsonRes(true, { Data: { Irn: 'IRN123', AckNo: 'ACK9', AckDt: '2025-06-01', SignedQRCode: 'qr' } })
        )
      vi.stubGlobal('fetch', fetchMock)

      const r = await generateIRN(payload)
      expect(r.status).toBe('generated')
      expect(r).toMatchObject({ irn: 'IRN123', ackNo: 'ACK9', ackDt: '2025-06-01', signedQRCode: 'qr' })
      expect(fetchMock).toHaveBeenCalledTimes(2)
      // first call is auth
      expect(fetchMock.mock.calls[0][0]).toContain('/eivital/v1.04/auth')
      expect(fetchMock.mock.calls[1][0]).toContain('/eicore/v1.03/Invoice')
    })

    it('caches the auth token across two generate calls (one login)', async () => {
      setCreds()
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(jsonRes(true, { Data: { AuthToken: 'tok-1' } }))
        .mockResolvedValue(
          jsonRes(true, { Data: { Irn: 'IRN123', AckNo: 'ACK9', AckDt: '2025-06-01', SignedQRCode: 'qr' } })
        )
      vi.stubGlobal('fetch', fetchMock)

      await generateIRN(payload)
      await generateIRN(payload)
      const authCalls = fetchMock.mock.calls.filter((c: any[]) => String(c[0]).includes('/auth'))
      expect(authCalls.length).toBe(1)
      expect(fetchMock).toHaveBeenCalledTimes(3)
    })

    it('throws when auth response lacks a token', async () => {
      setCreds()
      vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(jsonRes(false, { message: 'bad login' })))
      await expect(generateIRN(payload)).rejects.toThrow(/IRP auth failed/)
    })

    it('throws when IRN generation response is not ok', async () => {
      setCreds()
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(jsonRes(true, { Data: { AuthToken: 'tok-1' } }))
        .mockResolvedValueOnce(jsonRes(false, { message: 'dup invoice' }))
      vi.stubGlobal('fetch', fetchMock)
      await expect(generateIRN(payload)).rejects.toThrow(/IRN generation failed/)
    })
  })

  describe('cancelIRN', () => {
    it('throws when creds absent', async () => {
      await expect(cancelIRN('IRN123', 1, 'typo')).rejects.toThrow(/not configured/)
    })

    it('cancels when ok, throws when not ok', async () => {
      setCreds()
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(jsonRes(true, { Data: { AuthToken: 'tok-1' } }))
        .mockResolvedValueOnce(jsonRes(true, { Status: 1 }))
      vi.stubGlobal('fetch', fetchMock)
      await expect(cancelIRN('IRN123', 2, 'reason')).resolves.toBeUndefined()

      __resetTokenCacheForTests()
      const failMock = vi
        .fn()
        .mockResolvedValueOnce(jsonRes(true, { Data: { AuthToken: 'tok-1' } }))
        .mockResolvedValueOnce(jsonRes(false, { message: 'nope' }))
      vi.stubGlobal('fetch', failMock)
      await expect(cancelIRN('IRN123', 3, 'reason')).rejects.toThrow(/IRN cancellation failed/)
    })
  })
})
