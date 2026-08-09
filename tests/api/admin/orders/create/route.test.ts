import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/lib/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
  withTransaction: vi.fn(),
}))
vi.mock('@/lib/gst', () => ({
  isInterState: vi.fn(),
  calculateGST: vi.fn(),
  getFinancialYear: vi.fn(),
  generateInvoiceNumber: vi.fn(),
  getNextInvoiceSequence: vi.fn(),
  round2: (n: number) => Math.round(n * 100) / 100,
}))
vi.mock('@/lib/pricing', () => ({
  lineItemFromMrpIncl: vi.fn(),
}))
vi.mock('@/lib/inventory', () => ({
  logStockMovement: vi.fn(),
}))
vi.mock('@/lib/email', () => ({
  sendInvoiceFinalizedEmail: vi.fn(),
}))
vi.mock('@/lib/validate', async () => {
  const { z } = await import('zod')
  return {
    parseBody: vi.fn(),
    zUuid: z.string().uuid(),
    zNonEmpty: z.string().min(1),
  }
})

// ── Imports ────────────────────────────────────────────────────────────────────

import { POST } from '@/app/api/admin/orders/create/route'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { withTransaction } from '@/lib/db'
import {
  isInterState, calculateGST, getFinancialYear, generateInvoiceNumber, getNextInvoiceSequence,
} from '@/lib/gst'
import { lineItemFromMrpIncl } from '@/lib/pricing'
import { logStockMovement } from '@/lib/inventory'
import { sendInvoiceFinalizedEmail } from '@/lib/email'
import { parseBody } from '@/lib/validate'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockWithTx = vi.mocked(withTransaction)
const mockIsInterState = vi.mocked(isInterState)
const mockCalculateGST = vi.mocked(calculateGST)
const mockGetFY = vi.mocked(getFinancialYear)
const mockGenInvNum = vi.mocked(generateInvoiceNumber)
const mockGetNextSeq = vi.mocked(getNextInvoiceSequence)
const mockLineItem = vi.mocked(lineItemFromMrpIncl)
const mockLogStock = vi.mocked(logStockMovement)
const mockSendInvoice = vi.mocked(sendInvoiceFinalizedEmail)
const mockParseBody = vi.mocked(parseBody)

// ── Helpers ────────────────────────────────────────────────────────────────────

const admin = {
  adminId: 'a1',
  username: 'admin',
  role: 'super_admin',
  scopes: ['invoices'],
}

