import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/lib/jwt', () => ({
  authenticateAdmin: vi.fn(),
}))

vi.mock('@/lib/scopes', () => ({
  hasScope: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  queryOne: vi.fn(),
  queryMany: vi.fn(),
  query: vi.fn(),
  withTransaction: vi.fn(),
}))

vi.mock('@/lib/gst', () => ({
  isInterState: vi.fn(),
  generateInvoiceNumber: vi.fn(),
  getNextInvoiceSequence: vi.fn(),
  getFinancialYear: vi.fn(),
  round2: (n: number) => Math.round(n * 100) / 100,
}))

vi.mock('@/lib/inventory', () => ({
  logStockMovement: vi.fn(),
}))

vi.mock('@/lib/inventory-deduct', () => ({
  deductOrderStock: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/email', () => ({
  sendInvoiceFinalizedEmail: vi.fn(),
}))

vi.mock('@/lib/email-business', () => ({
  sendBusinessInvoiceGeneratedEmail: vi.fn(),
}))

vi.mock('@/lib/pricing', () => ({
  lineItemExGst: vi.fn(),
}))

vi.mock('@/lib/razorpay', () => ({
  getRazorpayInstance: vi.fn().mockReturnValue({
    qrCode: {
      create: vi.fn().mockResolvedValue({
        id: 'qr_test_123',
        image_url: 'https://rzp.io/qr/test.png',
      }),
    },
  }),
}))

vi.mock('sharp', () => {
  const sharp = vi.fn().mockReturnValue({
    metadata: vi.fn().mockResolvedValue({ width: 674, height: 1644 }),
    extract: vi.fn().mockReturnThis(),
    resize: vi.fn().mockReturnThis(),
    png: vi.fn().mockReturnThis(),
    toBuffer: vi.fn().mockResolvedValue(Buffer.from('fake-png-data')),
  })
  return { default: sharp }
})

// ---------------------------------------------------------------------------
// Import handler AFTER mocks
// ---------------------------------------------------------------------------

import { POST } from '@/app/api/admin/quotations/[id]/convert-to-invoice/route'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryOne, queryMany, query, withTransaction } from '@/lib/db'
import { sendInvoiceFinalizedEmail } from '@/lib/email'
import { sendBusinessInvoiceGeneratedEmail } from '@/lib/email-business'
import { isInterState, generateInvoiceNumber, getNextInvoiceSequence, getFinancialYear } from '@/lib/gst'
import { lineItemExGst } from '@/lib/pricing'
import { logStockMovement } from '@/lib/inventory'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ADMIN = { adminId: 'admin-1', id: 'admin-1', role: 'super_admin', scopes: ['quotations'] }
const QUOT_ID = '660e8400-e29b-41d4-a716-446655440002'

function postReq(body: unknown = {}) {
  return new NextRequest(new Request(
    `http://localhost/api/admin/quotations/${QUOT_ID}/convert-to-invoice`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  ))
}

const FINAL_QUOTATION = {
  id: QUOT_ID,
  status: 'final',
  converted_order_id: null,
  buyer_same: true,
  consignee_name: 'Acme Corp',
  consignee_phone: '9123456780',
  consignee_email: 'acme@example.com',
  consignee_addr1: '42 Main Rd',
  consignee_addr2: null,
  consignee_city: 'Chennai',
  consignee_state: 'Tamil Nadu',
  consignee_pincode: '600001',
  consignee_gstin: null,
  buyer_name: null,
  buyer_phone: null,
  buyer_email: null,
  buyer_state: null,
  buyer_gstin: null,
  quote_number: 'QT/24-25/APR/1',
  notes: null,
  from_rfq: false,
}

const QUOT_ITEMS = [
  {
    id: 'qi-1',
    product_id: '111e4567-e89b-12d3-a456-426614174001',
    variant_id: null,
    sub_variant_id: null,
    description: 'Widget A',
    quantity: '2',
    rate: '100',
    discount_pct: '0',
    gst_rate: '18',
    hsn_code: '8471',
    buy_unit: null,
    unit: 'PCS',
    sold_unit_factor: null,
  },
]

