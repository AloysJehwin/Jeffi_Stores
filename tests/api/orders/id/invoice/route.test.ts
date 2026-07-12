import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/jwt', () => ({
  authenticateAnyUser: vi.fn(),
  authenticateAdmin: vi.fn(),
}))
vi.mock('@/lib/db', () => ({
  queryOne: vi.fn(),
  queryMany: vi.fn(),
  query: vi.fn(),
}))
vi.mock('@/lib/invoice-pdf', () => ({
  generateInvoicePDF: vi.fn().mockResolvedValue(Buffer.from('pdf-data-invoice')),
}))
vi.mock('@/lib/receipt-pdf', () => ({
  generateReceiptPDF: vi.fn().mockResolvedValue(Buffer.from('pdf-data-receipt')),
}))
vi.mock('@/lib/s3', () => ({
  uploadInvoicePDF: vi.fn().mockResolvedValue('https://s3.example.com/uploaded.pdf'),
}))
vi.mock('@/lib/gst', () => ({
  getFinancialYear: vi.fn().mockReturnValue('2024-25'),
  round2: (n: number) => Math.round(n * 100) / 100,
}))
vi.mock('@/lib/invoice', () => ({
  generateOrderInvoice: vi.fn().mockResolvedValue(Buffer.from('invoice-data')),
}))

import { GET, POST } from '@/app/api/orders/[id]/invoice/route'
import * as jwt from '@/lib/jwt'
import * as db from '@/lib/db'
import * as invoicePdf from '@/lib/invoice-pdf'
import * as receiptPdf from '@/lib/receipt-pdf'
import * as s3 from '@/lib/s3'

const USER = { userId: 'user-1', isBusiness: false }
const ADMIN = { adminId: 'admin-1', username: 'root', role: 'super_admin', scopes: [] }
const PARAMS = { params: Promise.resolve({ id: 'order-1' }) }

const BASE: any = {
  id: 'order-1',
  order_number: 'ORD-1',
  invoice_number: 'INV-1',
  invoice_date: '2024-01-01',
  created_at: '2024-01-01T00:00:00Z',
  status: 'confirmed',
  payment_status: 'paid',
  source: 'web',
  user_id: 'user-1',
  customer_name: 'Buyer',
  customer_phone: '9999999999',
  subtotal: '500',
  tax_amount: '50',
  total_amount: '550',
  discount_amount: '0',
  shipping_amount: '0',
  taxable_amount: '450',
  cgst_amount: '25',
  sgst_amount: '25',
  igst_amount: '0',
  is_igst: false,
  full_name: 'Buyer',
  address_line1: '1 Road',
  address_line2: null,
  city: 'Mumbai',
  state: 'MH',
  postal_code: '400001',
  address_phone: '9999999999',
  billing_address_id: null,
  shipping_address_id: 'addr-1',
  buyer_gstin: null,
  tracking_number: null,
  shipped_at: null,
  shipping_method: null,
  payment_mode: null,
  notes: null,
}

function makeReq(method = 'GET') {
  return new Request('http://localhost/api/orders/order-1/invoice', { method })
}

