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
    vi.mocked(db.queryOne).mockResolvedValueOnce({
      id: 'order-123',
      invoice_number: 'INV-001',
      payment_status: 'paid',
      status: 'confirmed',
    })
    const res = await POST(makeRequest('POST') as any, PARAMS)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.invoiceNumber).toBe('INV-001')
  })

  it('returns 400 when payment not completed', async () => {
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce({
      id: 'order-123',
      invoice_number: null,
      payment_status: 'unpaid',
      status: 'confirmed',
    })
    const res = await POST(makeRequest('POST') as any, PARAMS)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/payment/i)
  })

  it('returns 400 for pending orders', async () => {
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce({
      id: 'order-123',
      invoice_number: null,
      payment_status: 'paid',
      status: 'pending',
    })
    const res = await POST(makeRequest('POST') as any, PARAMS)
    expect(res.status).toBe(400)
  })

  it('returns 400 for cancelled orders', async () => {
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce({
      id: 'order-123',
      invoice_number: null,
      payment_status: 'paid',
      status: 'cancelled',
    })
    const res = await POST(makeRequest('POST') as any, PARAMS)
    expect(res.status).toBe(400)
  })

  it('returns 400 when generateOrderInvoice returns null', async () => {
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce({
      id: 'order-123',
      invoice_number: null,
      payment_status: 'paid',
      status: 'confirmed',
    })
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

describe('POST /api/orders/[id]/invoice — extra coverage', () => {
  const ADMIN = { adminId: 'admin-1', username: 'root', role: 'super_admin', scopes: [] }
  const PARAMS = { params: Promise.resolve({ id: 'order-1' }) }

  function makeReq(method = 'GET') {
    return new Request('http://localhost/api/orders/order-1/invoice', { method })
  }

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
      id: 'order-1',
      invoice_number: 'INV-EXISTING',
      payment_status: 'paid',
      status: 'confirmed',
    })
    const res = await POST(makeReq('POST') as any, PARAMS)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.invoiceNumber).toBe('INV-EXISTING')
  })

  it('returns 400 when payment not completed', async () => {
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce({
      id: 'order-1',
      invoice_number: null,
      payment_status: 'unpaid',
      status: 'confirmed',
    })
    const res = await POST(makeReq('POST') as any, PARAMS)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/payment/i)
  })

  it('returns 400 when status is pending', async () => {
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce({
      id: 'order-1',
      invoice_number: null,
      payment_status: 'paid',
      status: 'pending',
    })
    const res = await POST(makeReq('POST') as any, PARAMS)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/pending/i)
  })

  it('returns 400 when status is cancelled', async () => {
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce({
      id: 'order-1',
      invoice_number: null,
      payment_status: 'paid',
      status: 'cancelled',
    })
    const res = await POST(makeReq('POST') as any, PARAMS)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/cancelled/i)
  })

  it('returns 400 when generateOrderInvoice returns null', async () => {
    const invoiceMod = await import('@/lib/documents/invoice')
    vi.mocked(invoiceMod.generateOrderInvoice).mockResolvedValueOnce(null)
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce({
      id: 'order-1',
      invoice_number: null,
      payment_status: 'paid',
      status: 'confirmed',
    })
    const res = await POST(makeReq('POST') as any, PARAMS)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/generation failed/i)
  })

  it('returns success with invoice number after generation', async () => {
    const invoiceMod = await import('@/lib/documents/invoice')
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
