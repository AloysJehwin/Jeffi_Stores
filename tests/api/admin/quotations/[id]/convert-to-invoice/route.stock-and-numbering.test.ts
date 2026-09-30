import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/lib/auth/jwt', () => ({
  authenticateAdmin: vi.fn(),
}))

vi.mock('@/lib/auth/scopes', () => ({
  hasScope: vi.fn(),
}))

vi.mock('@/lib/shared/db', () => ({
  queryOne: vi.fn(),
  queryMany: vi.fn(),
  query: vi.fn(),
  withTransaction: vi.fn(),
}))

vi.mock('@/lib/catalog/gst', () => ({
  isInterState: vi.fn(),
  generateInvoiceNumber: vi.fn(),
  getNextInvoiceSequence: vi.fn(),
  getFinancialYear: vi.fn(),
  round2: (n: number) => Math.round(n * 100) / 100,
}))

vi.mock('@/lib/orders/inventory', () => ({
  logStockMovement: vi.fn(),
}))

vi.mock('@/lib/orders/inventory-deduct', () => ({
  deductOrderStock: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/email', () => ({
  sendInvoiceFinalizedEmail: vi.fn(),
}))

vi.mock('@/lib/shared/email-business', () => ({
  sendBusinessInvoiceGeneratedEmail: vi.fn(),
}))

vi.mock('@/lib/catalog/pricing', () => ({
  lineItemExGst: vi.fn(),
}))

