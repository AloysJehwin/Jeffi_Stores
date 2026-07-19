import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks (must be before imports) ────────────────────────────────────────────

vi.mock('@/lib/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
  withTransaction: vi.fn(),
}))
vi.mock('@/lib/gst', () => ({
  getFinancialYear: vi.fn().mockReturnValue('2024-25'),
  generateInvoiceNumber: vi.fn().mockReturnValue('JS/2024-25/0001'),
  getNextInvoiceSequence: vi.fn().mockResolvedValue(1),
  round2: (n: number) => Math.round(n * 100) / 100,
}))
vi.mock('@/lib/inventory', () => ({ logStockMovement: vi.fn() }))
vi.mock('@/lib/email', () => ({ sendInvoiceFinalizedEmail: vi.fn(), sendOrderStatusUpdate: vi.fn() }))
vi.mock('@/lib/invoice', () => ({ generateOrderInvoice: vi.fn(), assignInvoiceNumber: vi.fn().mockResolvedValue('JS/2024-25/0001') }))

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { POST } from '@/app/api/admin/invoices/drafts/[id]/finalize/route'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryOne, withTransaction } from '@/lib/db'
import { sendInvoiceFinalizedEmail, sendOrderStatusUpdate } from '@/lib/email'
import { generateOrderInvoice } from '@/lib/invoice'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockQueryOne = vi.mocked(queryOne)
const mockWithTransaction = vi.mocked(withTransaction)
const mockSendEmail = vi.mocked(sendInvoiceFinalizedEmail)
const mockSendOrderStatusUpdate = vi.mocked(sendOrderStatusUpdate)
const mockGenerateInvoice = vi.mocked(generateOrderInvoice)

// ── Helpers ───────────────────────────────────────────────────────────────────

const ADMIN = { adminId: 'admin-1', role: 'super_admin', scopes: ['invoices'] }

function makeRequest(id = 'order-123') {
  return new NextRequest(`http://localhost/api/admin/invoices/drafts/${id}/finalize`, {
    method: 'POST',
  })
}

const draftOrder = {
  id: 'order-123',
  status: 'draft',
  customer_name: 'Alice',
  customer_email: 'alice@example.com',
  total_amount: '1200.00',
  order_number: 'ORD-001',
}

const confirmedOrder = { ...draftOrder, status: 'confirmed', source: 'online' }

// Build a mock DB client whose query() responses are driven by SQL content.
// itemsRows: the rows returned for SELECT * FROM order_items
// stockQty: inventory_quantity returned for any stock lookup
// hasSubs: whether variant has sub-variants
function makeTxClient({
  itemsRows = [] as any[],
  stockQty = 100,
  hasSubs = false,
  hasInvoicePrefix = true,
} = {}) {
  return {
    query: vi.fn().mockImplementation((sql: string) => {
      // FOR UPDATE lock on orders
      if (sql.includes('SELECT id FROM orders') && sql.includes('FOR UPDATE')) {
        return Promise.resolve({ rows: [{ id: 'order-123' }] })
      }
      // order_items
      if (sql.includes('FROM order_items')) {
        return Promise.resolve({ rows: itemsRows })
      }
      // sub_variant stock
      if (sql.includes('FROM product_sub_variants') && sql.includes('FOR UPDATE')) {
        return Promise.resolve({ rows: [{ inventory_quantity: stockQty }] })
      }
      // variant stock (with has_sub_variants computed)
      if (sql.includes('FROM product_variants pv WHERE pv.id')) {
        return Promise.resolve({ rows: [{ inventory_quantity: stockQty, has_sub_variants: hasSubs }] })
      }
      // variant stock via shared deductOrderStock helper (plain, alias-less SELECT)
      if (sql.includes('FROM product_variants WHERE id') && sql.includes('FOR UPDATE')) {
        return Promise.resolve({ rows: [{ inventory_quantity: stockQty }] })
      }
      // aggregate sub-variant stock for variant
      if (sql.includes('COALESCE(SUM(inventory_quantity)')) {
        return Promise.resolve({ rows: [{ total: stockQty }] })
      }
      // product-level stock
      if (sql.includes('FROM products WHERE id') && sql.includes('FOR UPDATE')) {
        return Promise.resolve({ rows: [{ inventory_quantity: stockQty }] })
      }
      // invoice prefix setting
      if (sql.includes('SELECT value FROM site_settings')) {
        return Promise.resolve({ rows: hasInvoicePrefix ? [{ value: 'JS' }] : [] })
      }
      // any UPDATE / INSERT
      return Promise.resolve({ rows: [] })
    }),
  }
}

