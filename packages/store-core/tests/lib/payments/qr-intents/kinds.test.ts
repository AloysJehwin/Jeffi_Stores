import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/shared/db', () => ({ queryOne: vi.fn() }))
vi.mock('@/lib/documents/proxy', () => ({ docServiceFetch: vi.fn() }))
vi.mock('@/lib/orders/inventory-deduct', () => ({
  InsufficientStockError: class extends Error {},
}))
vi.mock('@/lib/orders/offline-invoice', async () => {
  const { z } = await import('zod')
  return {
    createOfflineInvoice: vi.fn(),
    assignmentsOf: (b: any) => ({ batchAssignments: b?.batch_assignments ?? [], serialAssignments: b?.serial_assignments ?? [] }),
    createOrderSchema: z.object({ customerName: z.string().min(1), paymentMode: z.string().nullish() }).passthrough(),
    OfflineInvoiceError: class extends Error {
      constructor(
        m: string,
        readonly status = 400
      ) {
        super(m)
      }
    },
  }
})

import { KINDS, resultLinks } from '@/lib/payments/qr-intents/kinds'
import { queryOne } from '@/lib/shared/db'
import { docServiceFetch } from '@/lib/documents/proxy'
import { createOfflineInvoice, OfflineInvoiceError } from '@/lib/orders/offline-invoice'
import { InsufficientStockError } from '@/lib/orders/inventory-deduct'

const ACTOR = { adminId: 'a1', role: 'manager', scopes: ['quotations:write'] }
const QID = '33333333-3333-4333-8333-333333333333'
const QR = { razorpayPaymentId: 'pay_1', razorpayQrId: 'qr_1', amountPaise: 11800, intentId: 'i1' }
const json = (status: number, body: unknown) => ({ ok: status < 300, status, json: async () => body }) as any
const intent = (kind: string, payload: Record<string, unknown>) => ({ id: 'i1', kind, payload, actor: ACTOR }) as any

beforeEach(() => vi.clearAllMocks())

describe('invoice', () => {
  const body = { customerName: 'Ravi', items: [{ x: 1 }], paymentMode: 'cash', batch_assignments: [{ order_item_id: 't1', batch_id: 'b', qty: 1 }] }

  it('dry-runs the offline invoice and prices the QR from it', async () => {
    vi.mocked(createOfflineInvoice).mockResolvedValue({ totalAmount: 118.5, saveAsDraft: false, insufficientItems: [] } as any)
    const v = await KINDS.invoice.validate(body, ACTOR)
    expect(createOfflineInvoice).toHaveBeenCalledWith(
      expect.objectContaining({ customerName: 'Ravi', paymentMode: 'upi_qr' }),
      { batchAssignments: body.batch_assignments, serialAssignments: [] },
      { actor: ACTOR, dryRun: true }
    )
    expect(v).toEqual({ amountPaise: 11850, payload: { ...body, paymentMode: 'upi_qr' }, label: 'Invoice for Ravi' })
  })

  it('refuses a short-stock invoice (it would only be a draft) and invalid bodies', async () => {
    vi.mocked(createOfflineInvoice).mockResolvedValue({ totalAmount: 1, saveAsDraft: true, insufficientItems: ['Widget (need 2)'] } as any)
    await expect(KINDS.invoice.validate(body, ACTOR)).rejects.toMatchObject({ status: 409, message: 'Not enough stock: Widget (need 2)' })
    await expect(KINDS.invoice.validate({ items: [] }, ACTOR)).rejects.toMatchObject({ status: 400, message: 'Validation failed' })
  })

  it('maps the create call’s own errors to its statuses', async () => {
    vi.mocked(createOfflineInvoice).mockRejectedValueOnce(new (OfflineInvoiceError as any)('Digital products cannot be sold through this channel', 400))
    await expect(KINDS.invoice.validate(body, ACTOR)).rejects.toMatchObject({ status: 400 })
    vi.mocked(createOfflineInvoice).mockRejectedValueOnce(new (InsufficientStockError as any)('Serial X is sold'))
    await expect(KINDS.invoice.validate(body, ACTOR)).rejects.toMatchObject({ status: 409, message: 'Serial X is sold' })
    vi.mocked(createOfflineInvoice).mockRejectedValueOnce(new Error('db down'))
    await expect(KINDS.invoice.validate(body, ACTOR)).rejects.toThrow('db down')
  })

  it('finalises with the payment, as the admin who made the intent', async () => {
    vi.mocked(createOfflineInvoice).mockResolvedValue({ orderId: 'o1', orderNumber: 'OFF-1', totalAmount: 118 } as any)
    const r = await KINDS.invoice.finalise(intent('invoice', { ...body, paymentMode: 'upi_qr' }), QR)
    expect(createOfflineInvoice).toHaveBeenCalledWith(expect.anything(), expect.anything(), { actor: ACTOR, qrPayment: QR })
    expect(r).toEqual({ id: 'o1', ref: 'OFF-1', totalInr: 118 })
  })

  it('finds the order a payment already made', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce({ id: 'o1', ref: 'OFF-1', total_amount: '118.00' } as any)
    expect(await KINDS.invoice.existing('pay_1')).toEqual({ id: 'o1', ref: 'OFF-1', totalInr: 118 })
    expect(vi.mocked(queryOne).mock.calls[0]).toEqual([expect.stringContaining('p.transaction_id = $1'), ['pay_1']])
    vi.mocked(queryOne).mockResolvedValueOnce(null)
    expect(await KINDS.invoice.existing('pay_2')).toBeNull()
  })
})

