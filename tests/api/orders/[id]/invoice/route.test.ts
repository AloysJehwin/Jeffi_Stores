import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth/jwt', () => ({
  authenticateAnyUser: vi.fn(),
  authenticateAdmin: vi.fn(),
}))
vi.mock('@/lib/shared/db', () => ({
  queryOne: vi.fn(),
  queryMany: vi.fn(),
  query: vi.fn(),
}))
vi.mock('@/lib/documents/invoice-pdf', () => ({
  generateInvoicePDF: vi.fn().mockResolvedValue(Buffer.from('pdf-data')),
}))
vi.mock('@/lib/documents/receipt-pdf', () => ({
  generateReceiptPDF: vi.fn().mockResolvedValue(Buffer.from('receipt-data')),
}))
vi.mock('@/lib/shared/s3', () => ({
  uploadInvoicePDF: vi.fn().mockResolvedValue('https://s3.example.com/invoice.pdf'),
}))
vi.mock('@/lib/catalog/gst', () => ({
  getFinancialYear: vi.fn().mockReturnValue('2024-25'),
  round2: (n: number) => Math.round(n * 100) / 100,
}))
vi.mock('@/lib/documents/invoice', () => ({
  generateOrderInvoice: vi.fn().mockResolvedValue(Buffer.from('invoice-data')),
}))

import { GET, POST } from '@/app/api/orders/[id]/invoice/route'
import * as jwt from '@/lib/auth/jwt'
import * as db from '@/lib/shared/db'
import * as invoicePdf from '@/lib/documents/invoice-pdf'
import * as receiptPdf from '@/lib/documents/receipt-pdf'
import * as invoiceLib from '@/lib/documents/invoice'

const USER = { userId: 'user-1', isBusiness: false }
const ADMIN = { adminId: 'admin-1', username: 'admin', role: 'super_admin', scopes: [] }
const PARAMS = { params: Promise.resolve({ id: 'order-123' }) }

const MOCK_ORDER = {
  id: 'order-123',
  order_number: 'ORD-001',
  invoice_number: 'INV-001',
  invoice_date: '2024-01-01',
  created_at: '2024-01-01T00:00:00Z',
  status: 'confirmed',
  payment_status: 'paid',
  source: 'web',
  user_id: 'user-1',
  customer_name: 'Test User',
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
  full_name: 'Test User',
  address_line1: '123 Main St',
  address_line2: null,
  city: 'Mumbai',
  state: 'Maharashtra',
  postal_code: '400001',
  address_phone: '9999999999',
  billing_address_id: null,
  shipping_address_id: 'addr-1',
}

function makeRequest(method = 'GET') {
  return new Request('http://localhost/api/orders/order-123/invoice', { method })
}

