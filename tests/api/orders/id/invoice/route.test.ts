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

describe('GET /api/orders/[id]/invoice — auth branches', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(db.queryMany).mockResolvedValue([])
  })

  it('returns 401 when both user and admin auth are null', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(null)
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(null)
    const res = await GET(makeReq() as any, PARAMS)
    expect(res.status).toBe(401)
  })

  it('returns 403 when authenticated user does not own the order', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue({ userId: 'other-user' } as any)
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(null)
    vi.mocked(db.queryOne).mockResolvedValueOnce({ ...BASE, user_id: 'user-1' })
    const res = await GET(makeReq() as any, PARAMS)
    expect(res.status).toBe(403)
  })

  it('returns 404 when order has no invoice number', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(USER as any)
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(null)
    vi.mocked(db.queryOne).mockResolvedValueOnce({ ...BASE, invoice_number: null })
    const res = await GET(makeReq() as any, PARAMS)
    expect(res.status).toBe(404)
  })

  it('returns 404 when order not found', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(USER as any)
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(null)
    vi.mocked(db.queryOne).mockResolvedValueOnce(null)
    const res = await GET(makeReq() as any, PARAMS)
    expect(res.status).toBe(404)
  })

  it('redirects when non-voided pdf_url is cached', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(USER as any)
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(null)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce(BASE)
      .mockResolvedValueOnce({ pdf_url: 'https://cached.s3.example.com/inv.pdf' })
    const res = await GET(makeReq() as any, PARAMS)
    // NextResponse.redirect produces a 307/308
    expect([307, 308]).toContain(res.status)
  })

  it('handles invoice_date fallback to created_at', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(USER as any)
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(null)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce({ ...BASE, invoice_date: null })
      .mockResolvedValueOnce(null)
    vi.mocked(db.queryMany).mockResolvedValueOnce([]).mockResolvedValueOnce([])
    vi.mocked(db.query).mockResolvedValue({ rows: [] } as any)
    const res = await GET(makeReq() as any, PARAMS)
    expect(res.status).toBe(200)
    const args = vi.mocked(invoicePdf.generateInvoicePDF).mock.calls[0]
    expect((args[0] as any).invoice_date).toBe(BASE.created_at)
  })

  it('builds destination from city+state when both present', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(USER as any)
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(null)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce({ ...BASE, city: 'Delhi', state: 'DL' })
      .mockResolvedValueOnce(null)
    vi.mocked(db.queryMany).mockResolvedValueOnce([]).mockResolvedValueOnce([])
    vi.mocked(db.query).mockResolvedValue({ rows: [] } as any)
    const res = await GET(makeReq() as any, PARAMS)
    expect(res.status).toBe(200)
    const args = vi.mocked(invoicePdf.generateInvoicePDF).mock.calls[0]
    expect((args[0] as any).destination).toBe('Delhi, DL')
  })

  it('builds destination with only city when state is null', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(USER as any)
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(null)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce({ ...BASE, city: 'Mumbai', state: null })
      .mockResolvedValueOnce(null)
    vi.mocked(db.queryMany).mockResolvedValueOnce([]).mockResolvedValueOnce([])
    vi.mocked(db.query).mockResolvedValue({ rows: [] } as any)
    const res = await GET(makeReq() as any, PARAMS)
    expect(res.status).toBe(200)
    const args = vi.mocked(invoicePdf.generateInvoicePDF).mock.calls[0]
    expect((args[0] as any).destination).toBe('Mumbai')
  })

  it('maps item with null mrp and null sold_unit_factor correctly', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(USER as any)
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(null)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce(BASE)
      .mockResolvedValueOnce(null)
    vi.mocked(db.queryMany)
      .mockResolvedValueOnce([{
        product_name: 'Bolt',
        hsn_code: null,
        gst_rate: null,
        quantity: 1,
        unit_price: '100',
        total_price: '100',
        discount_amount: null,
        mrp: null,
        sold_unit_factor: null,
        taxable_amount: null,
        cgst_amount: null,
        sgst_amount: null,
        igst_amount: null,
        buy_mode: null,
        buy_unit: null,
      }])
      .mockResolvedValueOnce([])
    vi.mocked(db.query).mockResolvedValue({ rows: [] } as any)
    const res = await GET(makeReq() as any, PARAMS)
    expect(res.status).toBe(200)
    const args = vi.mocked(invoicePdf.generateInvoicePDF).mock.calls[0]
    const items = args[1] as any[]
    expect(items[0].mrp).toBeNull()
    expect(items[0].sold_unit_factor).toBeNull()
    expect(items[0].buy_mode).toBe('unit')
    expect(items[0].hsn_code).toBeNull()
  })

  it('uses customer_name fallback when full_name is null for buyerAddress', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(USER as any)
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(null)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce({ ...BASE, full_name: null })
      .mockResolvedValueOnce(null)
    vi.mocked(db.queryMany).mockResolvedValueOnce([]).mockResolvedValueOnce([])
    vi.mocked(db.query).mockResolvedValue({ rows: [] } as any)
    const res = await GET(makeReq() as any, PARAMS)
    expect(res.status).toBe(200)
    const args = vi.mocked(invoicePdf.generateInvoicePDF).mock.calls[0]
    expect((args[3] as any).full_name).toBe(BASE.customer_name)
  })

  it('sets address_line2 to null when field is undefined', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(USER as any)
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(null)
    // address_line2 is omitted entirely (undefined) rather than null
    const orderNoLine2 = { ...BASE }
    delete (orderNoLine2 as any).address_line2
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce(orderNoLine2)
      .mockResolvedValueOnce(null)
    vi.mocked(db.queryMany).mockResolvedValueOnce([]).mockResolvedValueOnce([])
    vi.mocked(db.query).mockResolvedValue({ rows: [] } as any)
    const res = await GET(makeReq() as any, PARAMS)
    expect(res.status).toBe(200)
    const args = vi.mocked(invoicePdf.generateInvoicePDF).mock.calls[0]
    expect((args[3] as any).address_line2).toBeNull()
  })

  it('builds empty destination when both city and state are null', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(USER as any)
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(null)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce({ ...BASE, city: null, state: null })
      .mockResolvedValueOnce(null)
    vi.mocked(db.queryMany).mockResolvedValueOnce([]).mockResolvedValueOnce([])
    vi.mocked(db.query).mockResolvedValue({ rows: [] } as any)
    const res = await GET(makeReq() as any, PARAMS)
    expect(res.status).toBe(200)
    const args = vi.mocked(invoicePdf.generateInvoicePDF).mock.calls[0]
    expect((args[0] as any).destination).toBe('')
  })

  it('admin auth allows access to any order', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(null)
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce({ ...BASE, user_id: 'someone-else' })
      .mockResolvedValueOnce(null)
    vi.mocked(db.queryMany).mockResolvedValueOnce([]).mockResolvedValueOnce([])
    vi.mocked(db.query).mockResolvedValue({ rows: [] } as any)
    const res = await GET(makeReq() as any, PARAMS)
    expect(res.status).toBe(200)
  })

  it('returns CANCELLED suffix for cancelled voided order', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(USER as any)
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(null)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce({ ...BASE, status: 'cancelled' })
      .mockResolvedValueOnce(null)
    vi.mocked(db.queryMany).mockResolvedValueOnce([]).mockResolvedValueOnce([])
    const res = await GET(makeReq() as any, PARAMS)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Disposition') || '').toMatch(/-CANCELLED/i)
  })
})