describe('quotation_convert', () => {
  const payload = { quotationId: QID, paymentMode: 'upi_qr', enableDelivery: true, batch_assignments: [{ a: 1 }] }

  it('dry-runs the conversion on document-service as the admin', async () => {
    vi.mocked(docServiceFetch).mockResolvedValue(json(200, { dryRun: true, totalAmount: 590, savedAsDraft: false }))
    const v = await KINDS.quotation_convert.validate(payload, ACTOR)
    expect(docServiceFetch).toHaveBeenCalledWith(
      `/admin/quotations/${QID}/convert-to-invoice`,
      { adminId: 'a1', role: 'manager', scopes: ['quotations:write'], qrIntent: 'validate' },
      { method: 'POST', body: { paymentMode: 'upi_qr', enableDelivery: true, batch_assignments: [{ a: 1 }], serial_assignments: [], dryRun: true } }
    )
    expect(v.amountPaise).toBe(59000)
    expect(v.payload).toMatchObject({ quotationId: QID, paymentMode: 'upi_qr', enableDelivery: true })
  })

  it('needs a quotation id, and passes the service’s refusal through', async () => {
    await expect(KINDS.quotation_convert.validate({}, ACTOR)).rejects.toMatchObject({ status: 400, message: 'quotationId is required' })
    vi.mocked(docServiceFetch).mockResolvedValue(json(409, { error: 'This quotation has already been converted to an invoice' }))
    await expect(KINDS.quotation_convert.validate(payload, ACTOR)).rejects.toMatchObject({ status: 409, message: 'This quotation has already been converted to an invoice' })
    vi.mocked(docServiceFetch).mockResolvedValue({ ok: false, status: 502, json: async () => { throw new Error('html') } } as any)
    await expect(KINDS.quotation_convert.validate(payload, ACTOR)).rejects.toMatchObject({ status: 502, message: 'Request failed (502)' })
  })

  it('refuses when the conversion would only save a draft', async () => {
    vi.mocked(docServiceFetch).mockResolvedValue(json(200, { dryRun: true, totalAmount: 590, savedAsDraft: true, insufficientItems: ['Pipe'] }))
    await expect(KINDS.quotation_convert.validate(payload, ACTOR)).rejects.toMatchObject({ status: 409, extra: { insufficientItems: ['Pipe'] } })
  })

  it('finalises with the payment under the intent’s own claim', async () => {
    vi.mocked(docServiceFetch).mockResolvedValue(json(200, { orderId: 'o2', orderNumber: 'OFF-2', totalAmount: 590 }))
    const r = await KINDS.quotation_convert.finalise(intent('quotation_convert', payload), QR)
    const [, claims, init] = vi.mocked(docServiceFetch).mock.calls[0]
    expect(claims).toMatchObject({ qrIntent: 'i1', adminId: 'a1' })
    expect((init as any).body).toMatchObject({ paymentMode: 'upi_qr', qrPayment: QR })
    expect((init as any).body.dryRun).toBeUndefined()
    expect(r).toEqual({ id: 'o2', ref: 'OFF-2', totalInr: 590 })
  })
})

