import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ---------------------------------------------------------------------------
// Mocks — module boundaries only; pricing / GST / line-item rules run for real.
// ---------------------------------------------------------------------------

vi.mock('../../src/lib/reply-context', () => ({ invoiceReply: async () => null, recordEmailSend: async () => {} }))
vi.mock('@/lib/shared/customer-links', () => ({
  documentUrl: vi.fn(async (app: string, token: string) => `https://${app}-acme.jeffistores.in/${token}`),
  orderUrlById: vi.fn(async (id: string) => `https://acme.jeffistores.in/account/orders/${id}`),
  invoiceUrlForOrder: vi.fn(async () => 'https://invoice-acme.jeffistores.in/TOKEN'),
}))
vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({ queryOne: vi.fn(), withTransaction: vi.fn() }))
vi.mock('@/lib/orders/inventory', () => ({
  logStockMovement: vi.fn(),
  recomputeStockStatusForProduct: vi.fn(),
}))
vi.mock('@/lib/catalog/shelf', () => ({
  syncPerishableStock: vi.fn(),
  decrementNonPerishableShelfStock: vi.fn(),
}))
vi.mock('@/lib/email', () => ({ sendInvoiceFinalizedEmail: vi.fn() }))
vi.mock('@/lib/orders/inventory-deduct', async orig => ({
  ...(await orig<typeof import('@/lib/orders/inventory-deduct')>()),
  deleteBatchIfEmpty: vi.fn(),
}))
vi.mock('@/lib/catalog/site-controls', () => ({
  getFeatureFlags: vi.fn(),
  getBusinessValues: vi.fn(),
}))

import { PATCH } from '@/app/api/(admin)/admin/invoices/[id]/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { queryOne, withTransaction } from '@/lib/shared/db'
import { sendInvoiceFinalizedEmail } from '@/lib/email'
import { logStockMovement } from '@/lib/orders/inventory'
import { syncPerishableStock, decrementNonPerishableShelfStock } from '@/lib/catalog/shelf'
import { deleteBatchIfEmpty } from '@/lib/orders/inventory-deduct'
import { getFeatureFlags, getBusinessValues } from '@/lib/catalog/site-controls'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ADMIN = { adminId: 'admin-1', id: 'admin-1', role: 'super_admin', scopes: ['invoices'] }
const ORDER_ID = '550e8400-e29b-41d4-a716-446655440000'
const PRODUCT_ID = '111e4567-e89b-12d3-a456-426614174001'
const VARIANT_ID = '222e4567-e89b-12d3-a456-426614174002'
const SUB_VARIANT_ID = '333e4567-e89b-12d3-a456-426614174003'
const params = { params: Promise.resolve({ id: ORDER_ID }) }