describe('GET /api/orders/[id]/invoice — fallback branch coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(db.queryMany).mockResolvedValue([])
  })

  // Covers lines 99-104: || '0' fallback when order amount fields are null/undefined
  it('falls back to 0 for null order amount fields', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(USER as any)
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(null)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce({
        ...BASE,
        discount_amount: null,
        shipping_amount: null,
        taxable_amount: null,
        cgst_amount: null,
        sgst_amount: null,
        igst_amount: null,
        is_igst: null,
        buyer_gstin: null,
        tracking_number: null,
        shipped_at: null,
        shipping_method: null,
      })
      .mockResolvedValueOnce(null)
    vi.mocked(db.queryMany).mockResolvedValueOnce([]).mockResolvedValueOnce([])
    vi.mocked(db.query).mockResolvedValue({ rows: [] } as any)

    const res = await GET(makeReq() as any, PARAMS)
    expect(res.status).toBe(200)
    const args = vi.mocked(invoicePdf.generateInvoicePDF).mock.calls[0]
    const order = args[0] as any
    expect(order.discount_amount).toBe(0)
    expect(order.shipping_amount).toBe(0)
    expect(order.taxable_amount).toBe(0)
    expect(order.cgst_amount).toBe(0)
    expect(order.sgst_amount).toBe(0)
    expect(order.igst_amount).toBe(0)
    expect(order.is_igst).toBe(false)
  })

  // Covers lines 134-140: || '' fallbacks when buyer address fields are null
  it('falls back to empty strings for null buyer address fields', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(USER as any)
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(null)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce({
        ...BASE,
        full_name: null,
        customer_name: null,
        address_line1: null,
        address_line2: null,
        city: null,
        state: null,
        postal_code: null,
        address_phone: null,
        customer_phone: null,
      })
      .mockResolvedValueOnce(null)
    vi.mocked(db.queryMany).mockResolvedValueOnce([]).mockResolvedValueOnce([])
    vi.mocked(db.query).mockResolvedValue({ rows: [] } as any)

    const res = await GET(makeReq() as any, PARAMS)
    expect(res.status).toBe(200)
    const args = vi.mocked(invoicePdf.generateInvoicePDF).mock.calls[0]
    const buyer = args[3] as any
    expect(buyer.full_name).toBe('')
    expect(buyer.address_line1).toBe('')
    expect(buyer.address_line2).toBeNull()
    expect(buyer.city).toBe('')
    expect(buyer.state).toBe('')
    expect(buyer.postal_code).toBe('')
    expect(buyer.phone).toBe('')
  })

  // Covers lines 72-73: settingsRows with a null value (row.value || '')
  it('handles settings row with null value by falling back to empty string', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(USER as any)
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(null)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce(BASE)
      .mockResolvedValueOnce(null)
    // Return settings rows where some values are null
    vi.mocked(db.queryMany)
      .mockResolvedValueOnce([])  // order items
      .mockResolvedValueOnce([
        { key: 'business_gstin', value: null },
        { key: 'business_legal_name', value: 'Jeffi' },
      ])
    vi.mocked(db.query).mockResolvedValue({ rows: [] } as any)

    const res = await GET(makeReq() as any, PARAMS)
    expect(res.status).toBe(200)
    const args = vi.mocked(invoicePdf.generateInvoicePDF).mock.calls[0]
    const biz = args[2] as any
    expect(biz.gstin).toBe('')
    expect(biz.legalName).toBe('Jeffi')
  })

  // Covers lines 161-167: billing address fallback fields when all are null
  it('falls back to empty strings for null billing address fields', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(USER as any)
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(null)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce({ ...BASE, billing_address_id: 'addr-2' })
      .mockResolvedValueOnce(null)  // no cached pdf
      .mockResolvedValueOnce({      // billing address with null fields
        full_name: null,
        address_line1: null,
        address_line2: null,
        city: null,
        state: null,
        postal_code: null,
        phone: null,
      })
    vi.mocked(db.queryMany).mockResolvedValueOnce([]).mockResolvedValueOnce([])
    vi.mocked(db.query).mockResolvedValue({ rows: [] } as any)

    const res = await GET(makeReq() as any, PARAMS)
    expect(res.status).toBe(200)
    const args = vi.mocked(invoicePdf.generateInvoicePDF).mock.calls[0]
    const billing = args[4] as any
    expect(billing).toBeDefined()
    expect(billing.full_name).toBe('')
    expect(billing.address_line1).toBe('')
    expect(billing.city).toBe('')
    expect(billing.phone).toBe('')
  })

  // Covers items line 115: orderItems || [] when queryMany returns null
  it('handles null orderItems gracefully', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(USER as any)
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(null)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce(BASE)
      .mockResolvedValueOnce(null)
    vi.mocked(db.queryMany)
      .mockResolvedValueOnce(null as any)   // null orderItems
      .mockResolvedValueOnce([])
    vi.mocked(db.query).mockResolvedValue({ rows: [] } as any)

    const res = await GET(makeReq() as any, PARAMS)
    expect(res.status).toBe(200)
    const args = vi.mocked(invoicePdf.generateInvoicePDF).mock.calls[0]
    expect(args[1]).toEqual([])
  })
})