// Make withTransaction actually invoke the callback with the supplied client
function setupTx(client: any) {
  mockWithTransaction.mockImplementation(async (fn: any) => fn(client))
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/admin/invoices/drafts/[id]/finalize', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.ENABLE_GST = 'false'
  })

  // ── Auth / guard tests ──────────────────────────────────────────────────────

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null as any)
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'order-123' }) })
    expect(res.status).toBe(401)
    expect((await res.json()).error).toBe('Unauthorized')
  })

  it('returns 403 when scope missing', async () => {
    mockAuth.mockResolvedValue(ADMIN as any)
    mockHasScope.mockReturnValue(false)
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'order-123' }) })
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe('Insufficient permissions')
  })

  it('returns 404 when order not found', async () => {
    mockAuth.mockResolvedValue(ADMIN as any)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValueOnce(null)
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'order-123' }) })
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('Draft not found')
  })

  it('returns 400 when order is already finalized', async () => {
    mockAuth.mockResolvedValue(ADMIN as any)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValueOnce({ ...draftOrder, status: 'invoiced' })
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'order-123' }) })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Invoice is already finalized')
  })

  it('returns 500 on unexpected DB error before transaction', async () => {
    mockAuth.mockResolvedValue(ADMIN as any)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockRejectedValueOnce(new Error('DB connection failed'))
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'order-123' }) })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('DB connection failed')
  })

  // ── Transaction body: no-items error ───────────────────────────────────────

  it('returns 500 when order has no items', async () => {
    mockAuth.mockResolvedValue(ADMIN as any)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValueOnce(draftOrder)
    const client = makeTxClient({ itemsRows: [] })
    setupTx(client)
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'order-123' }) })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('Cannot finalize an invoice with no items')
  })

  // ── Transaction body: product_id = null ────────────────────────────────────

  it('skips stock deduction when item has no product_id', async () => {
    mockAuth.mockResolvedValue(ADMIN as any)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValueOnce(draftOrder)
    const client = makeTxClient({
      itemsRows: [{ product_id: null, variant_id: null, sub_variant_id: null, quantity: '1', product_name: 'Gift' }],
    })
    setupTx(client)
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'order-123' }) })
    expect(res.status).toBe(200)
    expect((await res.json()).success).toBe(true)
  })

  // ── Transaction body: sub_variant_id path ──────────────────────────────────

  it('deducts sub-variant stock on happy path (no GST)', async () => {
    mockAuth.mockResolvedValue(ADMIN as any)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValueOnce(draftOrder)
    const client = makeTxClient({
      itemsRows: [{
        product_id: 'p1', variant_id: 'v1', sub_variant_id: 'sv1',
        quantity: '2', product_name: 'Widget', variant_name: 'Red',
      }],
      stockQty: 10,
    })
    setupTx(client)
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'order-123' }) })
    expect(res.status).toBe(200)
    expect((await res.json()).success).toBe(true)
  })

  it('returns 500 when sub-variant stock insufficient', async () => {
    mockAuth.mockResolvedValue(ADMIN as any)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValueOnce(draftOrder)
    const client = makeTxClient({
      itemsRows: [{
        product_id: 'p1', variant_id: 'v1', sub_variant_id: 'sv1',
        quantity: '50', product_name: 'Widget', variant_name: 'Red',
      }],
      stockQty: 2,
    })
    setupTx(client)
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'order-123' }) })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toContain('Insufficient stock')
  })

  // ── Transaction body: variant_id path (no sub-variants) ───────────────────

  it('deducts variant stock when variant_id set and no sub-variants (no GST)', async () => {
    mockAuth.mockResolvedValue(ADMIN as any)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValueOnce(draftOrder)
    const client = makeTxClient({
      itemsRows: [{
        product_id: 'p1', variant_id: 'v1', sub_variant_id: null,
        quantity: '3', product_name: 'Widget', variant_name: 'Blue',
      }],
      stockQty: 20,
      hasSubs: false,
    })
    setupTx(client)
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'order-123' }) })
    expect(res.status).toBe(200)
    expect((await res.json()).success).toBe(true)
  })

  it('returns 500 when variant stock insufficient', async () => {
    mockAuth.mockResolvedValue(ADMIN as any)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValueOnce(draftOrder)
    const client = makeTxClient({
      itemsRows: [{
        product_id: 'p1', variant_id: 'v1', sub_variant_id: null,
        quantity: '30', product_name: 'Widget', variant_name: 'Blue',
      }],
      stockQty: 5,
      hasSubs: false,
    })
    setupTx(client)
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'order-123' }) })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toContain('Insufficient stock')
  })

  // ── Transaction body: variant_id with sub-variants (aggregated stock) ──────

  it('deducts via sub-variant sku when variant has_sub_variants (no GST)', async () => {
    mockAuth.mockResolvedValue(ADMIN as any)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValueOnce(draftOrder)
    const client = makeTxClient({
      itemsRows: [{
        product_id: 'p1', variant_id: 'v1', sub_variant_id: null,
        quantity: '3', product_name: 'Widget', variant_name: null,
        product_sku: 'SKU-01',
      }],
      stockQty: 20,
      hasSubs: true,
    })
    setupTx(client)
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'order-123' }) })
    expect(res.status).toBe(200)
  })

  it('returns 500 when aggregated sub-variant stock insufficient', async () => {
    mockAuth.mockResolvedValue(ADMIN as any)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValueOnce(draftOrder)
    const client = makeTxClient({
      itemsRows: [{
        product_id: 'p1', variant_id: 'v1', sub_variant_id: null,
        quantity: '25', product_name: 'Widget', variant_name: null,
        product_sku: 'SKU-01',
      }],
      stockQty: 3,
      hasSubs: true,
    })
    setupTx(client)
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'order-123' }) })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toContain('Insufficient stock')
  })

  // ── Transaction body: product-only path (no variant) ──────────────────────

  it('deducts product-level stock when no variant_id (no GST)', async () => {
    mockAuth.mockResolvedValue(ADMIN as any)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValueOnce(draftOrder)
    const client = makeTxClient({
      itemsRows: [{
        product_id: 'p1', variant_id: null, sub_variant_id: null,
        quantity: '1', product_name: 'Simple Product',
      }],
      stockQty: 10,
    })
    setupTx(client)
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'order-123' }) })
    expect(res.status).toBe(200)
    expect((await res.json()).success).toBe(true)
  })

  it('returns 500 when product-level stock insufficient', async () => {
    mockAuth.mockResolvedValue(ADMIN as any)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValueOnce(draftOrder)
    const client = makeTxClient({
      itemsRows: [{
        product_id: 'p1', variant_id: null, sub_variant_id: null,
        quantity: '20', product_name: 'Simple Product',
      }],
      stockQty: 1,
    })
    setupTx(client)
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'order-123' }) })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toContain('Insufficient stock')
  })

  // ── GST enabled: draft order ───────────────────────────────────────────────

  it('generates invoice number when ENABLE_GST=true (draft order)', async () => {
    process.env.ENABLE_GST = 'true'
    mockAuth.mockResolvedValue(ADMIN as any)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValueOnce({ ...draftOrder, customer_email: null })
    const client = makeTxClient({
      itemsRows: [{
        product_id: 'p1', variant_id: null, sub_variant_id: null,
        quantity: '1', product_name: 'Item A',
      }],
      stockQty: 50,
    })
    setupTx(client)
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'order-123' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.invoiceNumber).toBe('JS/2024-25/0001')
    expect(body.invoiceUrl).toBe('/api/orders/order-123/invoice')
  })

  it('sends finalized email for draft+GST when customer has email', async () => {
    process.env.ENABLE_GST = 'true'
    mockAuth.mockResolvedValue(ADMIN as any)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValueOnce(draftOrder)
    const client = makeTxClient({
      itemsRows: [{
        product_id: 'p1', variant_id: null, sub_variant_id: null,
        quantity: '1', product_name: 'Item A',
      }],
      stockQty: 50,
    })
    setupTx(client)
    mockSendEmail.mockResolvedValueOnce(undefined as any)
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'order-123' }) })
    expect(res.status).toBe(200)
    expect(mockSendEmail).toHaveBeenCalledWith(
      'alice@example.com', 'Alice', 'JS/2024-25/0001', 1200, 'ORD-001'
    )
  })

  it('does not propagate email errors (draft+GST)', async () => {
    process.env.ENABLE_GST = 'true'
    mockAuth.mockResolvedValue(ADMIN as any)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValueOnce(draftOrder)
    const client = makeTxClient({
      itemsRows: [{
        product_id: 'p1', variant_id: null, sub_variant_id: null,
        quantity: '1', product_name: 'Item A',
      }],
      stockQty: 50,
    })
    setupTx(client)
    mockSendEmail.mockRejectedValueOnce(new Error('SMTP down'))
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'order-123' }) })
    expect(res.status).toBe(200)
    expect((await res.json()).success).toBe(true)
  })

  // ── GST enabled: confirmed (online) order ─────────────────────────────────

  it('generates PDF invoice for confirmed online order (GST)', async () => {
    process.env.ENABLE_GST = 'true'
    mockAuth.mockResolvedValue(ADMIN as any)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValueOnce(confirmedOrder)
    const client = makeTxClient({
      itemsRows: [{
        product_id: 'p1', variant_id: null, sub_variant_id: null,
        quantity: '1', product_name: 'Item A',
      }],
      stockQty: 50,
    })
    setupTx(client)
    mockGenerateInvoice.mockResolvedValueOnce(undefined as any)
    mockSendOrderStatusUpdate.mockResolvedValueOnce(undefined as any)
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'order-123' }) })
    expect(res.status).toBe(200)
    expect(mockGenerateInvoice).toHaveBeenCalledWith('order-123')
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it('does not propagate invoice PDF generation errors (online+GST)', async () => {
    process.env.ENABLE_GST = 'true'
    mockAuth.mockResolvedValue(ADMIN as any)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValueOnce(confirmedOrder)
    const client = makeTxClient({
      itemsRows: [{
        product_id: 'p1', variant_id: null, sub_variant_id: null,
        quantity: '1', product_name: 'Item A',
      }],
      stockQty: 50,
    })
    setupTx(client)
    mockGenerateInvoice.mockRejectedValueOnce(new Error('PDF render failed'))
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'order-123' }) })
    expect(res.status).toBe(200)
    expect((await res.json()).success).toBe(true)
  })

  it('skips email when confirmed order has no customer email (GST)', async () => {
    process.env.ENABLE_GST = 'true'
    mockAuth.mockResolvedValue(ADMIN as any)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValueOnce({ ...confirmedOrder, customer_email: null })
    const client = makeTxClient({
      itemsRows: [{
        product_id: 'p1', variant_id: null, sub_variant_id: null,
        quantity: '1', product_name: 'Item A',
      }],
      stockQty: 50,
    })
    setupTx(client)
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'order-123' }) })
    expect(res.status).toBe(200)
    expect(mockGenerateInvoice).not.toHaveBeenCalled()
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  // ── GST: invoice prefix fallback to 'JS' ──────────────────────────────────

  it('falls back to JS prefix when site_settings has no invoice_prefix', async () => {
    process.env.ENABLE_GST = 'true'
    mockAuth.mockResolvedValue(ADMIN as any)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValueOnce({ ...draftOrder, customer_email: null })
    const client = makeTxClient({
      itemsRows: [{
        product_id: 'p1', variant_id: null, sub_variant_id: null,
        quantity: '1', product_name: 'Item A',
      }],
      stockQty: 50,
      hasInvoicePrefix: false,
    })
    setupTx(client)
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'order-123' }) })
    expect(res.status).toBe(200)
    expect((await res.json()).invoiceNumber).toBe('JS/2024-25/0001')
  })
})