describe('GET /api/orders/[id]/invoice', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(db.queryMany).mockResolvedValue([])
  })

  it('returns 401 when not authenticated', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(null)
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(null)
    const res = await GET(makeRequest() as any, PARAMS)
    expect(res.status).toBe(401)
  })

  it('returns 404 when order not found', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(USER as any)
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(null)
    vi.mocked(db.queryOne).mockResolvedValueOnce(null)
    const res = await GET(makeRequest() as any, PARAMS)
    expect(res.status).toBe(404)
  })

  it('returns 403 when user tries to access another users order', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue({ userId: 'other-user' } as any)
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(null)
    vi.mocked(db.queryOne).mockResolvedValueOnce({ ...MOCK_ORDER, user_id: 'user-1' })
    const res = await GET(makeRequest() as any, PARAMS)
    expect(res.status).toBe(403)
  })

  it('returns 404 when invoice not available', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(USER as any)
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(null)
    vi.mocked(db.queryOne).mockResolvedValueOnce({ ...MOCK_ORDER, invoice_number: null })
    const res = await GET(makeRequest() as any, PARAMS)
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toMatch(/not available/i)
  })

  it('redirects to cached PDF when available for non-voided order', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(USER as any)
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(null)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce(MOCK_ORDER)
      .mockResolvedValueOnce({ pdf_url: 'https://s3.example.com/invoice.pdf' })
    const res = await GET(makeRequest() as any, PARAMS)
    expect(res.status).toBe(307)
  })

  it('generates PDF for order without cached URL', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(USER as any)
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(null)
    vi.mocked(db.queryOne).mockResolvedValueOnce(MOCK_ORDER).mockResolvedValueOnce(null)
    vi.mocked(db.queryMany).mockResolvedValueOnce([]).mockResolvedValueOnce([])
    vi.mocked(db.query).mockResolvedValue({ rows: [] } as any)
    const res = await GET(makeRequest() as any, PARAMS)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('application/pdf')
    expect(invoicePdf.generateInvoicePDF).toHaveBeenCalled()
  })

  it('generates PDF when invoice record exists but pdf_url is null', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(USER as any)
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(null)
    vi.mocked(db.queryOne).mockResolvedValueOnce(MOCK_ORDER).mockResolvedValueOnce({ pdf_url: null })
    vi.mocked(db.queryMany).mockResolvedValueOnce([]).mockResolvedValueOnce([])
    vi.mocked(db.query).mockResolvedValue({ rows: [] } as any)
    const res = await GET(makeRequest() as any, PARAMS)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('application/pdf')
  })

  it('generates receipt PDF for cash_sale source', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(USER as any)
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(null)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce({ ...MOCK_ORDER, source: 'cash_sale' })
      .mockResolvedValueOnce(null)
    vi.mocked(db.queryMany).mockResolvedValueOnce([]).mockResolvedValueOnce([])
    const res = await GET(makeRequest() as any, PARAMS)
    expect(res.status).toBe(200)
    expect(receiptPdf.generateReceiptPDF).toHaveBeenCalled()
  })

  it('does not cache PDF for cash_sale orders', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(USER as any)
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(null)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce({ ...MOCK_ORDER, source: 'cash_sale' })
      .mockResolvedValueOnce(null)
    vi.mocked(db.queryMany).mockResolvedValueOnce([]).mockResolvedValueOnce([])
    const res = await GET(makeRequest() as any, PARAMS)
    expect(res.status).toBe(200)
    const { uploadInvoicePDF } = await import('@/lib/shared/s3')
    expect(uploadInvoicePDF).not.toHaveBeenCalled()
  })

  it('generates voided PDF for cancelled order without caching', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(USER as any)
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(null)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce({ ...MOCK_ORDER, status: 'cancelled' })
      .mockResolvedValueOnce(null)
    vi.mocked(db.queryMany).mockResolvedValueOnce([]).mockResolvedValueOnce([])
    const res = await GET(makeRequest() as any, PARAMS)
    expect(res.status).toBe(200)
    expect(invoicePdf.generateInvoicePDF).toHaveBeenCalled()
    const { uploadInvoicePDF } = await import('@/lib/shared/s3')
    expect(uploadInvoicePDF).not.toHaveBeenCalled()
  })

  it('generates voided PDF for returned order with RETURNED suffix in filename', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(USER as any)
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(null)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce({ ...MOCK_ORDER, status: 'returned' })
      .mockResolvedValueOnce(null)
    vi.mocked(db.queryMany).mockResolvedValueOnce([]).mockResolvedValueOnce([])
    const res = await GET(makeRequest() as any, PARAMS)
    expect(res.status).toBe(200)
    const disposition = res.headers.get('Content-Disposition') ?? ''
    expect(disposition).toContain('RETURNED')
  })

  it('admin can access any order', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(null)
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce({ ...MOCK_ORDER, user_id: 'some-other-user' })
      .mockResolvedValueOnce(null)
    vi.mocked(db.queryMany).mockResolvedValueOnce([]).mockResolvedValueOnce([])
    vi.mocked(db.query).mockResolvedValue({ rows: [] } as any)
    const res = await GET(makeRequest() as any, PARAMS)
    expect(res.status).toBe(200)
  })

  it('fetches billing address when billing_address_id differs from shipping_address_id', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(USER as any)
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(null)
    const orderWithBilling = {
      ...MOCK_ORDER,
      billing_address_id: 'addr-2',
      shipping_address_id: 'addr-1',
    }
    vi.mocked(db.queryOne).mockResolvedValueOnce(orderWithBilling).mockResolvedValueOnce(null).mockResolvedValueOnce({
      full_name: 'Billing Name',
      address_line1: '99 Billing Rd',
      address_line2: null,
      city: 'Pune',
      state: 'Maharashtra',
      postal_code: '411001',
      phone: '8888888888',
    })
    vi.mocked(db.queryMany).mockResolvedValueOnce([]).mockResolvedValueOnce([])
    vi.mocked(db.query).mockResolvedValue({ rows: [] } as any)
    const res = await GET(makeRequest() as any, PARAMS)
    expect(res.status).toBe(200)
    expect(invoicePdf.generateInvoicePDF).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ full_name: 'Billing Name' }),
      expect.any(Boolean),
      expect.any(String),
      expect.any(Boolean)
    )
  })

  it('skips billing address fetch when billing_address_id equals shipping_address_id', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(USER as any)
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(null)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce({ ...MOCK_ORDER, billing_address_id: 'addr-1', shipping_address_id: 'addr-1' })
      .mockResolvedValueOnce(null)
    vi.mocked(db.queryMany).mockResolvedValueOnce([]).mockResolvedValueOnce([])
    vi.mocked(db.query).mockResolvedValue({ rows: [] } as any)
    const res = await GET(makeRequest() as any, PARAMS)
    expect(res.status).toBe(200)
    expect(invoicePdf.generateInvoicePDF).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      undefined,
      expect.any(Boolean),
      expect.any(String),
      expect.any(Boolean)
    )
  })

  it('includes multi-item order items with sold_unit_factor and buy_unit in PDF', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(USER as any)
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(null)
    const orderItems = [
      {
        product_name: 'Widget A',
        hsn_code: '8471',
        gst_rate: '18',
        quantity: 2,
        unit_price: '100',
        total_price: '200',
        discount_amount: '0',
        mrp: '110',
        sold_unit_factor: null,
        taxable_amount: '169.49',
        cgst_amount: '15.25',
        sgst_amount: '15.25',
        igst_amount: '0',
        buy_mode: 'unit',
        buy_unit: null,
      },
      {
        product_name: 'Gadget B',
        hsn_code: '9403',
        gst_rate: '12',
        quantity: 1,
        unit_price: '500',
        total_price: '500',
        discount_amount: '10',
        mrp: '550',
        sold_unit_factor: '10',
        taxable_amount: '446.43',
        cgst_amount: '26.79',
        sgst_amount: '26.79',
        igst_amount: '0',
        buy_mode: 'pack',
        buy_unit: 'BOX',
      },
    ]
    vi.mocked(db.queryOne).mockResolvedValueOnce(MOCK_ORDER).mockResolvedValueOnce(null)
    vi.mocked(db.queryMany)
      .mockResolvedValueOnce(orderItems as any)
      .mockResolvedValueOnce([{ key: 'business_legal_name', value: 'Jeffi Stores' }] as any)
    vi.mocked(db.query).mockResolvedValue({ rows: [] } as any)
    const res = await GET(makeRequest() as any, PARAMS)
    expect(res.status).toBe(200)
    const [, items] = vi.mocked(invoicePdf.generateInvoicePDF).mock.calls[0]
    expect(items).toHaveLength(2)
    expect(items[1].sold_unit_factor).toBe(10)
    expect(items[1].buy_unit).toBe('BOX')
  })

  it('sets IGST fields when order.is_igst is true', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(USER as any)
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(null)
    const igstOrder = {
      ...MOCK_ORDER,
      is_igst: true,
      igst_amount: '90',
      cgst_amount: '0',
      sgst_amount: '0',
      buyer_gstin: '27AABCU9603R1ZM',
    }
    vi.mocked(db.queryOne).mockResolvedValueOnce(igstOrder).mockResolvedValueOnce(null)
    vi.mocked(db.queryMany).mockResolvedValueOnce([]).mockResolvedValueOnce([])
    vi.mocked(db.query).mockResolvedValue({ rows: [] } as any)
    const res = await GET(makeRequest() as any, PARAMS)
    expect(res.status).toBe(200)
    const [invoiceOrder] = vi.mocked(invoicePdf.generateInvoicePDF).mock.calls[0]
    expect(invoiceOrder.is_igst).toBe(true)
    expect(invoiceOrder.igst_amount).toBe(90)
  })

  it('uses address_phone fallback to customer_phone when address_phone is null', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(USER as any)
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(null)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce({ ...MOCK_ORDER, address_phone: null, customer_phone: '7777777777' })
      .mockResolvedValueOnce(null)
    vi.mocked(db.queryMany).mockResolvedValueOnce([]).mockResolvedValueOnce([])
    vi.mocked(db.query).mockResolvedValue({ rows: [] } as any)
    const res = await GET(makeRequest() as any, PARAMS)
    expect(res.status).toBe(200)
    const [, , , buyerAddress] = vi.mocked(invoicePdf.generateInvoicePDF).mock.calls[0]
    expect(buyerAddress.phone).toBe('7777777777')
  })

  it('returns 500 on unexpected error', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockRejectedValue(new Error('DB error'))
    vi.mocked(jwt.authenticateAdmin).mockRejectedValue(new Error('DB error'))
    const res = await GET(makeRequest() as any, PARAMS)
    expect(res.status).toBe(500)
  })
})
