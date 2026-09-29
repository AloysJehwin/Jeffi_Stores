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