function patchReq(body: unknown) {
  return new NextRequest(
    new Request(`http://localhost/api/admin/invoices/${ORDER_ID}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  )
}

const VALID_BODY = {
  customerName: 'Test Customer',
  customerEmail: 'test@example.com',
  customerPhone: '9876543210',
  addressLine1: '123 Main St',
  addressLine2: null,
  city: 'Chennai',
  state: 'Tamil Nadu',
  postalCode: '600001',
  buyerGstin: null,
  paymentMode: 'cash',
  invoiceDate: '2024-04-01',
  notes: null,
  items: [
    {
      product_id: PRODUCT_ID,
      product_name: 'Widget A',
      product_sku: 'WGT-A',
      variant_id: null,
      sub_variant_id: null,
      unit_price: '100',
      quantity: '2',
      gst_rate: '18',
      discount_pct: '0',
    },
  ],
}

const withItem = (patch: Record<string, unknown>) => ({ ...VALID_BODY, items: [{ ...VALID_BODY.items[0], ...patch }] })

const OFFLINE_ORDER = {
  id: ORDER_ID,
  source: 'offline',
  invoice_number: 'JS/24-25/APR/1',
  status: 'invoiced',
}

interface ClientOpts {
  existing?: any[] // order_items already on the invoice
  unit?: any // resolveLineUnit row (product_units)
  stock?: string // inventory_quantity at the targeted grain
  flags?: { perishable: boolean; serialized: boolean }
  batches?: any[]
  serials?: any[]
}

/** Fake pg client that answers by SQL shape, so tests don't depend on call order. */
function makeClient(o: ClientOpts = {}) {
  const calls: { sql: string; params: any[] }[] = []
  const client: any = {
    calls,
    release: vi.fn(),
    query: vi.fn(async (sql: string, p: any[] = []) => {
      calls.push({ sql, params: p })
      if (/^\s*SELECT[\s\S]*FROM order_items WHERE order_id/.test(sql)) return { rows: o.existing ?? [] }
      if (/FROM product_units/.test(sql)) return { rows: o.unit ? [o.unit] : [] }
      if (/SELECT inventory_quantity FROM/.test(sql)) return { rows: [{ inventory_quantity: o.stock ?? '100' }] }
      if (/INSERT INTO order_items/.test(sql)) return { rows: [{ id: 'item-1' }] }
      if (/SELECT perishable, serialized/.test(sql))
        return { rows: [o.flags ?? { perishable: false, serialized: false }] }
      if (/FROM product_batches/.test(sql) && /SELECT id, quantity_remaining/.test(sql))
        return { rows: o.batches ?? [] }
      if (/FROM product_serials/.test(sql)) return { rows: o.serials ?? [] }
      if (/UPDATE product_batches/.test(sql) && /RETURNING/.test(sql))
        return { rows: [{ lot_number: 'L1', expiry_date: '2025-01-01' }] }
      return { rows: [] }
    }),
  }
  return client
}

function useClient(o: ClientOpts = {}) {
  const client = makeClient(o)
  vi.mocked(withTransaction).mockImplementation(async (fn: any) => fn(client))
  return client
}

const sqlCalls = (client: any, re: RegExp) => client.calls.filter((c: any) => re.test(c.sql))

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PATCH /api/admin/invoices/[id]', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(queryOne).mockResolvedValue(OFFLINE_ORDER as any)
    vi.mocked(getFeatureFlags).mockResolvedValue({ gstEnabled: true, inventoryValidationEnabled: true } as any)
    vi.mocked(getBusinessValues).mockResolvedValue({ businessStateCode: '33' } as any)
    vi.mocked(logStockMovement).mockResolvedValue(undefined as any)
    vi.mocked(sendInvoiceFinalizedEmail).mockResolvedValue(undefined as any)
    vi.mocked(syncPerishableStock).mockResolvedValue(undefined as any)
    vi.mocked(decrementNonPerishableShelfStock).mockResolvedValue(undefined as any)
    vi.mocked(deleteBatchIfEmpty).mockResolvedValue(false as any)
  })

  // --- Auth / permission guards ---

  it('returns 401 when not authenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    const res = await PATCH(patchReq(VALID_BODY), params)
    expect(res.status).toBe(401)
    expect((await res.json()).error).toBe('Unauthorized')
  })

  it('returns 403 when scope is missing', async () => {
    vi.mocked(hasScope).mockReturnValue(false)
    const res = await PATCH(patchReq(VALID_BODY), params)
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe('Insufficient permissions')
  })

  // --- Not found / wrong type ---

  it('returns 404 when order does not exist', async () => {
    vi.mocked(queryOne).mockResolvedValue(null as any)
    const res = await PATCH(patchReq(VALID_BODY), params)
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('Invoice not found')
  })

  it('returns 400 when order source is not offline', async () => {
    vi.mocked(queryOne).mockResolvedValue({ ...OFFLINE_ORDER, source: 'online' } as any)
    const res = await PATCH(patchReq(VALID_BODY), params)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/offline/)
  })

  // --- Validation (zod, field-level) ---

  it('returns 400 with a field message when customerName is missing', async () => {
    const res = await PATCH(patchReq({ ...VALID_BODY, customerName: '' }), params)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.fields.customerName).toMatch(/Customer name is required/)
  })

  it('returns 400 when items array is empty', async () => {
    const res = await PATCH(patchReq({ ...VALID_BODY, items: [] }), params)
    expect(res.status).toBe(400)
    expect((await res.json()).fields.items).toMatch(/at least one/)
  })

  it('returns 400 with item field messages for zero quantity and out-of-range GST', async () => {
    const res = await PATCH(patchReq(withItem({ quantity: '0', gst_rate: '55' })), params)
    expect(res.status).toBe(400)
    const { fields } = await res.json()
    expect(fields['items.0.quantity']).toMatch(/greater than 0/)
    expect(fields['items.0.gst_rate']).toMatch(/cannot exceed/)
  })

  // --- Happy path ---

  it('returns 200 success when stock is sufficient and deducts the extra pieces', async () => {
    const client = useClient()
    const res = await PATCH(patchReq(VALID_BODY), params)
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(json.savedItemIds).toEqual([{ product_id: PRODUCT_ID, variant_id: null, order_item_id: 'item-1' }])
    expect(logStockMovement).toHaveBeenCalledWith(client, expect.objectContaining({ quantityChange: -2 }))
    expect(sqlCalls(client, /UPDATE products SET inventory_quantity/)).toHaveLength(1)
  })

  // --- Draft fallback when stock insufficient ---

  it('returns movedToDraft with shortfall details when stock is insufficient', async () => {
    const client = useClient({ stock: '1' })
    const res = await PATCH(patchReq(VALID_BODY), params)
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.movedToDraft).toBe(true)
    expect(json.insufficientItems).toEqual(['Widget A — need 2 pcs, available 1 pcs, short 1 pcs'])
    expect(json.insufficientDetails[0]).toMatchObject({ required_base: 2, available_base: 1, short_base: 1 })
    // invoice number dropped, no deduction
    expect(sqlCalls(client, /DELETE FROM invoices/)).toHaveLength(1)
    expect(logStockMovement).not.toHaveBeenCalled()
  })

  // --- Email notification ---

  it('sends invoice email when order has invoice_number and customerEmail', async () => {
    useClient()
    await PATCH(patchReq(VALID_BODY), params)
    expect(sendInvoiceFinalizedEmail).toHaveBeenCalledWith(
      'test@example.com',
      'Test Customer',
      'JS/24-25/APR/1',
      expect.any(Number),
      undefined,
      'https://invoice-acme.jeffistores.in/TOKEN',
      null
    )
  })

  it('does not send email when customerEmail is absent', async () => {
    useClient()
    await PATCH(patchReq({ ...VALID_BODY, customerEmail: null }), params)
    expect(sendInvoiceFinalizedEmail).not.toHaveBeenCalled()
  })

  // --- Variant / sub-variant stock paths ---

  it('checks variant stock when item has variant_id', async () => {
    const client = useClient()
    const res = await PATCH(patchReq(withItem({ variant_id: VARIANT_ID })), params)
    expect(res.status).toBe(200)
    expect(sqlCalls(client, /SELECT inventory_quantity FROM product_variants/).length).toBeGreaterThan(0)
  })

  it('checks sub_variant stock when item has sub_variant_id', async () => {
    const client = useClient()
    const res = await PATCH(patchReq(withItem({ variant_id: VARIANT_ID, sub_variant_id: SUB_VARIANT_ID })), params)
    expect(res.status).toBe(200)
    expect(sqlCalls(client, /SELECT inventory_quantity FROM product_sub_variants/).length).toBeGreaterThan(0)
  })

  // --- IGST path ---

  it('uses IGST when buyer has GSTIN and is inter-state', async () => {
    const client = useClient()
    const res = await PATCH(patchReq({ ...VALID_BODY, buyerGstin: '27AABCU9603R1ZM', state: 'Maharashtra' }), params)
    expect(res.status).toBe(200)
    const upd = sqlCalls(client, /UPDATE orders SET/)[0]
    expect(upd.params[4]).toBe(true) // is_igst
    expect(upd.params[10]).toBeGreaterThan(0) // igst_amount
    expect(upd.params[8]).toBe(0) // cgst_amount
  })

  // --- Error handling ---

  it('returns 500 on unexpected error', async () => {
    vi.mocked(withTransaction).mockRejectedValue(new Error('DB connection lost'))
    const res = await PATCH(patchReq(VALID_BODY), params)
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('DB connection lost')
  })

  // --- Custom line ---

  it('skips stock check and deduction for a custom line without product_id', async () => {
    const client = useClient()
    const res = await PATCH(patchReq(withItem({ product_id: null, product_sku: null, unit: 'job' })), params)
    expect(res.status).toBe(200)
    expect(sqlCalls(client, /FROM product_units/)).toHaveLength(0)
    expect(sqlCalls(client, /SELECT inventory_quantity/)).toHaveLength(0)
    expect(logStockMovement).not.toHaveBeenCalled()
    const ins = sqlCalls(client, /INSERT INTO order_items/)[0]
    expect(ins.params[1]).toBeNull() // product_id
    expect(ins.params[11]).toBe('JOB') // buy_unit carries the custom unit
  })

  // --- Insufficient stock on variant / sub-variant ---

  it('reports insufficient variant stock (moveToDraft) with variant_name label', async () => {
    useClient({ stock: '1' })
    const res = await PATCH(patchReq(withItem({ variant_id: VARIANT_ID, variant_name: 'Blue' })), params)
    const json = await res.json()
    expect(json.movedToDraft).toBe(true)
    expect(json.insufficientItems[0]).toMatch(/Blue/)
  })

  it('reports insufficient sub_variant stock (moveToDraft)', async () => {
    useClient({ stock: '0' })
    const res = await PATCH(
      patchReq(withItem({ variant_id: VARIANT_ID, sub_variant_id: SUB_VARIANT_ID, variant_name: 'Small' })),
      params
    )
    const json = await res.json()
    expect(json.movedToDraft).toBe(true)
    expect(json.insufficientItems[0]).toMatch(/Small/)
  })

  // --- Unit conversion via resolveLineUnit ---

  it('scales extra qty by the selling-unit factor (2 × BOX of 5 → 10 pcs)', async () => {
    useClient({ unit: { unit: 'BOX', factor: '5', dimension: 'count', qty_step: '1', min_qty: '1', max_qty: null } })
    const res = await PATCH(patchReq(withItem({ buy_unit: 'BOX' })), params)
    expect(res.status).toBe(200)
    expect(logStockMovement).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ quantityChange: -10 }))
  })

  it('reports a shortfall in both the selling unit and pieces', async () => {
    useClient({
      stock: '15',
      unit: { unit: 'SET', factor: '10', dimension: 'count', qty_step: '1', min_qty: '1', max_qty: null },
    })
    const res = await PATCH(patchReq(withItem({ buy_unit: 'SET' })), params)
    const json = await res.json()
    expect(json.movedToDraft).toBe(true)
    expect(json.insufficientItems[0]).toBe('Widget A — need 2 SET (20 pcs), available 15 pcs, short 5 pcs (0.5 SET)')
  })

  // --- Deduction: perishable (batch FIFO) ---

  it('deducts from batches FIFO for perishable product', async () => {
    useClient({
      flags: { perishable: true, serialized: false },
      batches: [
        { id: 'batch-1', quantity_remaining: '1', lot_number: 'L1', expiry_date: '2025-01-01' },
        { id: 'batch-2', quantity_remaining: '10', lot_number: 'L2', expiry_date: '2025-06-01' },
      ],
    })
    const res = await PATCH(patchReq(VALID_BODY), params)
    expect((await res.json()).success).toBe(true)
    expect(logStockMovement).toHaveBeenCalledTimes(2)
    expect(deleteBatchIfEmpty).toHaveBeenCalled()
    expect(syncPerishableStock).toHaveBeenCalled()
  })

  // --- Deduction: serialized ---

  it('marks serials sold for serialized product, linked to the saved order item', async () => {
    const client = useClient({
      flags: { perishable: false, serialized: true },
      serials: [
        { id: 's1', serial_number: 'SN1', batch_id: 'b1' },
        { id: 's2', serial_number: 'SN2', batch_id: null },
      ],
    })
    const res = await PATCH(patchReq(VALID_BODY), params)
    expect((await res.json()).success).toBe(true)
    expect(logStockMovement).toHaveBeenCalledTimes(2)
    expect(logStockMovement).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ quantityChange: -1, serialNumber: 'SN1' })
    )
    const sold = sqlCalls(client, /UPDATE product_serials SET status = 'sold'/)
    expect(sold[0].params[1]).toBe('item-1')
    expect(deleteBatchIfEmpty).toHaveBeenCalledWith(expect.anything(), 'b1')
    expect(syncPerishableStock).toHaveBeenCalled()
  })

  // --- Deduction: plain variant + sub_variant ---

  it('deducts plain stock from variant when item has variant_id (no sub_variant)', async () => {
    const client = useClient()
    const res = await PATCH(patchReq(withItem({ variant_id: VARIANT_ID })), params)
    expect(res.status).toBe(200)
    expect(sqlCalls(client, /UPDATE product_variants SET inventory_quantity/)).toHaveLength(1)
    expect(decrementNonPerishableShelfStock).toHaveBeenCalled()
  })

  it('deducts plain stock from sub_variant when item has sub_variant_id', async () => {
    const client = useClient()
    const res = await PATCH(patchReq(withItem({ variant_id: VARIANT_ID, sub_variant_id: SUB_VARIANT_ID })), params)
    expect(res.status).toBe(200)
    expect(sqlCalls(client, /UPDATE product_sub_variants SET inventory_quantity/)).toHaveLength(1)
    expect(decrementNonPerishableShelfStock).toHaveBeenCalled()
  })

  // --- Only the extra beyond what was already sold ---

  it('skips deduction when quantity is not increased', async () => {
    useClient({
      existing: [{ product_id: PRODUCT_ID, variant_id: null, sub_variant_id: null, quantity: '5', buy_unit: null }],
    })
    const res = await PATCH(patchReq(VALID_BODY), params)
    expect(res.status).toBe(200)
    expect(logStockMovement).not.toHaveBeenCalled()
  })

  it('deducts only the extra base pieces when quantity grows', async () => {
    useClient({
      existing: [{ product_id: PRODUCT_ID, variant_id: null, sub_variant_id: null, quantity: '1', base_quantity: '1' }],
    })
    const res = await PATCH(patchReq(VALID_BODY), params)
    expect(res.status).toBe(200)
    expect(logStockMovement).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ quantityChange: -1 }))
  })

  // --- Draft invoices never deduct here (finalize does it in full) ---

  it('never deducts stock when the invoice is still a draft', async () => {
    vi.mocked(queryOne).mockResolvedValue({ ...OFFLINE_ORDER, status: 'draft', invoice_number: null } as any)
    const client = useClient()
    const res = await PATCH(patchReq(VALID_BODY), params)
    expect(res.status).toBe(200)
    expect(sqlCalls(client, /SELECT product_id, variant_id, sub_variant_id, quantity/)).toHaveLength(0)
    expect(sqlCalls(client, /SET inventory_quantity = inventory_quantity -/)).toHaveLength(0)
    expect(logStockMovement).not.toHaveBeenCalled()
  })

  it('does not touch inventory when the inventory flag is off', async () => {
    vi.mocked(getFeatureFlags).mockResolvedValue({ gstEnabled: true, inventoryValidationEnabled: false } as any)
    const client = useClient({ stock: '0' })
    const res = await PATCH(patchReq(VALID_BODY), params)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.movedToDraft).toBeUndefined()
    expect(sqlCalls(client, /inventory_quantity/)).toHaveLength(0)
    expect(logStockMovement).not.toHaveBeenCalled()
  })

  // --- no addressLine1 => skip address update; no email when invoice_number absent ---

  it('skips address update and email when addressLine1 and invoice_number absent', async () => {
    vi.mocked(queryOne).mockResolvedValue({ ...OFFLINE_ORDER, invoice_number: null } as any)
    const client = useClient()
    const res = await PATCH(patchReq({ ...VALID_BODY, addressLine1: null }), params)
    expect(res.status).toBe(200)
    expect(sqlCalls(client, /UPDATE addresses/)).toHaveLength(0)
    expect(sendInvoiceFinalizedEmail).not.toHaveBeenCalled()
  })

  // --- credit payment mode => payment_status unpaid; invoiceDate default ---

  it('handles credit payment mode and defaults invoiceDate when absent', async () => {
    const client = useClient()
    const res = await PATCH(patchReq({ ...VALID_BODY, paymentMode: 'credit', invoiceDate: null }), params)
    expect(res.status).toBe(200)
    const upd = sqlCalls(client, /UPDATE orders SET/)[0]
    expect(upd.params[12]).toBe('unpaid')
    expect(upd.params[13]).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  // --- discount + sell_unit_factor ---

  it('applies discount and sell_unit_factor when computing line items', async () => {
    const client = useClient()
    const res = await PATCH(patchReq(withItem({ discount_pct: '10', sell_unit_factor: 3 })), params)
    expect(res.status).toBe(200)
    const ins = sqlCalls(client, /INSERT INTO order_items/)[0]
    expect(ins.params[13]).toBe(3) // sold_unit_factor
    expect(ins.params[14]).toBe(6) // base_quantity
    expect(ins.params[17]).toBe(10) // discount_pct
    expect(ins.params[18]).toBeGreaterThan(0) // discount_amount
    // 6 pcs × ₹100 incl. GST less 10% = ₹540
    expect(ins.params[19]).toBe(540)
  })
})