vi.mock('@/lib/payments/razorpay', () => ({
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
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { queryOne, queryMany, query, withTransaction } from '@/lib/shared/db'
import { sendInvoiceFinalizedEmail } from '@/lib/email'
import { sendBusinessInvoiceGeneratedEmail } from '@/lib/shared/email-business'
import { isInterState, generateInvoiceNumber, getNextInvoiceSequence, getFinancialYear } from '@/lib/catalog/gst'
import { lineItemExGst } from '@/lib/catalog/pricing'
import { logStockMovement } from '@/lib/orders/inventory'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ADMIN = { adminId: 'admin-1', id: 'admin-1', role: 'super_admin', scopes: ['quotations'] }
const QUOT_ID = '660e8400-e29b-41d4-a716-446655440002'

function postReq(body: unknown = {}) {
  return new NextRequest(
    new Request(`http://localhost/api/admin/quotations/${QUOT_ID}/convert-to-invoice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  )
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
    query: vi
      .fn()
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

describe('POST /api/admin/quotations/[id]/convert-to-invoice stock checks and numbering', () => {
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

  // --- Variant / sub-variant stock paths ---

  it('checks variant stock when item has variant_id', async () => {
    vi.mocked(queryMany).mockResolvedValue([
      {
        ...QUOT_ITEMS[0],
        variant_id: '222e4567-e89b-12d3-a456-426614174002',
      },
    ] as any)

    vi.mocked(withTransaction).mockImplementation(async (fn: any) => {
      const client = {
        query: vi
          .fn()
          .mockResolvedValueOnce({ rows: [{ id: 'addr-uuid-1' }] })
          .mockResolvedValueOnce({ rows: [{ inventory_quantity: 50 }] })
          .mockResolvedValueOnce({ rows: [{ id: 'order-uuid-1', order_number: 'OFF-123' }] })
          .mockResolvedValueOnce({ rows: [{ value: 'JS' }] })
          .mockResolvedValueOnce({ rows: [{ seq: 1 }] })
          .mockResolvedValueOnce({ rows: [] })
          .mockResolvedValueOnce({ rows: [] })
          .mockResolvedValueOnce({ rows: [{ id: 'oi-1' }] })
          .mockResolvedValueOnce({ rows: [{ inventory_quantity: '50' }] })
          .mockResolvedValueOnce({ rows: [] })
          .mockResolvedValueOnce({ rows: [] }),
        release: vi.fn(),
      }
      return fn(client)
    })

    const res = await POST(postReq(), { params: Promise.resolve({ id: QUOT_ID }) })
    expect(res.status).toBe(200)
  })

  it('checks sub-variant stock when item has sub_variant_id', async () => {
    vi.mocked(queryMany).mockResolvedValue([
      {
        ...QUOT_ITEMS[0],
        variant_id: '222e4567-e89b-12d3-a456-426614174002',
        sub_variant_id: '333e4567-e89b-12d3-a456-426614174003',
      },
    ] as any)

    vi.mocked(withTransaction).mockImplementation(async (fn: any) => {
      const client = {
        query: vi
          .fn()
          .mockResolvedValueOnce({ rows: [{ id: 'addr-uuid-1' }] })
          .mockResolvedValueOnce({ rows: [{ inventory_quantity: 200 }] })
          .mockResolvedValueOnce({ rows: [{ id: 'order-uuid-1', order_number: 'OFF-123' }] })
          .mockResolvedValueOnce({ rows: [{ value: 'JS' }] })
          .mockResolvedValueOnce({ rows: [{ seq: 1 }] })
          .mockResolvedValueOnce({ rows: [] })
          .mockResolvedValueOnce({ rows: [] })
          .mockResolvedValueOnce({ rows: [{ id: 'oi-1' }] })
          .mockResolvedValueOnce({ rows: [{ inventory_quantity: '200' }] })
          .mockResolvedValueOnce({ rows: [] })
          .mockResolvedValueOnce({ rows: [] }),
        release: vi.fn(),
      }
      return fn(client)
    })

    const res = await POST(postReq({ paymentMode: 'cash' }), { params: Promise.resolve({ id: QUOT_ID }) })
    expect(res.status).toBe(200)
  })

  it('skips stock check for items without product_id', async () => {
    vi.mocked(queryMany).mockResolvedValue([
      {
        ...QUOT_ITEMS[0],
        product_id: null,
        variant_id: null,
      },
    ] as any)

    vi.mocked(withTransaction).mockImplementation(async (fn: any) => {
      const client = {
        query: vi
          .fn()
          .mockResolvedValueOnce({ rows: [{ id: 'addr-uuid-1' }] })
          // no stock-check call — goes straight to INSERT orders
          .mockResolvedValueOnce({ rows: [{ id: 'order-uuid-1', order_number: 'OFF-123' }] })
          .mockResolvedValueOnce({ rows: [{ value: 'JS' }] })
          .mockResolvedValueOnce({ rows: [{ seq: 1 }] })
          .mockResolvedValueOnce({ rows: [] })
          .mockResolvedValueOnce({ rows: [] })
          .mockResolvedValueOnce({ rows: [{ id: 'oi-1' }] })
          .mockResolvedValueOnce({ rows: [] }),
        release: vi.fn(),
      }
      return fn(client)
    })

    const res = await POST(postReq({ paymentMode: 'cash' }), { params: Promise.resolve({ id: QUOT_ID }) })
    expect(res.status).toBe(200)
  })

  // --- from_rfq prefix ---

  it('uses BUS- prefix for order_number when quotation is from_rfq', async () => {
    vi.mocked(queryOne).mockReset()
    vi.mocked(queryOne)
      .mockResolvedValueOnce({ ...FINAL_QUOTATION, from_rfq: true } as any)
      .mockResolvedValueOnce(null as any)

    let capturedOrderNumber = ''
    vi.mocked(withTransaction).mockImplementation(async (fn: any) => {
      const client = {
        query: vi.fn().mockImplementation((sql: string, params: any[]) => {
          if (sql.includes('INSERT INTO addresses')) return Promise.resolve({ rows: [{ id: 'addr-uuid-1' }] })
          if (sql.includes('inventory_quantity FROM products'))
            return Promise.resolve({ rows: [{ inventory_quantity: 100 }] })
          if (sql.includes('INSERT INTO orders')) {
            capturedOrderNumber = params[0] as string
            return Promise.resolve({ rows: [{ id: 'order-uuid-rfq', order_number: capturedOrderNumber }] })
          }
          if (sql.includes('site_settings')) return Promise.resolve({ rows: [{ value: 'JS' }] })
          if (sql.includes('UPDATE orders SET invoice')) return Promise.resolve({ rows: [] })
          if (sql.includes('INSERT INTO invoices')) return Promise.resolve({ rows: [] })
          if (sql.includes('INSERT INTO order_items')) return Promise.resolve({ rows: [{ id: 'oi-1' }] })
          if (sql.includes('FOR UPDATE')) return Promise.resolve({ rows: [{ inventory_quantity: '100' }] })
          if (sql.includes('UPDATE') && sql.includes('products')) return Promise.resolve({ rows: [] })
          if (sql.includes('UPDATE quotations')) return Promise.resolve({ rows: [] })
          return Promise.resolve({ rows: [{ seq: 1, value: 'JS' }] })
        }),
        release: vi.fn(),
      }
      return fn(client)
    })

    await POST(postReq({ paymentMode: 'cash' }), { params: Promise.resolve({ id: QUOT_ID }) })
    expect(capturedOrderNumber).toMatch(/^BUS-/)
  })

  // --- IGST path ---

  it('sets IGST flag for inter-state buyer with GSTIN', async () => {
    vi.mocked(isInterState).mockReturnValue(true)
    vi.mocked(queryOne).mockReset()
    vi.mocked(queryOne)
      .mockResolvedValueOnce({
        ...FINAL_QUOTATION,
        consignee_gstin: '27AABCU9603R1ZM',
        consignee_state: 'Maharashtra',
      } as any)
      .mockResolvedValueOnce(null as any)

    vi.mocked(withTransaction).mockImplementation(async (fn: any) => fn(makeTransactionClient()))
    const res = await POST(postReq({ paymentMode: 'cash' }), { params: Promise.resolve({ id: QUOT_ID }) })
    expect(res.status).toBe(200)
  })

  // --- Error handling ---

  it('returns 500 on transaction error', async () => {
    vi.mocked(withTransaction).mockRejectedValue(new Error('TX failed'))
    const res = await POST(postReq(), { params: Promise.resolve({ id: QUOT_ID }) })
    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json.error).toBe('TX failed')
  })
})
