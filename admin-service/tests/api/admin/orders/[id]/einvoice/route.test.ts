import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({ queryOne: vi.fn(), queryMany: vi.fn() }))
vi.mock('@/lib/shipping/einvoice', () => ({ generateIRN: vi.fn(), cancelIRN: vi.fn() }))
vi.mock('@/lib/shipping/gst-api-creds', () => ({
  GstApiNotConnectedError: class GstApiNotConnectedError extends Error {
    constructor(
      public provider: string,
      message = 'connect GST'
    ) {
      super(message)
    }
  },
}))

import { POST, DELETE } from '@admin/app/api/(admin)/admin/orders/[id]/einvoice/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { queryOne, queryMany } from '@/lib/shared/db'
import { generateIRN, cancelIRN } from '@/lib/shipping/einvoice'
import { GstApiNotConnectedError } from '@/lib/shipping/gst-api-creds'

const admin = { adminId: 'a1', username: 'admin', role: 'admin', scopes: [] }
const ctx = { params: Promise.resolve({ id: 'o1' }) }
const post = () => POST(new NextRequest('http://localhost/x', { method: 'POST' }), ctx)
const del = (body?: unknown) =>
  DELETE(new NextRequest('http://localhost/x', { method: 'DELETE', body: body ? JSON.stringify(body) : undefined }), ctx)

const order = {
  invoice_number: 'INV-1',
  invoice_date: '2025-03-04T00:00:00Z',
  created_at: '2025-03-04T00:00:00Z',
  total_amount: '118',
  taxable_amount: '100',
  cgst_amount: '9',
  sgst_amount: '9',
  igst_amount: '0',
  full_name: 'Buyer',
}

describe('einvoice route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateAdmin).mockResolvedValue(admin)
    vi.mocked(hasScope).mockReturnValue(true)
  })

  describe('POST', () => {
    it('returns 401 / 403 on auth failure', async () => {
      vi.mocked(authenticateAdmin).mockResolvedValue(null)
      expect((await post()).status).toBe(401)
      vi.mocked(authenticateAdmin).mockResolvedValue(admin)
      vi.mocked(hasScope).mockReturnValue(false)
      expect((await post()).status).toBe(403)
      expect(generateIRN).not.toHaveBeenCalled()
    })

    it('returns 404 for an unknown order and 422 without an invoice', async () => {
      vi.mocked(queryOne).mockResolvedValueOnce(null)
      expect((await post()).status).toBe(404)
      vi.mocked(queryOne).mockResolvedValueOnce({ ...order, invoice_number: null })
      expect((await post()).status).toBe(422)
    })

    it('returns 409 when the IRN already exists', async () => {
      vi.mocked(queryOne).mockResolvedValueOnce({ ...order, irn: 'IRN1', irn_status: 'generated' })
      const res = await post()
      expect(res.status).toBe(409)
      expect((await res.json()).irn).toBe('IRN1')
    })

    it('generates the IRN from the order lines and stores it', async () => {
      vi.mocked(queryOne).mockResolvedValueOnce(order).mockResolvedValueOnce(null)
      vi.mocked(queryMany)
        .mockResolvedValueOnce([
          { product_name: 'P', quantity: 2, unit_price: '50', total_price: '100', taxable_amount: '100', cgst_amount: '9', sgst_amount: '9', igst_amount: '0', gst_rate: '18', hsn_code: '1234' },
        ])
        .mockResolvedValueOnce([{ key: 'business_gstin', value: '33AAAAA' }])
      vi.mocked(generateIRN).mockResolvedValue({ irn: 'IRN9', ackNo: '55', ackDt: 'd', signedQRCode: 'qr', status: 'generated' } as never)
      const res = await post()
      expect(res.status).toBe(200)
      expect(await res.json()).toMatchObject({ success: true, irn: 'IRN9', configured: true })
      const payload = vi.mocked(generateIRN).mock.calls[0][0]
      expect(payload).toMatchObject({ invoiceNumber: 'INV-1', invoiceDate: '04/03/2025', supplyType: 'B2C', sellerGstin: '33AAAAA', totalInvVal: 118 })
      expect(payload.items[0]).toMatchObject({ hsnCode: '1234', qty: 2, totalItemVal: 118 })
      const upd = vi.mocked(queryOne).mock.calls[1]
      expect(upd[0]).toMatch(/UPDATE orders SET/)
      expect((upd[1] as unknown[])[0]).toBe('IRN9')
      expect((upd[1] as unknown[])[5]).toBe('o1')
    })

    it('returns 422 with code when the GST API is not connected', async () => {
      vi.mocked(queryOne).mockResolvedValueOnce(order)
      vi.mocked(queryMany).mockResolvedValue([])
      vi.mocked(generateIRN).mockRejectedValue(new GstApiNotConnectedError('einvoice', 'connect GST'))
      const res = await post()
      expect(res.status).toBe(422)
      expect(await res.json()).toEqual({ error: 'connect GST', code: 'not_connected' })
    })

    it('returns 500 on any other failure', async () => {
      vi.mocked(queryOne).mockRejectedValue(new Error('db'))
      expect((await post()).status).toBe(500)
    })
  })

  describe('DELETE', () => {
    it('returns 401 / 403 on auth failure', async () => {
      vi.mocked(authenticateAdmin).mockResolvedValue(null)
      expect((await del()).status).toBe(401)
      vi.mocked(authenticateAdmin).mockResolvedValue(admin)
      vi.mocked(hasScope).mockReturnValue(false)
      expect((await del()).status).toBe(403)
    })

    it('returns 404, 422 and 409 for missing order, no IRN and already cancelled', async () => {
      vi.mocked(queryOne).mockResolvedValueOnce(null)
      expect((await del()).status).toBe(404)
      vi.mocked(queryOne).mockResolvedValueOnce({ irn: null })
      expect((await del()).status).toBe(422)
      vi.mocked(queryOne).mockResolvedValueOnce({ irn: 'I', irn_status: 'cancelled' })
      expect((await del()).status).toBe(409)
      expect(cancelIRN).not.toHaveBeenCalled()
    })

    it('cancels a real IRN with the given reason and marks the order', async () => {
      vi.mocked(queryOne).mockResolvedValue({ irn: 'IRN1', irn_status: 'generated' })
      const res = await del({ reason: 2, remark: 'dup' })
      expect(res.status).toBe(200)
      expect(cancelIRN).toHaveBeenCalledWith('IRN1', 2, 'dup')
      expect(vi.mocked(queryOne).mock.calls[1][0]).toMatch(/irn_status = 'cancelled'/)
    })

    it('skips the API for a stub IRN and defaults the reason', async () => {
      vi.mocked(queryOne).mockResolvedValue({ irn: 'STUB-1', irn_status: 'generated' })
      expect((await del()).status).toBe(200)
      expect(cancelIRN).not.toHaveBeenCalled()
    })

    it('returns 500 when cancellation fails', async () => {
      vi.mocked(queryOne).mockResolvedValue({ irn: 'IRN1', irn_status: 'generated' })
      vi.mocked(cancelIRN).mockRejectedValue(new Error('gst'))
      expect((await del()).status).toBe(500)
    })
  })
})
