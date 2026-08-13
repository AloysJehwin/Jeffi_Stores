import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks (before imports) ────────────────────────────────────────────────────

vi.mock('@/lib/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/db', () => ({
  query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
  withTransaction: vi.fn(),
}))
vi.mock('@/lib/gst', () => ({
  isInterState: vi.fn().mockReturnValue(false),
  generateInvoiceNumber: vi.fn().mockReturnValue('JS/2025-26/00001'),
  getNextInvoiceSequence: vi.fn().mockResolvedValue(1),
  getFinancialYear: vi.fn().mockReturnValue('2025-26'),
  round2: (n: number) => Math.round(n * 100) / 100,
}))
vi.mock('@/lib/inventory', () => ({
  logStockMovement: vi.fn().mockResolvedValue(undefined),
  recomputeStockStatusForProduct: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/shelf', () => ({
  syncPerishableStock: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/email', () => ({
  sendInvoiceFinalizedEmail: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/email-business', () => ({
  sendBusinessInvoiceGeneratedEmail: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/pricing', () => ({
  lineItemExGst: vi.fn((qty: number, rate: number, disc: number) => qty * rate * (1 - disc / 100)),
}))
vi.mock('@/lib/razorpay', () => ({
  getRazorpayInstance: vi.fn(),
}))
vi.mock('sharp', () => ({
  default: vi.fn(),
}))

// ── Imports ───────────────────────────────────────────────────────────────────

import { POST } from '@/app/api/admin/quotations/[id]/convert-to-invoice/route'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryOne, queryMany, withTransaction } from '@/lib/db'
import { getRazorpayInstance } from '@/lib/razorpay'

// ── Helpers ───────────────────────────────────────────────────────────────────

const ADMIN = { adminId: 'a1', role: 'admin', scopes: ['quotations'] }
const PARAMS = { params: Promise.resolve({ id: 'q-1' }) }

