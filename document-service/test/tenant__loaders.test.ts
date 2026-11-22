import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@jeffi/tenancy', () => ({
  queryMany: vi.fn(),
  queryOne: vi.fn(),
}))
vi.mock('../src/lib/invoice-pdf.js', () => ({ generateInvoicePDF: vi.fn() }))
vi.mock('../src/lib/receipt-pdf.js', () => ({ generateReceiptPDF: vi.fn() }))
vi.mock('../src/lib/quotation-pdf.js', () => ({ generateQuotationPDF: vi.fn() }))
vi.mock('../src/lib/po-pdf.js', () => ({ generatePurchaseOrderPDF: vi.fn() }))

import {
  businessSettings,
  invoiceBusiness,
  loadInvoice,
  invoicePdf,
  loadQuotation,
  quotationPdf,
  loadPurchaseOrder,
  purchaseOrderPdf,
} from '../src/tenant/loaders.js'
import { queryMany, queryOne } from '@jeffi/tenancy'
import { generateInvoicePDF } from '../src/lib/invoice-pdf.js'
import { generateReceiptPDF } from '../src/lib/receipt-pdf.js'
import { generateQuotationPDF } from '../src/lib/quotation-pdf.js'
import { generatePurchaseOrderPDF } from '../src/lib/po-pdf.js'

const PDF = Buffer.from('%PDF')

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(generateInvoicePDF).mockResolvedValue(PDF as any)
  vi.mocked(generateReceiptPDF).mockResolvedValue(PDF as any)
  vi.mocked(generateQuotationPDF).mockResolvedValue(PDF as any)
  vi.mocked(generatePurchaseOrderPDF).mockResolvedValue(PDF as any)
})

describe('businessSettings', () => {
  it('maps rows to a record, null values become empty string', async () => {
    vi.mocked(queryMany).mockResolvedValueOnce([
      { key: 'business_legal_name', value: 'Jeffi' },
      { key: 'bank_name', value: null },
    ] as any)
    const s = await businessSettings()
    expect(s.business_legal_name).toBe('Jeffi')
    expect(s.bank_name).toBe('')
  })
})

describe('invoiceBusiness', () => {
  it('maps every field with defaults from an empty settings object', () => {
    const b = invoiceBusiness({})
    expect(b).toMatchObject({ gstin: '', legalName: '', tradeName: '', address: '', state: '', stateCode: '', phone: '', email: '', bankName: '', bankAccount: '', bankIfsc: '', bankBranch: '', holderName: '', sealUrl: '', city: '' })
  })

  it('reads provided settings keys', () => {
    const b = invoiceBusiness({ business_gstin: 'G1', business_legal_name: 'LN', bank_ifsc: 'IFSC0' })
    expect(b.gstin).toBe('G1')
    expect(b.legalName).toBe('LN')
    expect(b.bankIfsc).toBe('IFSC0')
  })
})

describe('loadInvoice', () => {
  it('returns null when order not found', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce(null as any)
    expect(await loadInvoice('tok')).toBeNull()
    expect(queryMany).not.toHaveBeenCalled()
  })

  it('returns order, items and settings when found', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce({ id: 'o1', invoice_number: 'INV/1' } as any)
    vi.mocked(queryMany)
      .mockResolvedValueOnce([{ product_name: 'A' }] as any) // order_items
      .mockResolvedValueOnce([{ key: 'business_gstin', value: 'G' }] as any) // settings
    const r = await loadInvoice('tok')
    expect(r?.order.id).toBe('o1')
    expect(r?.items).toHaveLength(1)
    expect(r?.settings.business_gstin).toBe('G')
  })
})