describe('GET /api/orders/[id]/invoice — extra branch coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(db.queryMany).mockResolvedValue([])
  })

  it('returns voided PDF with -RETURNED suffix for returned status', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(USER as any)
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(null)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce({ ...BASE, status: 'returned' })
      .mockResolvedValueOnce(null)
    vi.mocked(db.queryMany).mockResolvedValueOnce([]).mockResolvedValueOnce([])

    const res = await GET(makeReq() as any, PARAMS)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Disposition') || '').toMatch(/-RETURNED/i)
    // Voided orders should NOT get uploaded to S3
    expect(s3.uploadInvoicePDF).not.toHaveBeenCalled()
  })

  it('fetches billing address when billing_address_id differs from shipping', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(USER as any)
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(null)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce({ ...BASE, billing_address_id: 'addr-2' })
      .mockResolvedValueOnce(null)          // no cached pdf
      .mockResolvedValueOnce({              // billing address lookup
        full_name: 'Billing',
        address_line1: '2 Bill Rd',
        city: 'Delhi',
        state: 'DL',
        postal_code: '110001',
        phone: '9111111111',
      })
    vi.mocked(db.queryMany).mockResolvedValueOnce([]).mockResolvedValueOnce([])
    vi.mocked(db.query).mockResolvedValue({ rows: [] } as any)

    const res = await GET(makeReq() as any, PARAMS)
    expect(res.status).toBe(200)
    expect(invoicePdf.generateInvoicePDF).toHaveBeenCalled()
    const args = vi.mocked(invoicePdf.generateInvoicePDF).mock.calls[0]
    // billingAddress is the 5th positional arg
    expect(args[4]).toBeDefined()
    expect((args[4] as any).full_name).toBe('Billing')
  })

  it('does not fetch billing when billing_address_id equals shipping_address_id', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(USER as any)
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(null)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce({ ...BASE, billing_address_id: 'addr-1', shipping_address_id: 'addr-1' })
      .mockResolvedValueOnce(null)
    vi.mocked(db.queryMany).mockResolvedValueOnce([]).mockResolvedValueOnce([])
    vi.mocked(db.query).mockResolvedValue({ rows: [] } as any)

    const res = await GET(makeReq() as any, PARAMS)
    expect(res.status).toBe(200)
    const args = vi.mocked(invoicePdf.generateInvoicePDF).mock.calls[0]
    // billingAddress should be undefined (not supplied)
    expect(args[4]).toBeUndefined()
  })

  it('handles null billing lookup gracefully (no throw)', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(USER as any)
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(null)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce({ ...BASE, billing_address_id: 'addr-2' })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null) // billing lookup returned nothing
    vi.mocked(db.queryMany).mockResolvedValueOnce([]).mockResolvedValueOnce([])
    vi.mocked(db.query).mockResolvedValue({ rows: [] } as any)

    const res = await GET(makeReq() as any, PARAMS)
    expect(res.status).toBe(200)
  })

  it('uploads and caches PDF for non-voided web order', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(USER as any)
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(null)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce(BASE)
      .mockResolvedValueOnce(null)
    vi.mocked(db.queryMany).mockResolvedValueOnce([]).mockResolvedValueOnce([])
    vi.mocked(db.query).mockResolvedValue({ rows: [] } as any)

    const res = await GET(makeReq() as any, PARAMS)
    expect(res.status).toBe(200)
    expect(s3.uploadInvoicePDF).toHaveBeenCalled()
    expect(db.query).toHaveBeenCalledWith(expect.stringMatching(/UPDATE invoices/i), expect.any(Array))
  })

  it('does not cache PDF for cash_sale even when not voided', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(USER as any)
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(null)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce({ ...BASE, source: 'cash_sale', payment_mode: 'Cash' })
      .mockResolvedValueOnce(null)
    vi.mocked(db.queryMany).mockResolvedValueOnce([]).mockResolvedValueOnce([])

    const res = await GET(makeReq() as any, PARAMS)
    expect(res.status).toBe(200)
    expect(receiptPdf.generateReceiptPDF).toHaveBeenCalled()
    expect(s3.uploadInvoicePDF).not.toHaveBeenCalled()
  })

  it('regenerates PDF for cancelled order even when pdf_url is cached', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(USER as any)
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(null)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce({ ...BASE, status: 'cancelled' })
      .mockResolvedValueOnce({ pdf_url: 'https://cached.example.com/foo.pdf' })
    vi.mocked(db.queryMany).mockResolvedValueOnce([]).mockResolvedValueOnce([])

    const res = await GET(makeReq() as any, PARAMS)
    // Should NOT redirect (307) because voided; should generate fresh PDF
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('application/pdf')
    expect(invoicePdf.generateInvoicePDF).toHaveBeenCalled()
  })

  it('replaces slashes in invoice_number for safe filename', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(USER as any)
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(null)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce({ ...BASE, invoice_number: 'JEF/2024-25/001' })
      .mockResolvedValueOnce(null)
    vi.mocked(db.queryMany).mockResolvedValueOnce([]).mockResolvedValueOnce([])
    vi.mocked(db.query).mockResolvedValue({ rows: [] } as any)

    const res = await GET(makeReq() as any, PARAMS)
    expect(res.status).toBe(200)
    const cd = res.headers.get('Content-Disposition') || ''
    expect(cd).toMatch(/JEF-2024-25-001/)
    expect(cd).not.toMatch(/JEF\/2024-25/)
  })

  it('maps order items to invoice items and passes them to the PDF generator', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(USER as any)
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(null)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce(BASE)
      .mockResolvedValueOnce(null)
    vi.mocked(db.queryMany)
      .mockResolvedValueOnce([
        {
          product_name: 'Item A',
          hsn_code: '84',
          gst_rate: '18',
          quantity: '2',
          unit_price: '100',
          total_price: '200',
          discount_amount: '10',
          mrp: '250',
          sold_unit_factor: '1',
          taxable_amount: '169',
          cgst_amount: '15',
          sgst_amount: '15',
          igst_amount: '0',
          buy_mode: 'unit',
          buy_unit: null,
        },
      ])
      .mockResolvedValueOnce([])
    vi.mocked(db.query).mockResolvedValue({ rows: [] } as any)

    const res = await GET(makeReq() as any, PARAMS)
    expect(res.status).toBe(200)
    const args = vi.mocked(invoicePdf.generateInvoicePDF).mock.calls[0]
    const items = args[1] as any[]
    expect(items).toHaveLength(1)
    expect(items[0].product_name).toBe('Item A')
    expect(items[0].mrp).toBe(250)
    expect(items[0].sold_unit_factor).toBe(1)
  })

  it('uses customer_phone when address phone missing', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(USER as any)
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(null)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce({ ...BASE, address_phone: null })
      .mockResolvedValueOnce(null)
    vi.mocked(db.queryMany).mockResolvedValueOnce([]).mockResolvedValueOnce([])
    vi.mocked(db.query).mockResolvedValue({ rows: [] } as any)

    const res = await GET(makeReq() as any, PARAMS)
    expect(res.status).toBe(200)
    const args = vi.mocked(invoicePdf.generateInvoicePDF).mock.calls[0]
    const buyer = args[3] as any
    expect(buyer.phone).toBe(BASE.customer_phone)
  })

  it('shows Online Payment when paid, empty string otherwise', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(USER as any)
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(null)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce({ ...BASE, payment_status: 'unpaid' })
      .mockResolvedValueOnce(null)
    vi.mocked(db.queryMany).mockResolvedValueOnce([]).mockResolvedValueOnce([])
    vi.mocked(db.query).mockResolvedValue({ rows: [] } as any)

    const res = await GET(makeReq() as any, PARAMS)
    expect(res.status).toBe(200)
    const args = vi.mocked(invoicePdf.generateInvoicePDF).mock.calls[0]
    const invoiceOrder = args[0] as any
    expect(invoiceOrder.payment_mode).toBe('')
  })
})

describe('POST /api/orders/[id]/invoice — extra coverage', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 400 when status is cancelled', async () => {
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce({
      id: 'order-1', invoice_number: null, payment_status: 'paid', status: 'cancelled',
    })
    const res = await POST(makeReq('POST') as any, PARAMS)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/cancelled/i)
  })
})