describe('invoice_draft_finalise', () => {
  const payload = { draftId: QID, batch_assignments: [], serial_assignments: [{ order_item_id: 'oi', serial_number: 'S1' }] }

  it('dry-runs and finalises the draft', async () => {
    vi.mocked(docServiceFetch).mockResolvedValueOnce(json(200, { dryRun: true, totalAmount: 100 }))
    const v = await KINDS.invoice_draft_finalise.validate(payload, ACTOR)
    expect(vi.mocked(docServiceFetch).mock.calls[0][0]).toBe(`/admin/invoices/drafts/${QID}/finalize`)
    expect(v).toMatchObject({ amountPaise: 10000, label: 'Invoice payment' })

    vi.mocked(docServiceFetch).mockResolvedValueOnce(json(200, { orderId: QID, orderNumber: 'OFF-3', totalAmount: 100 }))
    expect(await KINDS.invoice_draft_finalise.finalise(intent('invoice_draft_finalise', payload), QR)).toEqual({ id: QID, ref: 'OFF-3', totalInr: 100 })
  })

  it('refuses without a draft id', async () => {
    await expect(KINDS.invoice_draft_finalise.validate({ draftId: 'x' }, ACTOR)).rejects.toThrow('draftId is required')
  })
})

describe('cash_sale', () => {
  const payload = { items: [{ product_name: 'Tea' }], notes: 'n', draft_id: QID, paymentMode: 'cash' }

  it('dry-runs and finalises the sale (a held bill is removed by the sale itself)', async () => {
    vi.mocked(docServiceFetch).mockResolvedValueOnce(json(200, { dryRun: true, totalAmount: 20 }))
    const v = await KINDS.cash_sale.validate(payload, ACTOR)
    expect(vi.mocked(docServiceFetch).mock.calls[0][2]).toEqual({ method: 'POST', body: { ...payload, paymentMode: 'upi_qr', dryRun: true } })
    expect(v).toEqual({ amountPaise: 2000, payload: { ...payload, paymentMode: 'upi_qr' }, label: 'Counter sale' })

    vi.mocked(docServiceFetch).mockResolvedValueOnce(json(200, { saleId: 's1', saleNumber: 'CS-1', totalAmount: 20 }))
    expect(await KINDS.cash_sale.finalise(intent('cash_sale', v.payload), { ...QR, amountPaise: 2000 })).toEqual({ id: 's1', ref: 'CS-1', totalInr: 20 })
  })

  it('finds the sale a payment already made', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce({ id: 's1', ref: 'CS-1', total_amount: '20' } as any)
    expect(await KINDS.cash_sale.existing('pay_1')).toEqual({ id: 's1', ref: 'CS-1', totalInr: 20 })
    expect(vi.mocked(queryOne).mock.calls[0][0]).toContain('FROM cash_sales WHERE razorpay_payment_id = $1')
    vi.mocked(queryOne).mockResolvedValueOnce(null)
    expect(await KINDS.cash_sale.existing('pay_2')).toBeNull()
  })
})

describe('resultLinks', () => {
  it('points invoices and cash sales at their pages and PDFs', () => {
    expect(resultLinks('invoice', 'o1')).toEqual({ resultUrl: '/admin/invoices/o1/view', invoiceUrl: '/api/orders/o1/invoice' })
    expect(resultLinks('cash_sale', 's1')).toEqual({ resultUrl: '/admin/cash-sale/s1/view', invoiceUrl: '/api/admin/cash-sale/s1/receipt' })
  })
})