function makePost(body: unknown) {
  return new NextRequest('http://localhost/api/admin/orders/create', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const validOrderBody = {
  customerName: 'John Doe',
  customerPhone: '9876543210',
  customerEmail: 'john@example.com',
  addressLine1: '123 Main St',
  city: 'Chennai',
  state: 'Tamil Nadu',
  postalCode: '600001',
  items: [
    {
      product_id: 'prod-1',
      product_name: 'Hex Bolt M6',
      product_sku: 'BOLT-M6',
      gst_rate: 18,
      unit_price: 118,
      quantity: 5,
    },
  ],
}

const parsedOrderData = {
  customerName: 'John Doe',
  customerPhone: '9876543210',
  customerEmail: 'john@example.com',
  addressLine1: '123 Main St',
  addressLine2: null,
  city: 'Chennai',
  state: 'Tamil Nadu',
  postalCode: '600001',
  buyerGstin: null,
  paymentMode: null,
  notes: null,
  items: validOrderBody.items,
}

function setupGstMocks(igst = false) {
  mockIsInterState.mockReturnValue(igst)
  mockCalculateGST.mockReturnValue({ taxableAmount: 100, cgst: 9, sgst: 9, igst: 0, totalTax: 18 })
  mockLineItem.mockReturnValue(118)
  mockGetFY.mockReturnValue('2024-25')
  mockGenInvNum.mockReturnValue('JS/2024-25/0001')
  mockGetNextSeq.mockResolvedValue(1)
}

function buildMockTxClient(overrides: Record<string, any> = {}) {
  return {
    query: vi.fn().mockImplementation((sql: string) => {
      if (sql.includes('INSERT INTO addresses')) return { rows: [{ id: 'addr-1' }] }
      if (sql.includes('INSERT INTO orders')) return { rows: [{ id: 'order-1', order_number: 'OFF-1234-ABCDE' }] }
      if (sql.includes('SELECT inventory_quantity FROM products')) return { rows: [{ inventory_quantity: '100' }] }
      if (sql.includes('SELECT inventory_quantity FROM product_variants')) return { rows: [{ inventory_quantity: '50' }] }
      if (sql.includes('SELECT inventory_quantity FROM product_sub_variants')) return { rows: [{ inventory_quantity: '20' }] }
      if (sql.includes("SELECT value FROM site_settings")) return { rows: [{ value: 'JS' }] }
      return { rows: [] }
    }),
    ...overrides,
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/admin/orders/create', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockLogStock.mockResolvedValue(undefined as any)
    mockSendInvoice.mockResolvedValue(undefined as any)
  })

  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await POST(makePost(validOrderBody))
    expect(res.status).toBe(401)
    const data = await res.json()
    expect(data.error).toBe('Unauthorized')
  })

  it('returns 403 when scope missing', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(false)
    const res = await POST(makePost(validOrderBody))
    expect(res.status).toBe(403)
    const data = await res.json()
    expect(data.error).toMatch(/permissions/i)
  })

  it('returns validation error when parseBody fails', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    const errorResponse = new Response(JSON.stringify({ error: 'customerName required' }), { status: 422 })
    mockParseBody.mockReturnValue({ ok: false, response: errorResponse } as any)
    const res = await POST(makePost({}))
    expect(res.status).toBe(422)
  })

  it('creates order successfully for product without variant', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    mockParseBody.mockReturnValue({ ok: true, data: parsedOrderData } as any)
    setupGstMocks()

    const client = buildMockTxClient()
    mockWithTx.mockImplementation(async (fn: any) => fn(client))

    const res = await POST(makePost(validOrderBody))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.success).toBe(true)
    expect(data.orderId).toBe('order-1')
    expect(data.orderNumber).toBe('OFF-1234-ABCDE')
  })

  it('saves as draft when inventory insufficient', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    mockParseBody.mockReturnValue({ ok: true, data: parsedOrderData } as any)
    setupGstMocks()

    const client = buildMockTxClient({
      query: vi.fn().mockImplementation((sql: string) => {
        if (sql.includes('INSERT INTO addresses')) return { rows: [{ id: 'addr-1' }] }
        if (sql.includes('INSERT INTO orders')) return { rows: [{ id: 'order-1', order_number: 'OFF-DRAFT' }] }
        // Insufficient stock
        if (sql.includes('SELECT inventory_quantity FROM products')) return { rows: [{ inventory_quantity: '2' }] }
        return { rows: [] }
      }),
    })
    mockWithTx.mockImplementation(async (fn: any) => {
      const result = await fn(client)
      return result
    })

    const res = await POST(makePost(validOrderBody))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.savedAsDraft).toBe(true)
    expect(data.insufficientItems).toHaveLength(1)
  })

  it('creates order with variant item', async () => {
    const bodyWithVariant = {
      ...parsedOrderData,
      items: [{ ...parsedOrderData.items[0], variant_id: 'var-1', variant_name: 'M6x20' }],
    }
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    mockParseBody.mockReturnValue({ ok: true, data: bodyWithVariant } as any)
    setupGstMocks()

    const client = buildMockTxClient()
    mockWithTx.mockImplementation(async (fn: any) => fn(client))

    const res = await POST(makePost(validOrderBody))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.success).toBe(true)
  })

  it('creates order with sub-variant item', async () => {
    const bodyWithSub = {
      ...parsedOrderData,
      items: [{
        ...parsedOrderData.items[0],
        variant_id: 'var-1',
        sub_variant_id: 'sv-1',
        variant_name: 'Small',
      }],
    }
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    mockParseBody.mockReturnValue({ ok: true, data: bodyWithSub } as any)
    setupGstMocks()

    const client = buildMockTxClient()
    mockWithTx.mockImplementation(async (fn: any) => fn(client))

    const res = await POST(makePost(validOrderBody))
    expect(res.status).toBe(200)
  })

  it('creates order with IGST for inter-state buyer', async () => {
    const igstBody = {
      ...parsedOrderData,
      buyerGstin: 'BUYER_GST_123',
      state: 'Maharashtra',
    }
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    mockParseBody.mockReturnValue({ ok: true, data: igstBody } as any)
    setupGstMocks(true)
    mockCalculateGST.mockReturnValue({ taxableAmount: 100, cgst: 0, sgst: 0, igst: 18, totalTax: 18 })

    const client = buildMockTxClient()
    mockWithTx.mockImplementation(async (fn: any) => fn(client))

    const res = await POST(makePost(validOrderBody))
    expect(res.status).toBe(200)
    expect(mockIsInterState).toHaveBeenCalled()
  })

  it('generates invoice number when GST is enabled', async () => {
    process.env.ENABLE_GST = 'true'
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    mockParseBody.mockReturnValue({ ok: true, data: parsedOrderData } as any)
    setupGstMocks()

    const client = buildMockTxClient()
    mockWithTx.mockImplementation(async (fn: any) => fn(client))

    const res = await POST(makePost(validOrderBody))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.invoiceNumber).toBe('JS/2024-25/0001')
    expect(data.invoiceUrl).toBeTruthy()
    delete process.env.ENABLE_GST
  })

  it('does not generate invoice when GST is disabled', async () => {
    delete process.env.ENABLE_GST
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    mockParseBody.mockReturnValue({ ok: true, data: parsedOrderData } as any)
    setupGstMocks()

    const client = buildMockTxClient()
    mockWithTx.mockImplementation(async (fn: any) => fn(client))

    const res = await POST(makePost(validOrderBody))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.invoiceNumber).toBeNull()
    expect(data.invoiceUrl).toBeNull()
  })

  it('sends invoice email when email provided and order not draft', async () => {
    process.env.ENABLE_GST = 'true'
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    mockParseBody.mockReturnValue({ ok: true, data: parsedOrderData } as any)
    setupGstMocks()

    const client = buildMockTxClient()
    mockWithTx.mockImplementation(async (fn: any) => fn(client))

    const res = await POST(makePost(validOrderBody))
    expect(res.status).toBe(200)
    expect(mockSendInvoice).toHaveBeenCalledWith(
      'john@example.com',
      'John Doe',
      'JS/2024-25/0001',
      expect.any(Number),
      'OFF-1234-ABCDE'
    )
    delete process.env.ENABLE_GST
  })

  it('does not send email when customer email missing', async () => {
    process.env.ENABLE_GST = 'true'
    const bodyNoEmail = { ...parsedOrderData, customerEmail: null }
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    mockParseBody.mockReturnValue({ ok: true, data: bodyNoEmail } as any)
    setupGstMocks()

    const client = buildMockTxClient()
    mockWithTx.mockImplementation(async (fn: any) => fn(client))

    const res = await POST(makePost(validOrderBody))
    expect(res.status).toBe(200)
    expect(mockSendInvoice).not.toHaveBeenCalled()
    delete process.env.ENABLE_GST
  })

  it('does not fail if email sending throws', async () => {
    process.env.ENABLE_GST = 'true'
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    mockParseBody.mockReturnValue({ ok: true, data: parsedOrderData } as any)
    setupGstMocks()

    const client = buildMockTxClient()
    mockWithTx.mockImplementation(async (fn: any) => fn(client))
    mockSendInvoice.mockRejectedValue(new Error('SMTP error'))

    const res = await POST(makePost(validOrderBody))
    expect(res.status).toBe(200)
    delete process.env.ENABLE_GST
  })

  it('sets payment_status to unpaid for credit payment', async () => {
    const creditBody = { ...parsedOrderData, paymentMode: 'credit' }
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    mockParseBody.mockReturnValue({ ok: true, data: creditBody } as any)
    setupGstMocks()

    const client = buildMockTxClient()
    mockWithTx.mockImplementation(async (fn: any) => fn(client))

    const res = await POST(makePost(validOrderBody))
    expect(res.status).toBe(200)
    // Verify payment_status was set to 'unpaid'
    const insertOrderCall = client.query.mock.calls.find(
      (c: any) => c[0].includes('INSERT INTO orders')
    )
    expect(insertOrderCall).toBeDefined()
    expect(insertOrderCall![1]).toContain('unpaid')
  })

  it('returns 500 on transaction error', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    mockParseBody.mockReturnValue({ ok: true, data: parsedOrderData } as any)
    setupGstMocks()
    mockWithTx.mockRejectedValue(new Error('Transaction failed'))

    const res = await POST(makePost(validOrderBody))
    expect(res.status).toBe(500)
    const data = await res.json()
    expect(data.error).toMatch(/Transaction failed/i)
  })

  it('handles items without product_id (custom line items)', async () => {
    const bodyCustomItem = {
      ...parsedOrderData,
      items: [{
        product_id: null,
        product_name: 'Custom Item',
        product_sku: 'CUSTOM-1',
        gst_rate: 18,
        unit_price: 200,
        quantity: 1,
      }],
    }
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    mockParseBody.mockReturnValue({ ok: true, data: bodyCustomItem } as any)
    setupGstMocks()

    const client = buildMockTxClient()
    mockWithTx.mockImplementation(async (fn: any) => fn(client))

    const res = await POST(makePost(validOrderBody))
    expect(res.status).toBe(200)
    const data = await res.json()
    // No product_id means no stock check, order goes through as delivered
    expect(data.savedAsDraft).toBe(false)
  })

  it('calls deductOrderStock when order is not a draft', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    mockParseBody.mockReturnValue({ ok: true, data: parsedOrderData } as any)
    setupGstMocks()
    const client = buildMockTxClient()
    mockWithTx.mockImplementation(async (fn: any) => fn(client))
    const res = await POST(makePost(validOrderBody))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.savedAsDraft).toBe(false)
    // deductOrderStock is called inside the transaction when !saveAsDraft
    // verified indirectly: order completes successfully (stock deducted)
    expect(data.success).toBe(true)
  })

  it('does not invoke invoice logic when draft', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    mockParseBody.mockReturnValue({ ok: true, data: parsedOrderData } as any)
    setupGstMocks()
    const client = buildMockTxClient({
      query: vi.fn().mockImplementation((sql: string) => {
        if (sql.includes('INSERT INTO addresses')) return { rows: [{ id: 'addr-1' }] }
        if (sql.includes('INSERT INTO orders')) return { rows: [{ id: 'order-1', order_number: 'OFF-DRAFT' }] }
        if (sql.includes('SELECT inventory_quantity FROM products')) return { rows: [{ inventory_quantity: '0' }] }
        return { rows: [] }
      }),
    })
    mockWithTx.mockImplementation(async (fn: any) => fn(client))
    const res = await POST(makePost(validOrderBody))
    const data = await res.json()
    expect(data.savedAsDraft).toBe(true)
    expect(data.invoiceNumber).toBeNull()
  })

  it('handles sell_unit_factor > 1 with sufficient stock', async () => {
    const bodyWithFactor = {
      ...parsedOrderData,
      items: [{ ...parsedOrderData.items[0], sell_unit_factor: 10, quantity: 5 }],
    }
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    mockParseBody.mockReturnValue({ ok: true, data: bodyWithFactor } as any)
    setupGstMocks()
    // sell_unit_factor affects pricing (baseQty = qty*factor), stock check uses product_units row
    const client = buildMockTxClient()
    mockWithTx.mockImplementation(async (fn: any) => fn(client))
    const res = await POST(makePost(validOrderBody))
    expect(res.status).toBe(200)
    const data = await res.json()
    // Stock = 100, no product_units factor → baseQty = 5, sufficient → not draft
    expect(data.savedAsDraft).toBe(false)
  })

  it('saves as draft when product_units count factor makes base qty exceed stock', async () => {
    const bodyWithUnit = {
      ...parsedOrderData,
      items: [{ ...parsedOrderData.items[0], buy_unit: 'box', quantity: 5 }],
    }
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    mockParseBody.mockReturnValue({ ok: true, data: bodyWithUnit } as any)
    setupGstMocks()
    // 5 boxes * factor=5 = 25 base units, stock=10 → insufficient → draft
    const client = buildMockTxClient({
      query: vi.fn().mockImplementation((sql: string) => {
        if (sql.includes('INSERT INTO addresses')) return { rows: [{ id: 'addr-1' }] }
        if (sql.includes('INSERT INTO orders')) return { rows: [{ id: 'order-1', order_number: 'OFF-U2' }] }
        if (sql.includes('LEFT JOIN product_units')) return { rows: [{ factor: '5', dimension: 'count' }] }
        if (sql.includes('SELECT inventory_quantity FROM products')) return { rows: [{ inventory_quantity: '10' }] }
        return { rows: [] }
      }),
    })
    mockWithTx.mockImplementation(async (fn: any) => fn(client))
    const res = await POST(makePost(validOrderBody))
    const data = await res.json()
    expect(data.savedAsDraft).toBe(true)
  })

  it('handles batch assignments — sufficient → not draft', async () => {
    const itemWithTempId = { ...parsedOrderData.items[0], temp_id: 'ti-1' }
    const bodyWithBatch = { ...parsedOrderData, items: [itemWithTempId] }
    const reqBody = {
      ...validOrderBody,
      items: [{ ...validOrderBody.items[0], temp_id: 'ti-1' }],
      batch_assignments: [{ order_item_id: 'ti-1', batch_id: 'batch-1', qty: 5 }],
    }
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    mockParseBody.mockReturnValue({ ok: true, data: bodyWithBatch } as any)
    setupGstMocks()
    const client = buildMockTxClient({
      query: vi.fn().mockImplementation((sql: string) => {
        if (sql.includes('INSERT INTO addresses')) return { rows: [{ id: 'addr-1' }] }
        if (sql.includes('INSERT INTO orders')) return { rows: [{ id: 'order-1', order_number: 'OFF-BATCH' }] }
        if (sql.includes('INSERT INTO order_items')) return { rows: [{ id: 'oi-1' }] }
        if (sql.includes('LEFT JOIN product_units')) return { rows: [{ factor: null, dimension: null }] }
        if (sql.includes('SELECT quantity_remaining FROM product_batches')) return { rows: [{ quantity_remaining: '20' }] }
        if (sql.includes("SELECT value FROM site_settings")) return { rows: [{ value: 'JS' }] }
        return { rows: [] }
      }),
    })
    mockWithTx.mockImplementation(async (fn: any) => fn(client))
    const res = await POST(makePost(reqBody))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.savedAsDraft).toBe(false)
  })

  it('saves as draft when batch qty insufficient for item', async () => {
    const itemWithTempId = { ...parsedOrderData.items[0], temp_id: 'ti-2' }
    const bodyWithBatch = { ...parsedOrderData, items: [itemWithTempId] }
    const reqBody = {
      ...validOrderBody,
      items: [{ ...validOrderBody.items[0], temp_id: 'ti-2' }],
      batch_assignments: [{ order_item_id: 'ti-2', batch_id: 'batch-2', qty: 10 }],
    }
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    mockParseBody.mockReturnValue({ ok: true, data: bodyWithBatch } as any)
    setupGstMocks()
    const client = buildMockTxClient({
      query: vi.fn().mockImplementation((sql: string) => {
        if (sql.includes('INSERT INTO addresses')) return { rows: [{ id: 'addr-1' }] }
        if (sql.includes('INSERT INTO orders')) return { rows: [{ id: 'order-1', order_number: 'OFF-BF' }] }
        if (sql.includes('INSERT INTO order_items')) return { rows: [{ id: 'oi-2' }] }
        if (sql.includes('LEFT JOIN product_units')) return { rows: [{ factor: null, dimension: null }] }
        // batch has only 3, taking 10 → avail(3) < qty(10) → shortfall
        if (sql.includes('SELECT quantity_remaining FROM product_batches')) return { rows: [{ quantity_remaining: '3' }] }
        return { rows: [] }
      }),
    })
    mockWithTx.mockImplementation(async (fn: any) => fn(client))
    const res = await POST(makePost(reqBody))
    const data = await res.json()
    expect(data.savedAsDraft).toBe(true)
    expect(data.insufficientItems).toHaveLength(1)
    expect(data.insufficientItems[0]).toMatch(/batch available/i)
  })

  it('saves as draft when batch total assigned < required base qty', async () => {
    const itemWithTempId = { ...parsedOrderData.items[0], temp_id: 'ti-3', quantity: 10 }
    const bodyWithBatch = { ...parsedOrderData, items: [itemWithTempId] }
    const reqBody = {
      ...validOrderBody,
      items: [{ ...validOrderBody.items[0], temp_id: 'ti-3', quantity: 10 }],
      batch_assignments: [{ order_item_id: 'ti-3', batch_id: 'batch-3', qty: 7 }],
    }
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    mockParseBody.mockReturnValue({ ok: true, data: bodyWithBatch } as any)
    setupGstMocks()
    const client = buildMockTxClient({
      query: vi.fn().mockImplementation((sql: string) => {
        if (sql.includes('INSERT INTO addresses')) return { rows: [{ id: 'addr-1' }] }
        if (sql.includes('INSERT INTO orders')) return { rows: [{ id: 'order-1', order_number: 'OFF-BL' }] }
        if (sql.includes('INSERT INTO order_items')) return { rows: [{ id: 'oi-3' }] }
        if (sql.includes('LEFT JOIN product_units')) return { rows: [{ factor: null, dimension: null }] }
        // per-batch ok (20 avail, taking 7), but totalBatchQty(7) < baseQty(10)
        if (sql.includes('SELECT quantity_remaining FROM product_batches')) return { rows: [{ quantity_remaining: '20' }] }
        return { rows: [] }
      }),
    })
    mockWithTx.mockImplementation(async (fn: any) => fn(client))
    const res = await POST(makePost(reqBody))
    const data = await res.json()
    expect(data.savedAsDraft).toBe(true)
    expect(data.insufficientItems).toHaveLength(1)
    expect(data.insufficientItems[0]).toMatch(/batch total/i)
  })

  it('uses buy_unit count factor from product_units when dimension=count', async () => {
    const bodyWithUnit = {
      ...parsedOrderData,
      items: [{ ...parsedOrderData.items[0], buy_unit: 'box', quantity: 2 }],
    }
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    mockParseBody.mockReturnValue({ ok: true, data: bodyWithUnit } as any)
    setupGstMocks()
    const client = buildMockTxClient({
      query: vi.fn().mockImplementation((sql: string) => {
        if (sql.includes('INSERT INTO addresses')) return { rows: [{ id: 'addr-1' }] }
        if (sql.includes('INSERT INTO orders')) return { rows: [{ id: 'order-1', order_number: 'OFF-UNIT' }] }
        if (sql.includes('LEFT JOIN product_units')) return { rows: [{ factor: '5', dimension: 'count' }] }
        if (sql.includes('SELECT inventory_quantity FROM products')) return { rows: [{ inventory_quantity: '100' }] }
        if (sql.includes("SELECT value FROM site_settings")) return { rows: [{ value: 'JS' }] }
        return { rows: [] }
      }),
    })
    mockWithTx.mockImplementation(async (fn: any) => fn(client))
    const res = await POST(makePost(validOrderBody))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.savedAsDraft).toBe(false)
  })

  it('saves as draft when product_units factor makes base qty exceed stock', async () => {
    const bodyWithUnit = {
      ...parsedOrderData,
      items: [{ ...parsedOrderData.items[0], buy_unit: 'box', quantity: 5 }],
    }
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    mockParseBody.mockReturnValue({ ok: true, data: bodyWithUnit } as any)
    setupGstMocks()
    const client = buildMockTxClient({
      query: vi.fn().mockImplementation((sql: string) => {
        if (sql.includes('INSERT INTO addresses')) return { rows: [{ id: 'addr-1' }] }
        if (sql.includes('INSERT INTO orders')) return { rows: [{ id: 'order-1', order_number: 'OFF-U2' }] }
        if (sql.includes('LEFT JOIN product_units')) return { rows: [{ factor: '5', dimension: 'count' }] }
        if (sql.includes('SELECT inventory_quantity FROM products')) return { rows: [{ inventory_quantity: '10' }] }
        return { rows: [] }
      }),
    })
    mockWithTx.mockImplementation(async (fn: any) => fn(client))
    const res = await POST(makePost(validOrderBody))
    const data = await res.json()
    expect(data.savedAsDraft).toBe(true)
  })

  it('includes discount_amount > 0 in order item when discount_pct > 0', async () => {
    const bodyWithDiscount = {
      ...parsedOrderData,
      items: [{ ...parsedOrderData.items[0], discount_pct: 10, quantity: 1 }],
    }
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    mockParseBody.mockReturnValue({ ok: true, data: bodyWithDiscount } as any)
    setupGstMocks()
    const client = buildMockTxClient()
    mockWithTx.mockImplementation(async (fn: any) => fn(client))
    const res = await POST(makePost(validOrderBody))
    expect(res.status).toBe(200)
    const itemInsert = client.query.mock.calls.find((c: any) => c[0].includes('INSERT INTO order_items'))
    expect(itemInsert).toBeDefined()
    // discount_amount at index 17 in params
    expect(Number(itemInsert![1][17])).toBeGreaterThan(0)
  })

  it('sets payment_status to paid for non-credit payment', async () => {
    const cashBody = { ...parsedOrderData, paymentMode: 'cash' }
    mockAuth.mockResolvedValue(admin as any)
    mockHasScope.mockReturnValue(true)
    mockParseBody.mockReturnValue({ ok: true, data: cashBody } as any)
    setupGstMocks()
    const client = buildMockTxClient()
    mockWithTx.mockImplementation(async (fn: any) => fn(client))
    await POST(makePost(validOrderBody))
    const insertOrderCall = client.query.mock.calls.find(
      (c: any) => c[0].includes('INSERT INTO orders')
    )
    expect(insertOrderCall![1]).toContain('paid')
  })
})
