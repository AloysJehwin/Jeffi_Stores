import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
  withTransaction: vi.fn(),
}))
vi.mock('@/lib/invoice-pdf', () => ({
  generateInvoicePDF: vi.fn(),
}))
vi.mock('@/lib/receipt-pdf', () => ({
  generateReceiptPDF: vi.fn(),
}))

import { GET } from '@/app/api/public/invoice/[token]/pdf/route'
import { queryOne, queryMany } from '@/lib/db'
import { generateInvoicePDF } from '@/lib/invoice-pdf'
import { generateReceiptPDF } from '@/lib/receipt-pdf'

const mockQueryOne = vi.mocked(queryOne)
const mockQueryMany = vi.mocked(queryMany)
const mockGenerateInvoice = vi.mocked(generateInvoicePDF)
const mockGenerateReceipt = vi.mocked(generateReceiptPDF)

const params = { params: Promise.resolve({ token: 'tok-abc' }) }

function makeRequest() {
  return new Request('http://localhost/api/public/invoice/tok-abc/pdf')
}

const baseOrder = {
  id: 'order1',
  invoice_number: 'INV/2024/001',
  order_number: 'ORD-001',
  customer_name: 'Test Customer',
  total_amount: '1000',
  subtotal: '847.46',
  tax_amount: '152.54',
  discount_amount: '0',
  shipping_amount: '0',
  taxable_amount: '847.46',
  cgst_amount: '76.27',
  sgst_amount: '76.27',
  igst_amount: '0',
  is_igst: false,
  source: 'online',
  status: 'delivered',
  payment_status: 'paid',
  created_at: '2024-01-01T00:00:00Z',
  invoice_date: '2024-01-01',
  city: 'Mumbai',
  state: 'Maharashtra',
  full_name: 'Test Customer',
  address_line1: '123 Main St',
  address_line2: null,
  postal_code: '400001',
  address_phone: '9876543210',
  billing_address_id: null,
  shipping_address_id: 'addr1',
  buyer_gstin: null,
  irn: null,
  irn_ack_no: null,
  irn_ack_dt: null,
  signed_qr: null,
  payment_link_url: null,
  eway_bill_no: null,
  tracking_number: '',
  shipped_at: '',
  shipping_method: '',
  payment_mode: null,
  notes: '',
  customer_phone: '',
}

const mockItems = [
  {
    product_name: 'Hex Bolt M6',
    hsn_code: '7318',
    gst_rate: '18',
    quantity: 10,
    unit_price: '50',
    total_price: '500',
    taxable_amount: '423.73',
    cgst_amount: '38.14',
    sgst_amount: '38.14',
    igst_amount: '0',
    buy_mode: 'unit',
    buy_unit: null,
  },
]

const mockSettings = [
  { key: 'business_gstin', value: '29ABCDE1234F1Z5' },
  { key: 'business_legal_name', value: 'Jeffi Stores Pvt Ltd' },
  { key: 'business_trade_name', value: 'Jeffi Stores' },
  { key: 'business_address', value: 'Chennai, TN' },
  { key: 'business_state', value: 'Tamil Nadu' },
  { key: 'business_state_code', value: '33' },
  { key: 'business_phone', value: '9999999999' },
  { key: 'business_email', value: 'info@jeffistores.com' },
  { key: 'bank_name', value: 'HDFC' },
  { key: 'bank_account', value: '123456789' },
  { key: 'bank_ifsc', value: 'HDFC0001234' },
  { key: 'bank_branch', value: 'Chennai' },
]

