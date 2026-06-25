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
  generateInvoicePDF: vi.fn().mockResolvedValue(Buffer.from('pdf-data')),
}))
vi.mock('@/lib/receipt-pdf', () => ({
  generateReceiptPDF: vi.fn().mockResolvedValue(Buffer.from('receipt-data')),
}))
vi.mock('@/lib/s3', () => ({
  uploadInvoicePDF: vi.fn().mockResolvedValue('https://s3.example.com/invoice.pdf'),
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
import * as invoiceLib from '@/lib/invoice'

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
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce(MOCK_ORDER)
      .mockResolvedValueOnce(null) // no invoice record
    vi.mocked(db.queryMany).mockResolvedValueOnce([]).mockResolvedValueOnce([])
    vi.mocked(db.query).mockResolvedValue({ rows: [] } as any)
    const res = await GET(makeRequest() as any, PARAMS)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('application/pdf')
    expect(invoicePdf.generateInvoicePDF).toHaveBeenCalled()
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

  it('returns 500 on unexpected error', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockRejectedValue(new Error('DB error'))
    vi.mocked(jwt.authenticateAdmin).mockRejectedValue(new Error('DB error'))
    const res = await GET(makeRequest() as any, PARAMS)
    expect(res.status).toBe(500)
  })
})

describe('POST /api/orders/[id]/invoice', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when not admin', async () => {
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(null)
    const res = await POST(makeRequest('POST') as any, PARAMS)
    expect(res.status).toBe(401)
  })

  it('returns 404 when order not found', async () => {
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce(null)
    const res = await POST(makeRequest('POST') as any, PARAMS)
    expect(res.status).toBe(404)
  })

  it('returns existing invoice number if already invoiced', async () => {
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce({ id: 'order-123', invoice_number: 'INV-001', payment_status: 'paid', status: 'confirmed' })
    const res = await POST(makeRequest('POST') as any, PARAMS)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.invoiceNumber).toBe('INV-001')
  })

  it('returns 400 when payment not completed', async () => {
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce({ id: 'order-123', invoice_number: null, payment_status: 'unpaid', status: 'confirmed' })
    const res = await POST(makeRequest('POST') as any, PARAMS)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/payment/i)
  })

  it('returns 400 for pending orders', async () => {
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce({ id: 'order-123', invoice_number: null, payment_status: 'paid', status: 'pending' })
    const res = await POST(makeRequest('POST') as any, PARAMS)
    expect(res.status).toBe(400)
  })

  it('returns 400 when generateOrderInvoice returns null', async () => {
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce({ id: 'order-123', invoice_number: null, payment_status: 'paid', status: 'confirmed' })
    vi.mocked(invoiceLib.generateOrderInvoice).mockResolvedValueOnce(null as any)
    const res = await POST(makeRequest('POST') as any, PARAMS)
    expect(res.status).toBe(400)
  })

  it('generates invoice successfully', async () => {
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce({ id: 'order-123', invoice_number: null, payment_status: 'paid', status: 'confirmed' })
      .mockResolvedValueOnce({ invoice_number: 'INV-002' })
    const res = await POST(makeRequest('POST') as any, PARAMS)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.invoiceNumber).toBe('INV-002')
  })

  it('returns 500 on unexpected error', async () => {
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(db.queryOne).mockRejectedValue(new Error('DB error'))
    const res = await POST(makeRequest('POST') as any, PARAMS)
    expect(res.status).toBe(500)
  })
})