describe('invoicePdf', () => {
  const settings = { business_legal_name: 'Jeffi', business_gstin: 'G1' }

  it('cash_sale order calls generateReceiptPDF (num helper coerces values)', async () => {
    const order = {
      source: 'cash_sale',
      invoice_number: 'CS/1',
      invoice_date: '2025-06-01',
      total_amount: '1000',
      taxable_amount: '847.46',
      cgst_amount: '76.27',
      sgst_amount: '76.27',
      igst_amount: null,
    }
    const items = [{ product_name: 'A', quantity: 2, unit_price: '500', total_price: '1000', gst_rate: '18' }]
    const r = await invoicePdf({ order, items, settings } as any)
    expect(generateReceiptPDF).toHaveBeenCalledOnce()
    expect(generateInvoicePDF).not.toHaveBeenCalled()
    expect(r.buffer).toBe(PDF)
    expect(r.filename).toBe('CS-1.pdf')
    // num('') / num(null) → 0
    const ro = vi.mocked(generateReceiptPDF).mock.calls[0][0]
    expect(ro.igst_amount).toBe(0)
    expect(ro.total_amount).toBe(1000)
  })

  it('standard order calls generateInvoicePDF and fetches billing when distinct', async () => {
    const order = {
      source: 'online',
      order_number: 'ORD-1',
      invoice_number: 'JS/1',
      created_at: '2025-06-01',
      status: 'confirmed',
      payment_status: 'paid',
      shipping_address_id: 'addr-1',
      billing_address_id: 'addr-2',
      tax_amount: '180',
      cgst_amount: '90',
      sgst_amount: '90',
      igst_amount: '0',
    }
    const items = [{ product_name: 'A', quantity: 1, unit_price: '100', total_price: '100', gst_rate: '18', mrp: '120' }]
    vi.mocked(queryOne).mockResolvedValueOnce({ full_name: 'Bill To' } as any) // billing address
    const r = await invoicePdf({ order, items, settings } as any)
    expect(generateInvoicePDF).toHaveBeenCalledOnce()
    expect(queryOne).toHaveBeenCalledOnce()
    expect(r.filename).toBe('JS-1.pdf')
    // billing arg passed through
    const billingArg = vi.mocked(generateInvoicePDF).mock.calls[0][4]
    expect(billingArg?.full_name).toBe('Bill To')
    // payment mode derived from paid status
    expect(vi.mocked(generateInvoicePDF).mock.calls[0][0].payment_mode).toBe('Online Payment')
  })

  it('cancelled/returned status passes RETURNED label and cancelled flag', async () => {
    const order = { source: 'online', order_number: 'O', invoice_number: 'JS/2', created_at: 'd', status: 'returned', payment_status: 'pending', tax_amount: '0', cgst_amount: '0', sgst_amount: '0', igst_amount: '0' }
    await invoicePdf({ order, items: [], settings } as any)
    const call = vi.mocked(generateInvoicePDF).mock.calls[0]
    expect(call[5]).toBe(true) // cancelled
    expect(call[6]).toBe('RETURNED') // void label
    expect(call[7]).toBe(true) // taxFree (all tax zero)
  })
})

describe('loadQuotation / quotationPdf', () => {
  it('loadQuotation returns null when not found', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce(null as any)
    expect(await loadQuotation('tok')).toBeNull()
  })

  it('loadQuotation returns qt, items, settings when found', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce({ id: 'q1', quote_number: 'QT/1' } as any)
    vi.mocked(queryMany)
      .mockResolvedValueOnce([{ description: 'line' }] as any)
      .mockResolvedValueOnce([] as any)
    const r = await loadQuotation('tok')
    expect(r?.qt.id).toBe('q1')
    expect(r?.items).toHaveLength(1)
  })

  it('quotationPdf calls generateQuotationPDF and builds filename', async () => {
    const qt = { quote_number: 'QT/24-25/1' }
    const items = [{ description: 'd', hsn_code: '8481', gst_rate: '18', quantity: '2', unit: 'Nos', rate: '100', discount_pct: '0', amount: '200' }]
    const r = await quotationPdf({ qt, items, settings: {} } as any)
    expect(generateQuotationPDF).toHaveBeenCalledOnce()
    expect(r.filename).toBe('quotation-QT-24-25-1.pdf')
    expect(r.buffer).toBe(PDF)
  })
})

describe('loadPurchaseOrder / purchaseOrderPdf', () => {
  it('loadPurchaseOrder returns null when not found', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce(null as any)
    expect(await loadPurchaseOrder('tok')).toBeNull()
  })

  it('loadPurchaseOrder returns po, items, grns, settings when found', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce({ id: 'po1', po_number: 'PO/1' } as any)
    vi.mocked(queryMany)
      .mockResolvedValueOnce([{ product_name: 'A' }] as any) // items
      .mockResolvedValueOnce([{ grn_number: 'GRN/1' }] as any) // grns
      .mockResolvedValueOnce([] as any) // settings
    const r = await loadPurchaseOrder('tok')
    expect(r?.po.id).toBe('po1')
    expect(r?.items).toHaveLength(1)
    expect(r?.grns).toHaveLength(1)
  })

  it('purchaseOrderPdf calls generatePurchaseOrderPDF and builds filename', async () => {
    const po = { po_number: 'PO/24-25/9' }
    const items = [{ product_name: 'A', variant_name: null, quantity: '3', unit_cost: '50' }]
    const r = await purchaseOrderPdf({ po, items, settings: {} } as any)
    expect(generatePurchaseOrderPDF).toHaveBeenCalledOnce()
    expect(r.filename).toBe('po-PO-24-25-9.pdf')
    expect(r.buffer).toBe(PDF)
  })
})