describe('GET /api/public/invoice/[token]/pdf', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns 404 when order not found', async () => {
    mockQueryOne.mockResolvedValueOnce(null)
    const res = await GET(makeRequest() as any, params as any)
    expect(res.status).toBe(404)
  })

  it('calls generateInvoicePDF for normal order and returns PDF binary', async () => {
    const pdfBuffer = Buffer.from('fake-invoice-pdf')
    mockQueryOne.mockResolvedValueOnce(baseOrder)
    mockQueryMany.mockResolvedValueOnce(mockItems).mockResolvedValueOnce(mockSettings)
    mockGenerateInvoice.mockResolvedValueOnce(pdfBuffer as any)

    const res = await GET(makeRequest() as any, params as any)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/pdf')
    expect(res.headers.get('content-disposition')).toContain('INV-2024-001.pdf')
    expect(mockGenerateInvoice).toHaveBeenCalledTimes(1)
    expect(mockGenerateReceipt).not.toHaveBeenCalled()
  })

  it('calls generateReceiptPDF for cash_sale orders', async () => {
    const cashOrder = { ...baseOrder, source: 'cash_sale', invoice_number: 'RCPT/2024/001' }
    const pdfBuffer = Buffer.from('fake-receipt-pdf')
    mockQueryOne.mockResolvedValueOnce(cashOrder)
    mockQueryMany.mockResolvedValueOnce(mockItems).mockResolvedValueOnce(mockSettings)
    mockGenerateReceipt.mockResolvedValueOnce(pdfBuffer as any)

    const res = await GET(makeRequest() as any, params as any)
    expect(res.status).toBe(200)
    expect(mockGenerateReceipt).toHaveBeenCalledTimes(1)
    expect(mockGenerateInvoice).not.toHaveBeenCalled()
  })

  it('fetches billing address when billing_address_id differs from shipping_address_id', async () => {
    const orderWithBilling = {
      ...baseOrder,
      billing_address_id: 'addr2',
      shipping_address_id: 'addr1',
    }
    const pdfBuffer = Buffer.from('pdf')
    mockQueryOne
      .mockResolvedValueOnce(orderWithBilling)  // order
      .mockResolvedValueOnce({                  // billing address
        full_name: 'Billing Name',
        address_line1: '456 Other St',
        address_line2: null,
        city: 'Delhi',
        state: 'Delhi',
        postal_code: '110001',
        phone: '8888888888',
      })
    mockQueryMany.mockResolvedValueOnce(mockItems).mockResolvedValueOnce(mockSettings)
    mockGenerateInvoice.mockResolvedValueOnce(pdfBuffer as any)

    const res = await GET(makeRequest() as any, params as any)
    expect(res.status).toBe(200)
    // generateInvoicePDF called with billingAddress as 5th arg
    const callArgs = mockGenerateInvoice.mock.calls[0]
    expect(callArgs[4]).toBeDefined()
    expect((callArgs[4] as any).city).toBe('Delhi')
  })

  it('returns 500 when PDF generation throws', async () => {
    mockQueryOne.mockResolvedValueOnce(baseOrder)
    mockQueryMany.mockResolvedValueOnce(mockItems).mockResolvedValueOnce(mockSettings)
    mockGenerateInvoice.mockRejectedValueOnce(new Error('pdf error'))

    const res = await GET(makeRequest() as any, params as any)
    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json.error).toBe('pdf error')
  })

  it('marks cancelled order with isCancelled=true', async () => {
    const cancelledOrder = { ...baseOrder, status: 'cancelled' }
    const pdfBuffer = Buffer.from('pdf')
    mockQueryOne.mockResolvedValueOnce(cancelledOrder)
    mockQueryMany.mockResolvedValueOnce(mockItems).mockResolvedValueOnce(mockSettings)
    mockGenerateInvoice.mockResolvedValueOnce(pdfBuffer as any)

    await GET(makeRequest() as any, params as any)
    const callArgs = mockGenerateInvoice.mock.calls[0]
    expect(callArgs[5]).toBe(true) // isCancelled
    expect(callArgs[6]).toBe('CANCELLED') // voidLabel
  })

  it('marks returned order with voidLabel=RETURNED', async () => {
    const returnedOrder = { ...baseOrder, status: 'returned' }
    const pdfBuffer = Buffer.from('pdf')
    mockQueryOne.mockResolvedValueOnce(returnedOrder)
    mockQueryMany.mockResolvedValueOnce(mockItems).mockResolvedValueOnce(mockSettings)
    mockGenerateInvoice.mockResolvedValueOnce(pdfBuffer as any)

    await GET(makeRequest() as any, params as any)
    const callArgs = mockGenerateInvoice.mock.calls[0]
    expect(callArgs[6]).toBe('RETURNED')
  })

  it('uses created_at when invoice_date is null (hits || fallback)', async () => {
    const orderNoDate = { ...baseOrder, invoice_date: null }
    const pdfBuffer = Buffer.from('pdf')
    mockQueryOne.mockResolvedValueOnce(orderNoDate)
    mockQueryMany.mockResolvedValueOnce(mockItems).mockResolvedValueOnce(mockSettings)
    mockGenerateInvoice.mockResolvedValueOnce(pdfBuffer as any)

    const res = await GET(makeRequest() as any, params as any)
    expect(res.status).toBe(200)
    const callArgs = mockGenerateInvoice.mock.calls[0]
    expect((callArgs[0] as any).invoice_date).toBe(baseOrder.created_at)
  })

  it('falls back to customer_phone when address_phone is null', async () => {
    const orderNoAddrPhone = { ...baseOrder, address_phone: null, customer_phone: '1111111111' }
    const pdfBuffer = Buffer.from('pdf')
    mockQueryOne.mockResolvedValueOnce(orderNoAddrPhone)
    mockQueryMany.mockResolvedValueOnce(mockItems).mockResolvedValueOnce(mockSettings)
    mockGenerateInvoice.mockResolvedValueOnce(pdfBuffer as any)

    const res = await GET(makeRequest() as any, params as any)
    expect(res.status).toBe(200)
    const callArgs = mockGenerateInvoice.mock.calls[0]
    expect((callArgs[3] as any).phone).toBe('1111111111')
  })

  it('uses empty settings fallbacks when settings rows are absent', async () => {
    const pdfBuffer = Buffer.from('pdf')
    mockQueryOne.mockResolvedValueOnce(baseOrder)
    mockQueryMany.mockResolvedValueOnce(mockItems).mockResolvedValueOnce([]) // no settings
    mockGenerateInvoice.mockResolvedValueOnce(pdfBuffer as any)

    const res = await GET(makeRequest() as any, params as any)
    expect(res.status).toBe(200)
    const callArgs = mockGenerateInvoice.mock.calls[0]
    expect((callArgs[2] as any).gstin).toBe('')
    expect((callArgs[2] as any).bankName).toBe('')
  })

  it('handles item with null optional fields (hits || fallbacks in item mapping)', async () => {
    const sparseItem = {
      product_name: 'Widget',
      hsn_code: null,
      gst_rate: null,
      quantity: 1,
      unit_price: '100',
      total_price: '100',
      taxable_amount: null,
      cgst_amount: null,
      sgst_amount: null,
      igst_amount: null,
      buy_mode: null,
      buy_unit: null,
      discount_amount: null,
      mrp: null,
    }
    const pdfBuffer = Buffer.from('pdf')
    mockQueryOne.mockResolvedValueOnce(baseOrder)
    mockQueryMany.mockResolvedValueOnce([sparseItem]).mockResolvedValueOnce(mockSettings)
    mockGenerateInvoice.mockResolvedValueOnce(pdfBuffer as any)

    const res = await GET(makeRequest() as any, params as any)
    expect(res.status).toBe(200)
    const callArgs = mockGenerateInvoice.mock.calls[0]
    const item = (callArgs[1] as any[])[0]
    expect(item.hsn_code).toBeNull()
    expect(item.buy_mode).toBe('unit')
  })

  it('handles cash_sale with null optional fields (hits || fallbacks in receiptOrder)', async () => {
    const cashOrder = {
      ...baseOrder,
      source: 'cash_sale',
      invoice_date: null,
      payment_mode: null,
      notes: null,
      taxable_amount: null,
      cgst_amount: null,
      sgst_amount: null,
      igst_amount: null,
      is_igst: null,
    }
    const pdfBuffer = Buffer.from('receipt-pdf')
    mockQueryOne.mockResolvedValueOnce(cashOrder)
    mockQueryMany.mockResolvedValueOnce(mockItems).mockResolvedValueOnce(mockSettings)
    mockGenerateReceipt.mockResolvedValueOnce(pdfBuffer as any)

    const res = await GET(makeRequest() as any, params as any)
    expect(res.status).toBe(200)
    expect(mockGenerateReceipt).toHaveBeenCalledTimes(1)
    const callArgs = mockGenerateReceipt.mock.calls[0]
    expect((callArgs[0] as any).payment_mode).toBe('Cash')
    expect((callArgs[0] as any).notes).toBe('')
    expect((callArgs[0] as any).is_igst).toBe(false)
  })

  it('skips billingAddress when billing_address_id lookup returns null', async () => {
    const orderWithBilling = { ...baseOrder, billing_address_id: 'addr2', shipping_address_id: 'addr1' }
    const pdfBuffer = Buffer.from('pdf')
    mockQueryOne
      .mockResolvedValueOnce(orderWithBilling)
      .mockResolvedValueOnce(null) // billing address not found
    mockQueryMany.mockResolvedValueOnce(mockItems).mockResolvedValueOnce(mockSettings)
    mockGenerateInvoice.mockResolvedValueOnce(pdfBuffer as any)

    const res = await GET(makeRequest() as any, params as any)
    expect(res.status).toBe(200)
    const callArgs = mockGenerateInvoice.mock.calls[0]
    expect(callArgs[4]).toBeUndefined()
  })
})
