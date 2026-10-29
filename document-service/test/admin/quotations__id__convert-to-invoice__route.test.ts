import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../src/lib/reply-context', () => ({ invoiceReply: async () => null, recordEmailSend: async () => {} }))
vi.mock('@/lib/shared/customer-links', () => ({
  documentUrl: vi.fn(async (app: string, token: string) => `https://${app}-acme.jeffistores.in/${token}`),
  orderUrlById: vi.fn(async (id: string) => `https://acme.jeffistores.in/account/orders/${id}`),
  invoiceUrlForOrder: vi.fn(async () => 'https://invoice-acme.jeffistores.in/TOKEN'),
}))
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

vi.mock('@/lib/catalog/digital-guard', () => ({
  findDigitalProductIds: vi.fn(async () => []),
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

const flags = vi.hoisted(() => ({ gstEnabled: true, inventoryValidationEnabled: true }))
vi.mock('@/lib/catalog/site-controls', () => ({
  getFeatureFlags: async () => ({ ...flags }),
  getBusinessValues: async () => ({ businessStateCode: '33' }),
}))

vi.mock('@/lib/orders/inventory-deduct', async () => ({
  ...(await vi.importActual<any>('@/lib/orders/inventory-deduct')),
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

import { POST } from '@/app/api/(admin)/admin/quotations/[id]/convert-to-invoice/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { queryOne, queryMany, query, withTransaction } from '@/lib/shared/db'
import { sendInvoiceFinalizedEmail } from '@/lib/email'
import { sendBusinessInvoiceGeneratedEmail } from '@/lib/shared/email-business'
import { isInterState, generateInvoiceNumber, getNextInvoiceSequence, getFinancialYear } from '@/lib/catalog/gst'
import { lineItemExGst } from '@/lib/catalog/pricing'
import { logStockMovement } from '@/lib/orders/inventory'
import { findDigitalProductIds } from '@/lib/catalog/digital-guard'

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

// Answers by SQL shape, not call order. `unitRow` feeds the product_units lookup.
function makeTransactionClient(stockLevel = 100, unitRow: any = null) {
  return {
    query: vi.fn().mockImplementation(async (sql: string) => {
      if (sql.includes('INSERT INTO addresses')) return { rows: [{ id: 'addr-uuid-1' }] }
      if (sql.includes('FROM product_units')) return { rows: unitRow ? [unitRow] : [] }
      if (/SELECT inventory_quantity FROM \w+ WHERE id = \$1 FOR UPDATE/.test(sql))
        return { rows: [{ inventory_quantity: String(stockLevel) }] }
      if (sql.includes('INSERT INTO orders')) return { rows: [{ id: 'order-uuid-1', order_number: 'OFF-123' }] }
      if (sql.includes('invoice_prefix')) return { rows: [{ value: 'JS' }] }
      if (sql.includes('INSERT INTO order_items')) return { rows: [{ id: 'oi-1' }] }
      return { rows: [] }
    }),
    release: vi.fn(),
  }
}

const sqlsOf = (client: any): string[] => client.query.mock.calls.map((c: any[]) => String(c[0]))

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
    vi.mocked(findDigitalProductIds).mockResolvedValue([])
    flags.gstEnabled = true
    flags.inventoryValidationEnabled = true
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

  it('returns 409 when quotation already converted', async () => {
    vi.mocked(queryOne).mockReset()
    vi.mocked(queryOne).mockResolvedValueOnce({ ...FINAL_QUOTATION, converted_order_id: 'existing-order' } as any)
    const res = await POST(postReq(), { params: Promise.resolve({ id: QUOT_ID }) })
    expect(res.status).toBe(409)
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

  it('returns 400 when a line item is a digital product', async () => {
    vi.mocked(findDigitalProductIds).mockResolvedValue(['111e4567-e89b-12d3-a456-426614174001'])
    const res = await POST(postReq({ paymentMode: 'cash' }), { params: Promise.resolve({ id: QUOT_ID }) })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Digital products cannot be sold through this channel')
    expect(vi.mocked(withTransaction)).not.toHaveBeenCalled()
  })

  // --- Happy path ---

  it('returns orderId, orderNumber, invoiceNumber on success', async () => {
    vi.mocked(withTransaction).mockImplementation(async (fn: any) => fn(makeTransactionClient()))
    const res = await POST(postReq({ paymentMode: 'cash' }), { params: Promise.resolve({ id: QUOT_ID }) })
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(json.orderId).toBeDefined()
    expect(json.orderNumber).toBeDefined()
  })

  it('returns invoiceUrl when invoice_number is generated', async () => {
    vi.mocked(withTransaction).mockImplementation(async (fn: any) => fn(makeTransactionClient()))
    const res = await POST(postReq({ paymentMode: 'cash' }), { params: Promise.resolve({ id: QUOT_ID }) })
    const json = await res.json()
    expect(json.invoiceUrl).toMatch(/\/api\/orders\//)
  })

  // --- Draft fallback when insufficient stock ---

  it('saves as draft and returns savedAsDraft=true when stock is low', async () => {
    vi.mocked(withTransaction).mockImplementation(async (fn: any) => fn(makeTransactionClient(0)))

    const res = await POST(postReq({ paymentMode: 'cash' }), { params: Promise.resolve({ id: QUOT_ID }) })
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.savedAsDraft).toBe(true)
    expect(json.insufficientItems).toBeInstanceOf(Array)
  })

  it('sets invoiceUrl to null when savedAsDraft (no invoice_number)', async () => {
    vi.mocked(withTransaction).mockImplementation(async (fn: any) => fn(makeTransactionClient(0)))
    const res = await POST(postReq({ paymentMode: 'cash' }), { params: Promise.resolve({ id: QUOT_ID }) })
    const json = await res.json()
    expect(json.invoiceUrl).toBeNull()
  })

  it('does not send emails when result.saveAsDraft is true', async () => {
    vi.mocked(withTransaction).mockImplementation(async (fn: any) => fn(makeTransactionClient(0)))
    await POST(postReq({ paymentMode: 'cash' }), { params: Promise.resolve({ id: QUOT_ID }) })
    expect(sendInvoiceFinalizedEmail).not.toHaveBeenCalled()
    expect(sendBusinessInvoiceGeneratedEmail).not.toHaveBeenCalled()
  })

  // --- enableDelivery flag ---

  it('sets needsDelivery=true when enableDelivery=true and stock is sufficient', async () => {
    vi.mocked(withTransaction).mockImplementation(async (fn: any) => fn(makeTransactionClient()))
    const res = await POST(postReq({ paymentMode: 'cash', enableDelivery: true }), {
      params: Promise.resolve({ id: QUOT_ID }),
    })
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.needsDelivery).toBe(true)
  })

  it('saves as draft (processing) when insufficient stock + enableDelivery=true', async () => {
    vi.mocked(withTransaction).mockImplementation(async (fn: any) => fn(makeTransactionClient(0)))
    const res = await POST(postReq({ paymentMode: 'cash', enableDelivery: true }), {
      params: Promise.resolve({ id: QUOT_ID }),
    })
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.savedAsDraft).toBe(true)
    // saveAsDraft prevents needsDelivery from being true
    expect(json.needsDelivery).toBe(false)
  })

  // --- Payment modes ---

  it('marks order as unpaid for upi_qr paymentMode and returns qrImageUrl', async () => {
    vi.mocked(withTransaction).mockImplementation(async (fn: any) => fn(makeTransactionClient()))
    const res = await POST(postReq({ paymentMode: 'upi_qr' }), { params: Promise.resolve({ id: QUOT_ID }) })
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json).toHaveProperty('qrImageUrl')
  })

  it('handles upi_qr QR creation failure gracefully (non-fatal)', async () => {
    vi.mocked(withTransaction).mockImplementation(async (fn: any) => fn(makeTransactionClient()))
    const { getRazorpayInstance } = await import('@/lib/payments/razorpay')
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
    vi.mocked(withTransaction).mockImplementation(async (fn: any) => fn(makeTransactionClient()))
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

    vi.mocked(withTransaction).mockImplementation(async (fn: any) => fn(makeTransactionClient()))
    const res = await POST(postReq({ paymentMode: 'cash' }), { params: Promise.resolve({ id: QUOT_ID }) })
    expect(res.status).toBe(200)
  })

  // --- Email notifications ---

  it('sends the standard invoice email (not the business one) for a non-RFQ conversion', async () => {
    vi.mocked(withTransaction).mockImplementation(async (fn: any) => fn(makeTransactionClient()))
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
    vi.mocked(withTransaction).mockImplementation(async (fn: any) => fn(makeTransactionClient()))
    await POST(postReq({ paymentMode: 'cash' }), { params: Promise.resolve({ id: QUOT_ID }) })
    expect(sendBusinessInvoiceGeneratedEmail).toHaveBeenCalled()
    expect(sendInvoiceFinalizedEmail).not.toHaveBeenCalled()
  })

  it('does not send emails when customerEmail is null', async () => {
    vi.mocked(queryOne).mockReset()
    vi.mocked(queryOne)
      .mockResolvedValueOnce({ ...FINAL_QUOTATION, consignee_email: null } as any)
      .mockResolvedValueOnce(null as any)

    vi.mocked(withTransaction).mockImplementation(async (fn: any) => fn(makeTransactionClient()))
    await POST(postReq({ paymentMode: 'cash' }), { params: Promise.resolve({ id: QUOT_ID }) })
    expect(sendInvoiceFinalizedEmail).not.toHaveBeenCalled()
  })

  // --- Custom lines / unit conversion / flag gating ---

  const CUSTOM_ITEM = {
    ...QUOT_ITEMS[0],
    id: 'qi-c',
    product_id: null,
    description: 'Site installation',
    unit: 'JOB',
    quantity: '1',
    rate: '500',
  }

  it('custom line → order_items with NULL product, its unit as buy_unit, no inventory lookups', async () => {
    vi.mocked(queryMany).mockResolvedValue([CUSTOM_ITEM] as any)
    const client = makeTransactionClient(0)
    vi.mocked(withTransaction).mockImplementation(async (fn: any) => fn(client))
    const res = await POST(postReq({ paymentMode: 'cash' }), { params: Promise.resolve({ id: QUOT_ID }) })
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.savedAsDraft).toBe(false)
    const sqls = sqlsOf(client)
    expect(sqls.some(q => q.includes('FROM product_units') || q.includes('inventory_quantity'))).toBe(false)
    const ins = client.query.mock.calls.find((c: any[]) => String(c[0]).includes('INSERT INTO order_items'))!
    expect(ins[1][1]).toBeNull() // product_id
    expect(ins[1][11]).toBe('JOB') // buy_unit
    expect(ins[1][21]).toBe('JOB') // sold_unit
  })

  it('rejects a custom line whose unit is longer than 10 characters', async () => {
    vi.mocked(queryMany).mockResolvedValue([{ ...CUSTOM_ITEM, unit: 'PERSON-DAYS' }] as any)
    const res = await POST(postReq({ paymentMode: 'cash' }), { params: Promise.resolve({ id: QUOT_ID }) })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/10 characters/)
    expect(vi.mocked(withTransaction)).not.toHaveBeenCalled()
  })

  it('2 × SET (sold_unit_factor 10) at ₹5/pc → taxable 100, base qty 20; invoice total = quotation total', async () => {
    const { lineItemExGst: real } = await vi.importActual<any>('@/lib/catalog/pricing')
    vi.mocked(lineItemExGst).mockImplementation(real)
    vi.mocked(queryMany).mockImplementation(async (sql: string) =>
      sql.includes('AS item_id')
        ? ([{ item_id: 'qi-s', factor: '10', dimension: 'count' }] as any)
        : ([
            {
              ...QUOT_ITEMS[0],
              id: 'qi-s',
              quantity: '2',
              rate: '5',
              gst_rate: '18',
              unit: 'SET',
              buy_unit: 'SET',
              sold_unit_factor: '10',
            },
          ] as any)
    )
    const client = makeTransactionClient(100)
    vi.mocked(withTransaction).mockImplementation(async (fn: any) => fn(client))
    const res = await POST(postReq({ paymentMode: 'cash' }), { params: Promise.resolve({ id: QUOT_ID }) })
    expect(res.status).toBe(200)
    const ins = client.query.mock.calls.find((c: any[]) => String(c[0]).includes('INSERT INTO order_items'))!
    expect(ins[1][10]).toBe(2) // quantity in selling units
    expect(ins[1][16]).toBe(100) // taxable_amount
    expect(ins[1][23]).toBe(20) // base_quantity
    const order = client.query.mock.calls.find((c: any[]) => String(c[0]).includes('INSERT INTO orders'))!
    // quotation: amount 100, CGST+SGST 18 → 118
    expect(order[1][17]).toBe(118)
  })

  it('short stock → draft with shortfall in selling unit and pieces, plus insufficientDetails', async () => {
    vi.mocked(queryMany).mockImplementation(async (sql: string) =>
      sql.includes('AS item_id')
        ? ([{ item_id: 'qi-s', factor: '10', dimension: 'count' }] as any)
        : ([
            { ...QUOT_ITEMS[0], id: 'qi-s', quantity: '2', unit: 'SET', buy_unit: 'SET', sold_unit_factor: '10' },
          ] as any)
    )
    const unitRow = { unit: 'SET', factor: '10', dimension: 'count', qty_step: '1', min_qty: '1', max_qty: null }
    vi.mocked(withTransaction).mockImplementation(async (fn: any) => fn(makeTransactionClient(15, unitRow)))
    const json = await (
      await POST(postReq({ paymentMode: 'cash' }), { params: Promise.resolve({ id: QUOT_ID }) })
    ).json()
    expect(json.savedAsDraft).toBe(true)
    expect(json.insufficientItems).toEqual(['Widget A — need 2 SET (20 pcs), available 15 pcs, short 5 pcs (0.5 SET)'])
    expect(json.insufficientDetails[0]).toMatchObject({ required_base: 20, available_base: 15, short_base: 5 })
  })

  it('inventory flag OFF: no stock queries and no deduction, even at zero stock', async () => {
    flags.inventoryValidationEnabled = false
    const { deductOrderStock } = await import('@/lib/orders/inventory-deduct')
    const client = makeTransactionClient(0)
    vi.mocked(withTransaction).mockImplementation(async (fn: any) => fn(client))
    const json = await (
      await POST(postReq({ paymentMode: 'cash' }), { params: Promise.resolve({ id: QUOT_ID }) })
    ).json()
    expect(json.savedAsDraft).toBe(false)
    expect(sqlsOf(client).some(q => q.includes('inventory_quantity') || q.includes('FROM product_units'))).toBe(false)
    expect(deductOrderStock).not.toHaveBeenCalled()
  })

  it('inventory flag ON: deducts with the default-unit fallback enabled', async () => {
    const { deductOrderStock } = await import('@/lib/orders/inventory-deduct')
    vi.mocked(withTransaction).mockImplementation(async (fn: any) => fn(makeTransactionClient(100)))
    await POST(postReq({ paymentMode: 'cash' }), { params: Promise.resolve({ id: QUOT_ID }) })
    expect(deductOrderStock).toHaveBeenCalledWith(
      'order-uuid-1',
      expect.objectContaining({ defaultUnitFallback: true, requireSerialAssignments: true }),
      expect.anything()
    )
  })

  it('maps InsufficientStockError from deduction to 409', async () => {
    const mod = await import('@/lib/orders/inventory-deduct')
    vi.mocked(mod.deductOrderStock).mockRejectedValueOnce(
      new mod.InsufficientStockError('Insufficient stock for "Widget A"', 'x')
    )
    vi.mocked(withTransaction).mockImplementation(async (fn: any) => fn(makeTransactionClient(100)))
    const res = await POST(postReq({ paymentMode: 'cash' }), { params: Promise.resolve({ id: QUOT_ID }) })
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/Insufficient stock/)
  })
})