function makePost(body: any = {}) {
  return new NextRequest('http://localhost/api/admin/quotations/q-1/convert-to-invoice', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

const FINAL_QUOTATION = {
  id: 'q-1',
  quote_number: 'Q-001',
  status: 'final',
  converted_order_id: null,
  from_rfq: false,
  buyer_same: true,
  consignee_name: 'Test Customer',
  consignee_phone: '9876543210',
  consignee_email: 'test@example.com',
  consignee_state: 'Tamil Nadu',
  consignee_gstin: null,
  consignee_addr1: 'Street 1',
  consignee_addr2: null,
  consignee_city: 'Chennai',
  consignee_pincode: '600001',
}

const Q_ITEM = {
  id: 'qi-1',
  product_id: 'p-1',
  variant_id: null,
  sub_variant_id: null,
  description: 'Test Product',
  quantity: '2',
  rate: '100',
  discount_pct: '0',
  gst_rate: '18',
  hsn_code: '1234',
  buy_unit: 'pcs',
  unit: 'pcs',
}

function makeMockClient(overrides: Partial<Record<string, any>> = {}) {
  const client: any = {
    query: vi.fn(),
  }
  client.query.mockImplementation(async (sql: string, params?: any[]) => {
    const s = String(sql)
    if (/INSERT INTO addresses/i.test(s)) return { rows: [{ id: 'addr-1' }] }
    if (/INSERT INTO orders/i.test(s)) return { rows: [{ id: 'ord-1', order_number: 'OFF-1' }] }
    if (/INSERT INTO order_items/i.test(s)) return { rows: [{ id: 'oi-1' }] }
    // deductOrderStock reads the persisted order_items back by order_id
    if (/FROM order_items\s+WHERE order_id/i.test(s)) {
      return { rows: [{ id: 'oi-1', product_id: 'p-1', variant_id: null, sub_variant_id: null, product_name: 'Test Product', variant_name: null, quantity: '2', buy_unit: 'pcs' }] }
    }
    if (/FROM inventory_transactions/i.test(s)) return { rows: [] } // idempotency guard: not yet deducted
    if (/product_units/i.test(s)) return { rows: [{ unit: 'pcs', factor: '1', dimension: 'count', qty_step: '1', min_qty: null, max_qty: null }] }
    if (/UPDATE orders/i.test(s)) return { rows: [] }
    if (/UPDATE quotations/i.test(s)) return { rows: [] }
    if (/INSERT INTO invoices/i.test(s)) return { rows: [] }
    if (/site_settings/i.test(s)) return { rows: [{ value: 'JS' }] }
    if (/FROM product_sub_variants/i.test(s)) return { rows: [{ inventory_quantity: '100' }] }
    if (/FROM product_variants/i.test(s)) return { rows: [{ inventory_quantity: '100' }] }
    if (/FROM products/i.test(s) && /serialized/.test(s) && !/perishable/.test(s)) {
      return { rows: [{ serialized: false }] }
    }
    if (/FROM products/i.test(s) && /perishable/.test(s)) {
      return { rows: [{ perishable: false, serialized: false }] }
    }
    if (/FROM products/i.test(s)) return { rows: [{ inventory_quantity: '100' }] }
    if (/FROM product_batches/i.test(s)) return { rows: [{ quantity_remaining: '100', lot_number: 'L1', expiry_date: null }] }
    if (/UPDATE product_batches/i.test(s)) return { rows: [{ lot_number: 'L1', expiry_date: null }] }
    if (/product_serials/i.test(s)) return { rows: [{ id: 's-1', batch_id: 'b-1' }] }
    return { rows: [] }
  })
  // Merge overrides
  if (overrides.query) client.query = overrides.query
  return client
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/admin/quotations/[id]/convert-to-invoice', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when not authenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    const res = await POST(makePost(), PARAMS)
    expect(res.status).toBe(401)
  })

  it('returns 403 when missing quotations:write scope', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(false)
    const res = await POST(makePost(), PARAMS)
    expect(res.status).toBe(403)
  })

  it('returns 404 when quotation not found', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(queryOne).mockResolvedValue(null as any)
    const res = await POST(makePost(), PARAMS)
    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({ error: 'Quotation not found' })
  })

  it('returns 400 when quotation status is not final', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(queryOne).mockResolvedValue({ ...FINAL_QUOTATION, status: 'draft' } as any)
    const res = await POST(makePost(), PARAMS)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/finalised/)
  })

  it('returns 400 when already converted', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(queryOne).mockResolvedValue({ ...FINAL_QUOTATION, converted_order_id: 'ord-9' } as any)
    const res = await POST(makePost(), PARAMS)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/already been converted/)
  })

  it('returns 400 when quotation has no line items', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(queryOne).mockResolvedValue(FINAL_QUOTATION as any)
    vi.mocked(queryMany).mockResolvedValueOnce([] as any) // qItems empty
    const res = await POST(makePost(), PARAMS)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/no line items/)
  })

  it('succeeds on happy path (cash, no delivery) and finalises invoice', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(queryOne).mockResolvedValue(FINAL_QUOTATION as any)
    vi.mocked(queryMany)
      .mockResolvedValueOnce([Q_ITEM] as any) // items
      .mockResolvedValueOnce([{ item_id: 'qi-1', factor: '1', dimension: 'count' }] as any) // unit factors

    const client = makeMockClient()
    vi.mocked(withTransaction).mockImplementation(async (fn: any) => fn(client))

    const res = await POST(makePost({ paymentMode: 'cash', enableDelivery: false }), PARAMS)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.invoiceNumber).toBe('JS/2025-26/00001')
    expect(body.savedAsDraft).toBe(false)
    expect(body.needsDelivery).toBe(false)
  })

  it('saves as draft when stock insufficient (products path)', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(queryOne).mockResolvedValue(FINAL_QUOTATION as any)
    vi.mocked(queryMany)
      .mockResolvedValueOnce([Q_ITEM] as any)
      .mockResolvedValueOnce([{ item_id: 'qi-1', factor: '1', dimension: 'count' }] as any)

    const client = makeMockClient()
    // Override stock check to return low stock for products
    const origQuery = client.query
    client.query = vi.fn().mockImplementation(async (sql: string, params?: any[]) => {
      if (/FROM products WHERE id = \$1 FOR UPDATE/i.test(sql)) {
        return { rows: [{ inventory_quantity: '0' }] }
      }
      return origQuery(sql, params)
    })
    vi.mocked(withTransaction).mockImplementation(async (fn: any) => fn(client))

    const res = await POST(makePost({ enableDelivery: false }), PARAMS)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.savedAsDraft).toBe(true)
    expect(body.insufficientItems.length).toBeGreaterThan(0)
    expect(body.invoiceNumber).toBeNull()
  })

  it('handles variant-based stock check (sufficient)', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(queryOne).mockResolvedValue(FINAL_QUOTATION as any)
    vi.mocked(queryMany)
      .mockResolvedValueOnce([{ ...Q_ITEM, variant_id: 'v-1' }] as any)
      .mockResolvedValueOnce([{ item_id: 'qi-1', factor: '1', dimension: 'count' }] as any)

    const client = makeMockClient()
    vi.mocked(withTransaction).mockImplementation(async (fn: any) => fn(client))

    const res = await POST(makePost({}), PARAMS)
    expect(res.status).toBe(200)
    expect((await res.json()).savedAsDraft).toBe(false)
  })

  it('handles sub-variant stock check (insufficient)', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(queryOne).mockResolvedValue(FINAL_QUOTATION as any)
    vi.mocked(queryMany)
      .mockResolvedValueOnce([{ ...Q_ITEM, sub_variant_id: 'sv-1' }] as any)
      .mockResolvedValueOnce([{ item_id: 'qi-1', factor: '1', dimension: 'count' }] as any)

    const client = makeMockClient()
    const origQuery = client.query
    client.query = vi.fn().mockImplementation(async (sql: string, params?: any[]) => {
      if (/FROM product_sub_variants WHERE id = \$1 FOR UPDATE/i.test(sql)) {
        return { rows: [{ inventory_quantity: '0' }] }
      }
      return origQuery(sql, params)
    })
    vi.mocked(withTransaction).mockImplementation(async (fn: any) => fn(client))

    const res = await POST(makePost({}), PARAMS)
    expect(res.status).toBe(200)
    expect((await res.json()).savedAsDraft).toBe(true)
  })

  it('sets order to processing when enableDelivery is true (in-stock)', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(queryOne).mockResolvedValue(FINAL_QUOTATION as any)
    vi.mocked(queryMany)
      .mockResolvedValueOnce([Q_ITEM] as any)
      .mockResolvedValueOnce([{ item_id: 'qi-1', factor: '1', dimension: 'count' }] as any)

    const client = makeMockClient()
    vi.mocked(withTransaction).mockImplementation(async (fn: any) => fn(client))

    const res = await POST(makePost({ enableDelivery: true }), PARAMS)
    expect(res.status).toBe(200)
    expect((await res.json()).needsDelivery).toBe(true)
  })

  it('handles credit payment mode (unpaid)', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(queryOne).mockResolvedValue(FINAL_QUOTATION as any)
    vi.mocked(queryMany)
      .mockResolvedValueOnce([Q_ITEM] as any)
      .mockResolvedValueOnce([{ item_id: 'qi-1', factor: '1', dimension: 'count' }] as any)

    const client = makeMockClient()
    vi.mocked(withTransaction).mockImplementation(async (fn: any) => fn(client))

    const res = await POST(makePost({ paymentMode: 'credit' }), PARAMS)
    expect(res.status).toBe(200)
    expect((await res.json()).success).toBe(true)
  })

  it('handles inter-state GST when buyer has GSTIN in different state', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    const { isInterState } = await import('@/lib/gst')
    vi.mocked(isInterState).mockReturnValue(true)
    vi.mocked(queryOne).mockResolvedValue({
      ...FINAL_QUOTATION,
      buyer_same: false,
      buyer_state: 'Karnataka',
      buyer_gstin: '29ABCDE1234F1Z5',
      buyer_name: 'B',
      buyer_email: 'b@x.com',
      buyer_phone: '9999999999',
    } as any)
    vi.mocked(queryMany)
      .mockResolvedValueOnce([Q_ITEM] as any)
      .mockResolvedValueOnce([{ item_id: 'qi-1', factor: '1', dimension: 'count' }] as any)

    const client = makeMockClient()
    vi.mocked(withTransaction).mockImplementation(async (fn: any) => fn(client))

    const res = await POST(makePost({}), PARAMS)
    expect(res.status).toBe(200)
    expect((await res.json()).success).toBe(true)
  })

  it('generates UPI QR code when paymentMode is upi_qr', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(queryOne).mockResolvedValue(FINAL_QUOTATION as any)
    vi.mocked(queryMany)
      .mockResolvedValueOnce([Q_ITEM] as any)
      .mockResolvedValueOnce([{ item_id: 'qi-1', factor: '1', dimension: 'count' }] as any)

    const client = makeMockClient()
    vi.mocked(withTransaction).mockImplementation(async (fn: any) => fn(client))

    // QR generation throws internally — non-fatal
    vi.mocked(getRazorpayInstance).mockReturnValue({
      qrCode: {
        create: vi.fn().mockRejectedValue(new Error('rzp fail')),
      },
    } as any)

    const res = await POST(makePost({ paymentMode: 'upi_qr' }), PARAMS)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.qrImageUrl).toBeNull()
  })

  it('returns 500 when withTransaction throws', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(queryOne).mockResolvedValue(FINAL_QUOTATION as any)
    vi.mocked(queryMany)
      .mockResolvedValueOnce([Q_ITEM] as any)
      .mockResolvedValueOnce([{ item_id: 'qi-1', factor: '1', dimension: 'count' }] as any)

    vi.mocked(withTransaction).mockRejectedValue(new Error('DB blew up'))

    const res = await POST(makePost({}), PARAMS)
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('DB blew up')
  })

  it('handles unit factor > 1 for count dimension (multiplies qty)', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(queryOne).mockResolvedValue(FINAL_QUOTATION as any)
    vi.mocked(queryMany)
      .mockResolvedValueOnce([Q_ITEM] as any)
      .mockResolvedValueOnce([{ item_id: 'qi-1', factor: '10', dimension: 'count' }] as any)

    const client = makeMockClient()
    vi.mocked(withTransaction).mockImplementation(async (fn: any) => fn(client))

    const res = await POST(makePost({}), PARAMS)
    expect(res.status).toBe(200)
    expect((await res.json()).success).toBe(true)
  })

  it('handles items without product_id (service line, no stock check)', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(queryOne).mockResolvedValue(FINAL_QUOTATION as any)
    vi.mocked(queryMany)
      .mockResolvedValueOnce([{ ...Q_ITEM, product_id: null }] as any)
      .mockResolvedValueOnce([{ item_id: 'qi-1', factor: '1', dimension: 'count' }] as any)

    const client = makeMockClient()
    vi.mocked(withTransaction).mockImplementation(async (fn: any) => fn(client))

    const res = await POST(makePost({}), PARAMS)
    expect(res.status).toBe(200)
    expect((await res.json()).success).toBe(true)
  })

  it('handles serialized product with insufficient serials (throws → 500)', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(queryOne).mockResolvedValue(FINAL_QUOTATION as any)
    vi.mocked(queryMany)
      .mockResolvedValueOnce([Q_ITEM] as any)
      .mockResolvedValueOnce([{ item_id: 'qi-1', factor: '1', dimension: 'count' }] as any)

    const client = makeMockClient()
    const origQuery = client.query
    client.query = vi.fn().mockImplementation(async (sql: string, params?: any[]) => {
      // deductOrderStock resolves product kind via `perishable, serialized`
      if (/SELECT perishable, serialized FROM products/i.test(sql)) {
        return { rows: [{ perishable: false, serialized: true }] }
      }
      return origQuery(sql, params)
    })
    vi.mocked(withTransaction).mockImplementation(async (fn: any) => fn(client))

    const res = await POST(makePost({ serial_assignments: [] }), PARAMS)
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/Serial numbers required/)
  })

  it('syncs shelf stock for perishable products', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(queryOne).mockResolvedValue(FINAL_QUOTATION as any)
    vi.mocked(queryMany)
      .mockResolvedValueOnce([Q_ITEM] as any)
      .mockResolvedValueOnce([{ item_id: 'qi-1', factor: '1', dimension: 'count' }] as any)

    const client = makeMockClient()
    const origQuery = client.query
    client.query = vi.fn().mockImplementation(async (sql: string, params?: any[]) => {
      if (/SELECT perishable, serialized FROM products/i.test(sql)) {
        return { rows: [{ perishable: true, serialized: false }] }
      }
      return origQuery(sql, params)
    })
    vi.mocked(withTransaction).mockImplementation(async (fn: any) => fn(client))

    const { syncPerishableStock } = await import('@/lib/shelf')
    const res = await POST(makePost({}), PARAMS)
    expect(res.status).toBe(200)
    expect(syncPerishableStock).toHaveBeenCalled()
  })
})