function makeTransactionClient(stockLevel = 100) {
  return {
    query: vi.fn()
      // INSERT addresses RETURNING id
      .mockResolvedValueOnce({ rows: [{ id: 'addr-uuid-1' }] })
      // stock check (products)
      .mockResolvedValueOnce({ rows: [{ inventory_quantity: stockLevel }] })
      // INSERT orders RETURNING id, order_number
      .mockResolvedValueOnce({ rows: [{ id: 'order-uuid-1', order_number: 'OFF-123' }] })
      // site_settings for invoice_prefix
      .mockResolvedValueOnce({ rows: [{ value: 'JS' }] })
      // getNextInvoiceSequence
      .mockResolvedValueOnce({ rows: [{ seq: 1 }] })
      // UPDATE orders invoice_number
      .mockResolvedValueOnce({ rows: [] })
      // INSERT invoices
      .mockResolvedValueOnce({ rows: [] })
      // INSERT order_items
      .mockResolvedValueOnce({ rows: [{ id: 'oi-1' }] })
      // stock deduction SELECT
      .mockResolvedValueOnce({ rows: [{ inventory_quantity: '100' }] })
      // stock deduction UPDATE
      .mockResolvedValueOnce({ rows: [] })
      // UPDATE quotations
      .mockResolvedValueOnce({ rows: [] }),
    release: vi.fn(),
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/admin/quotations/[id]/convert-to-invoice', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(withTransaction).mockImplementation(async (fn: any) => fn(makeTransactionClient()))
    vi.mocked(isInterState).mockReturnValue(false)
    vi.mocked(generateInvoiceNumber).mockReturnValue('JS/24-25/APR/1')
    vi.mocked(getNextInvoiceSequence).mockResolvedValue(1 as any)
    vi.mocked(getFinancialYear).mockReturnValue('24-25')
    vi.mocked(lineItemExGst).mockReturnValue(169.49)
    vi.mocked(logStockMovement).mockResolvedValue(undefined)
    vi.mocked(sendInvoiceFinalizedEmail).mockResolvedValue(undefined as any)
    vi.mocked(sendBusinessInvoiceGeneratedEmail).mockResolvedValue(undefined as any)
    vi.mocked(queryOne)
      .mockResolvedValueOnce(FINAL_QUOTATION as any)
      .mockResolvedValueOnce(null as any)
    vi.mocked(queryMany).mockResolvedValue(QUOT_ITEMS as any)
    vi.mocked(query).mockResolvedValue({ rows: [] } as any)
  })

  // --- Auth ---

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    const res = await POST(postReq(), { params: Promise.resolve({ id: QUOT_ID }) })
    expect(res.status).toBe(401)
  })

  it('returns 403 when quotations scope missing', async () => {
    vi.mocked(hasScope).mockReturnValue(false)
    const res = await POST(postReq(), { params: Promise.resolve({ id: QUOT_ID }) })
    expect(res.status).toBe(403)
  })

  // --- Not found / state guards ---

  it('returns 404 when quotation not found', async () => {
    vi.mocked(queryOne).mockReset()
    vi.mocked(queryOne).mockResolvedValue(null as any)
    const res = await POST(postReq(), { params: Promise.resolve({ id: QUOT_ID }) })
    expect(res.status).toBe(404)
  })

  it('returns 400 when quotation is not final', async () => {
    vi.mocked(queryOne).mockReset()
    vi.mocked(queryOne).mockResolvedValueOnce({ ...FINAL_QUOTATION, status: 'draft' } as any)
    const res = await POST(postReq(), { params: Promise.resolve({ id: QUOT_ID }) })
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/finalised/)
  })

  it('returns 400 when quotation already converted', async () => {
    vi.mocked(queryOne).mockReset()
    vi.mocked(queryOne).mockResolvedValueOnce({ ...FINAL_QUOTATION, converted_order_id: 'existing-order' } as any)
    const res = await POST(postReq(), { params: Promise.resolve({ id: QUOT_ID }) })
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/already been converted/)
  })

  it('returns 400 when quotation has no line items', async () => {
    vi.mocked(queryOne).mockReset()
    vi.mocked(queryOne)
      .mockResolvedValueOnce(FINAL_QUOTATION as any)
      .mockResolvedValueOnce(null as any)
    vi.mocked(queryMany).mockResolvedValue([] as any)
    const res = await POST(postReq(), { params: Promise.resolve({ id: QUOT_ID }) })
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/no line items/)
  })

  // --- Happy path ---

  it('returns orderId, orderNumber, invoiceNumber on success', async () => {
    vi.mocked(withTransaction).mockImplementation(async (fn: any) =>
      fn(makeTransactionClient()),
    )
    const res = await POST(postReq({ paymentMode: 'cash' }), { params: Promise.resolve({ id: QUOT_ID }) })
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(json.orderId).toBeDefined()
    expect(json.orderNumber).toBeDefined()
  })

  it('returns invoiceUrl when invoice_number is generated', async () => {
    vi.mocked(withTransaction).mockImplementation(async (fn: any) =>
      fn(makeTransactionClient()),
    )
    const res = await POST(postReq({ paymentMode: 'cash' }), { params: Promise.resolve({ id: QUOT_ID }) })
    const json = await res.json()
    expect(json.invoiceUrl).toMatch(/\/api\/orders\//)
  })

  // --- Draft fallback when insufficient stock ---

  it('saves as draft and returns savedAsDraft=true when stock is low', async () => {
    vi.mocked(withTransaction).mockImplementation(async (fn: any) => {
      const client = {
        query: vi.fn()
          .mockResolvedValueOnce({ rows: [{ id: 'addr-uuid-1' }] })
          .mockResolvedValueOnce({ rows: [{ inventory_quantity: 0 }] })
          .mockResolvedValueOnce({ rows: [{ id: 'order-uuid-2', order_number: 'OFF-456' }] })
          .mockResolvedValueOnce({ rows: [{ id: 'oi-1' }] })
          .mockResolvedValueOnce({ rows: [] }),
        release: vi.fn(),
      }
      return fn(client)
    })

    const res = await POST(postReq({ paymentMode: 'cash' }), { params: Promise.resolve({ id: QUOT_ID }) })
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.savedAsDraft).toBe(true)
    expect(json.insufficientItems).toBeInstanceOf(Array)
  })

  it('sets invoiceUrl to null when savedAsDraft (no invoice_number)', async () => {
    vi.mocked(withTransaction).mockImplementation(async (fn: any) => {
      const client = {
        query: vi.fn()
          .mockResolvedValueOnce({ rows: [{ id: 'addr-uuid-1' }] })
          .mockResolvedValueOnce({ rows: [{ inventory_quantity: 0 }] })
          .mockResolvedValueOnce({ rows: [{ id: 'order-uuid-2', order_number: 'OFF-456' }] })
          .mockResolvedValueOnce({ rows: [{ id: 'oi-1' }] })
          .mockResolvedValueOnce({ rows: [] }),
        release: vi.fn(),
      }
      return fn(client)
    })
    const res = await POST(postReq({ paymentMode: 'cash' }), { params: Promise.resolve({ id: QUOT_ID }) })
    const json = await res.json()
    expect(json.invoiceUrl).toBeNull()
  })

  it('does not send emails when result.saveAsDraft is true', async () => {
    vi.mocked(withTransaction).mockImplementation(async (fn: any) => {
      const client = {
        query: vi.fn()
          .mockResolvedValueOnce({ rows: [{ id: 'addr-uuid-1' }] })
          .mockResolvedValueOnce({ rows: [{ inventory_quantity: 0 }] })
          .mockResolvedValueOnce({ rows: [{ id: 'order-uuid-2', order_number: 'OFF-456' }] })
          .mockResolvedValueOnce({ rows: [{ id: 'oi-1' }] })
          .mockResolvedValueOnce({ rows: [] }),
        release: vi.fn(),
      }
      return fn(client)
    })
    await POST(postReq({ paymentMode: 'cash' }), { params: Promise.resolve({ id: QUOT_ID }) })
    expect(sendInvoiceFinalizedEmail).not.toHaveBeenCalled()
    expect(sendBusinessInvoiceGeneratedEmail).not.toHaveBeenCalled()
  })

  // --- enableDelivery flag ---

  it('sets needsDelivery=true when enableDelivery=true and stock is sufficient', async () => {
    vi.mocked(withTransaction).mockImplementation(async (fn: any) =>
      fn(makeTransactionClient()),
    )
    const res = await POST(postReq({ paymentMode: 'cash', enableDelivery: true }), { params: Promise.resolve({ id: QUOT_ID }) })
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.needsDelivery).toBe(true)
  })

  it('saves as draft (processing) when insufficient stock + enableDelivery=true', async () => {
    vi.mocked(withTransaction).mockImplementation(async (fn: any) => {
      const client = {
        query: vi.fn()
          .mockResolvedValueOnce({ rows: [{ id: 'addr-uuid-1' }] })
          .mockResolvedValueOnce({ rows: [{ inventory_quantity: 0 }] })
          .mockResolvedValueOnce({ rows: [{ id: 'order-uuid-3', order_number: 'OFF-789' }] })
          .mockResolvedValueOnce({ rows: [{ id: 'oi-1' }] })
          .mockResolvedValueOnce({ rows: [] }),
        release: vi.fn(),
      }
      return fn(client)
    })
    const res = await POST(
      postReq({ paymentMode: 'cash', enableDelivery: true }),
      { params: Promise.resolve({ id: QUOT_ID }) }
    )
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.savedAsDraft).toBe(true)
    // saveAsDraft prevents needsDelivery from being true
    expect(json.needsDelivery).toBe(false)
  })

  // --- Payment modes ---

  it('marks order as unpaid for upi_qr paymentMode and returns qrImageUrl', async () => {
    vi.mocked(withTransaction).mockImplementation(async (fn: any) =>
      fn(makeTransactionClient()),
    )
    const res = await POST(postReq({ paymentMode: 'upi_qr' }), { params: Promise.resolve({ id: QUOT_ID }) })
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json).toHaveProperty('qrImageUrl')
  })

  it('handles upi_qr QR creation failure gracefully (non-fatal)', async () => {
    vi.mocked(withTransaction).mockImplementation(async (fn: any) =>
      fn(makeTransactionClient()),
    )
    const { getRazorpayInstance } = await import('@/lib/razorpay')
    vi.mocked(getRazorpayInstance).mockReturnValue({
      qrCode: { create: vi.fn().mockRejectedValue(new Error('RZP down')) },
    } as any)
    const res = await POST(postReq({ paymentMode: 'upi_qr' }), { params: Promise.resolve({ id: QUOT_ID }) })
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(json.qrImageUrl).toBeNull()
  })

  it('marks order as paid for bank_transfer paymentMode', async () => {
    vi.mocked(withTransaction).mockImplementation(async (fn: any) =>
      fn(makeTransactionClient()),
    )
    const res = await POST(postReq({ paymentMode: 'bank_transfer' }), { params: Promise.resolve({ id: QUOT_ID }) })
    expect(res.status).toBe(200)
  })

  // --- Buyer ≠ consignee path ---

  it('uses buyer contact details when buyer_same is false', async () => {
    vi.mocked(queryOne)
      .mockResolvedValueOnce({
        ...FINAL_QUOTATION,
        buyer_same: false,
        buyer_name: 'Buyer Corp',
        buyer_phone: '9000000000',
        buyer_email: 'buyer@example.com',
        buyer_state: 'Karnataka',
        buyer_gstin: '29AABCU9603R1ZX',
      } as any)
      .mockResolvedValueOnce(null as any)

    vi.mocked(withTransaction).mockImplementation(async (fn: any) =>
      fn(makeTransactionClient()),
    )
    const res = await POST(postReq({ paymentMode: 'cash' }), { params: Promise.resolve({ id: QUOT_ID }) })
    expect(res.status).toBe(200)
  })

  // --- Email notifications ---

  it('sends the standard invoice email (not the business one) for a non-RFQ conversion', async () => {
    vi.mocked(withTransaction).mockImplementation(async (fn: any) =>
      fn(makeTransactionClient()),
    )
    await POST(postReq({ paymentMode: 'cash' }), { params: Promise.resolve({ id: QUOT_ID }) })
    // from_rfq is false on FINAL_QUOTATION → regular customer invoice email only.
    // Sending both would double-email the customer (the bug this guards against).
    expect(sendInvoiceFinalizedEmail).toHaveBeenCalled()
    expect(sendBusinessInvoiceGeneratedEmail).not.toHaveBeenCalled()
  })

  it('sends the business invoice email (not the standard one) for an RFQ-sourced conversion', async () => {
    vi.mocked(queryOne).mockReset()
    vi.mocked(queryOne)
      .mockResolvedValueOnce({ ...FINAL_QUOTATION, from_rfq: true } as any)
      .mockResolvedValue({ view_token: 'tok-123' } as any)
    vi.mocked(withTransaction).mockImplementation(async (fn: any) =>
      fn(makeTransactionClient()),
    )
    await POST(postReq({ paymentMode: 'cash' }), { params: Promise.resolve({ id: QUOT_ID }) })
    expect(sendBusinessInvoiceGeneratedEmail).toHaveBeenCalled()
    expect(sendInvoiceFinalizedEmail).not.toHaveBeenCalled()
  })

  it('does not send emails when customerEmail is null', async () => {
    vi.mocked(queryOne).mockReset()
    vi.mocked(queryOne)
      .mockResolvedValueOnce({ ...FINAL_QUOTATION, consignee_email: null } as any)
      .mockResolvedValueOnce(null as any)

    vi.mocked(withTransaction).mockImplementation(async (fn: any) =>
      fn(makeTransactionClient()),
    )
    await POST(postReq({ paymentMode: 'cash' }), { params: Promise.resolve({ id: QUOT_ID }) })
    expect(sendInvoiceFinalizedEmail).not.toHaveBeenCalled()
  })
})