describe('POST /api/orders/[id]/invoice — extra coverage', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 when admin not authenticated', async () => {
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(null)
    const res = await POST(makeReq('POST') as any, PARAMS)
    expect(res.status).toBe(401)
  })

  it('returns 404 when order not found in POST', async () => {
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce(null)
    const res = await POST(makeReq('POST') as any, PARAMS)
    expect(res.status).toBe(404)
  })

  it('returns existing invoice when already exists', async () => {
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce({
      id: 'order-1', invoice_number: 'INV-EXISTING', payment_status: 'paid', status: 'confirmed',
    })
    const res = await POST(makeReq('POST') as any, PARAMS)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.invoiceNumber).toBe('INV-EXISTING')
  })

  it('returns 400 when payment not completed', async () => {
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce({
      id: 'order-1', invoice_number: null, payment_status: 'unpaid', status: 'confirmed',
    })
    const res = await POST(makeReq('POST') as any, PARAMS)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/payment/i)
  })

  it('returns 400 when status is pending', async () => {
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce({
      id: 'order-1', invoice_number: null, payment_status: 'paid', status: 'pending',
    })
    const res = await POST(makeReq('POST') as any, PARAMS)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/pending/i)
  })

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

  it('returns 400 when generateOrderInvoice returns null', async () => {
    const invoiceMod = await import('@/lib/invoice')
    vi.mocked(invoiceMod.generateOrderInvoice).mockResolvedValueOnce(null)
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce({ id: 'order-1', invoice_number: null, payment_status: 'paid', status: 'confirmed' })
    const res = await POST(makeReq('POST') as any, PARAMS)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/generation failed/i)
  })

  it('returns success with invoice number after generation', async () => {
    const invoiceMod = await import('@/lib/invoice')
    vi.mocked(invoiceMod.generateOrderInvoice).mockResolvedValueOnce(Buffer.from('pdf'))
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce({ id: 'order-1', invoice_number: null, payment_status: 'paid', status: 'confirmed' })
      .mockResolvedValueOnce({ invoice_number: 'NEW-INV-001' })
    const res = await POST(makeReq('POST') as any, PARAMS)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.invoiceNumber).toBe('NEW-INV-001')
  })
})
