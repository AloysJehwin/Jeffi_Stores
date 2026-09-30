import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ---------------------------------------------------------------------------
// Mocks — declared before any import of the module under test
// ---------------------------------------------------------------------------

vi.mock('@/lib/auth/jwt', () => ({
  authenticateAdmin: vi.fn(),
}))

vi.mock('@/lib/auth/scopes', () => ({
  hasScope: vi.fn(),
}))

vi.mock('@/lib/shared/db', () => ({
  queryOne: vi.fn(),
  withTransaction: vi.fn(),
}))

vi.mock('@/lib/catalog/gst', () => ({
  isInterState: vi.fn(),
  calculateGST: vi.fn(),
  generateInvoiceNumber: vi.fn(),
  getNextInvoiceSequence: vi.fn(),
  getFinancialYear: vi.fn(),
  round2: (n: number) => Math.round(n * 100) / 100,
}))

vi.mock('@/lib/catalog/pricing', () => ({
  lineItemFromMrpIncl: vi.fn(),
  lineItemExGst: vi.fn(),
}))

vi.mock('@/lib/orders/inventory', () => ({
  logStockMovement: vi.fn(),
}))

vi.mock('@/lib/catalog/shelf', () => ({
  syncPerishableStock: vi.fn().mockResolvedValue(undefined),
  decrementNonPerishableShelfStock: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/catalog/shelf', () => ({
  syncPerishableStock: vi.fn().mockResolvedValue(undefined),
  decrementNonPerishableShelfStock: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/email', () => ({
  sendInvoiceFinalizedEmail: vi.fn(),
}))

vi.mock('@/lib/orders/inventory-deduct', () => ({
  deleteBatchIfEmpty: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/catalog/site-controls', () => ({
  getFeatureFlags: vi.fn().mockResolvedValue({}),
}))

// ---------------------------------------------------------------------------
// Import handlers AFTER mocks
// ---------------------------------------------------------------------------

import { PATCH } from '@/app/api/(admin)/admin/invoices/[id]/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { queryOne, withTransaction } from '@/lib/shared/db'
import { sendInvoiceFinalizedEmail } from '@/lib/email'
import { isInterState, calculateGST, generateInvoiceNumber, getNextInvoiceSequence, getFinancialYear } from '@/lib/catalog/gst'
import { lineItemFromMrpIncl, lineItemExGst } from '@/lib/catalog/pricing'
import { logStockMovement } from '@/lib/orders/inventory'
import { syncPerishableStock, decrementNonPerishableShelfStock } from '@/lib/catalog/shelf'
import { deleteBatchIfEmpty } from '@/lib/orders/inventory-deduct'
import { getFeatureFlags } from '@/lib/catalog/site-controls'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ADMIN = { adminId: 'admin-1', id: 'admin-1', role: 'super_admin', scopes: ['invoices'] }
const ORDER_ID = '550e8400-e29b-41d4-a716-446655440000'

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
      product_id: '111e4567-e89b-12d3-a456-426614174001',
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

const OFFLINE_ORDER = {
  id: ORDER_ID,
  source: 'offline',
  invoice_number: 'JS/24-25/APR/1',
  status: 'invoiced',
}

// A mock client whose query resolves sensibly by default
function makeMockClient(overrides: Record<number, any> = {}) {
  let callCount = 0
  const defaults: any = {
    rows: [{ inventory_quantity: '100' }],
  }
  const client = {
    query: vi.fn().mockImplementation(async () => {
      const idx = callCount++
      return overrides[idx] !== undefined ? overrides[idx] : defaults
    }),
    release: vi.fn(),
  }
  return client
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PATCH /api/admin/invoices/[id]', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(queryOne).mockResolvedValue(OFFLINE_ORDER as any)
    // Re-setup lib mocks cleared by resetAllMocks
    vi.mocked(isInterState).mockReturnValue(false)
    vi.mocked(calculateGST).mockReturnValue({ taxableAmount: 84.75, cgst: 7.63, sgst: 7.63, igst: 0 } as any)
    vi.mocked(generateInvoiceNumber).mockReturnValue('JS/24-25/APR/1')
    vi.mocked(getNextInvoiceSequence).mockResolvedValue(1 as any)
    vi.mocked(getFinancialYear).mockReturnValue('24-25')
    vi.mocked(lineItemFromMrpIncl).mockReturnValue(100)
    vi.mocked(lineItemExGst).mockReturnValue(100)
    vi.mocked(getFeatureFlags).mockResolvedValue({ gstEnabled: true, inventoryValidationEnabled: true } as any)
    vi.mocked(logStockMovement).mockResolvedValue(undefined)
    vi.mocked(sendInvoiceFinalizedEmail).mockResolvedValue(undefined as any)
    vi.mocked(syncPerishableStock).mockResolvedValue(undefined as any)
    vi.mocked(decrementNonPerishableShelfStock).mockResolvedValue(undefined as any)
    vi.mocked(deleteBatchIfEmpty).mockResolvedValue(undefined as any)
  })

  // --- Auth / permission guards ---

  it('returns 401 when not authenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    const res = await PATCH(patchReq(VALID_BODY), { params: Promise.resolve({ id: ORDER_ID }) })
    expect(res.status).toBe(401)
    const json = await res.json()
    expect(json.error).toBe('Unauthorized')
  })

  it('returns 403 when scope is missing', async () => {
    vi.mocked(hasScope).mockReturnValue(false)
    const res = await PATCH(patchReq(VALID_BODY), { params: Promise.resolve({ id: ORDER_ID }) })
    expect(res.status).toBe(403)
    const json = await res.json()
    expect(json.error).toBe('Insufficient permissions')
  })

  // --- Not found / wrong type ---

  it('returns 404 when order does not exist', async () => {
    vi.mocked(queryOne).mockResolvedValue(null as any)
    const res = await PATCH(patchReq(VALID_BODY), { params: Promise.resolve({ id: ORDER_ID }) })
    expect(res.status).toBe(404)
    const json = await res.json()
    expect(json.error).toBe('Invoice not found')
  })

  it('returns 400 when order source is not offline', async () => {
    vi.mocked(queryOne).mockResolvedValue({ ...OFFLINE_ORDER, source: 'online' } as any)
    const res = await PATCH(patchReq(VALID_BODY), { params: Promise.resolve({ id: ORDER_ID }) })
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/offline/)
  })

  // --- Validation ---

  it('returns 400 when customerName is missing', async () => {
    const body = { ...VALID_BODY, customerName: '' }
    const res = await PATCH(patchReq(body), { params: Promise.resolve({ id: ORDER_ID }) })
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/customerName/)
  })

  it('returns 400 when items array is empty', async () => {
    const body = { ...VALID_BODY, items: [] }
    const res = await PATCH(patchReq(body), { params: Promise.resolve({ id: ORDER_ID }) })
    expect(res.status).toBe(400)
  })

  // --- Happy path — sufficient stock, no draft fallback ---

  it('returns 200 success when stock is sufficient', async () => {
    vi.mocked(withTransaction).mockImplementation(async (fn: any) => {
      return fn(
        makeMockClient({
          0: { rows: [] }, // existing order_items
          6: { rows: [{ id: 'item-1' }] }, // INSERT order_item
          8: { rows: [{ perishable: false, serialized: false }] }, // perishable check
        })
      )
    })

    const res = await PATCH(patchReq(VALID_BODY), { params: Promise.resolve({ id: ORDER_ID }) })
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
  })

  // --- Draft fallback when stock insufficient ---

  it('returns movedToDraft=true when stock is insufficient', async () => {
    vi.mocked(withTransaction).mockImplementation(async (fn: any) => {
      return fn(
        makeMockClient({
          0: { rows: [] }, // existing order_items
          2: { rows: [{ inventory_quantity: '1' }] }, // stock check — insufficient (1 < 2)
          7: { rows: [{ id: 'item-1' }] }, // INSERT order_item (slot 7: after UPDATE orders=3, DELETE invoices=4, UPDATE addresses=5, DELETE order_items=6)
        })
      )
    })

    const res = await PATCH(patchReq(VALID_BODY), { params: Promise.resolve({ id: ORDER_ID }) })
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.movedToDraft).toBe(true)
    expect(json.insufficientItems).toBeInstanceOf(Array)
    expect(json.insufficientItems.length).toBeGreaterThan(0)
  })

  // --- Email notification ---

  it('sends invoice email when order has invoice_number and customerEmail', async () => {
    vi.mocked(withTransaction).mockImplementation(async (fn: any) => {
      return fn(
        makeMockClient({
          0: { rows: [] }, // existing order_items
          6: { rows: [{ id: 'item-1' }] }, // INSERT order_item
          8: { rows: [{ perishable: false, serialized: false }] }, // perishable check
        })
      )
    })

    await PATCH(patchReq(VALID_BODY), { params: Promise.resolve({ id: ORDER_ID }) })
    expect(sendInvoiceFinalizedEmail).toHaveBeenCalledWith(
      'test@example.com',
      'Test Customer',
      'JS/24-25/APR/1',
      expect.any(Number)
    )
  })

  it('does not send email when customerEmail is absent', async () => {
    vi.mocked(withTransaction).mockImplementation(async (fn: any) => {
      return fn(
        makeMockClient({
          0: { rows: [] },
          6: { rows: [{ id: 'item-1' }] },
          8: { rows: [{ perishable: false, serialized: false }] },
        })
      )
    })

    await PATCH(patchReq({ ...VALID_BODY, customerEmail: null }), { params: Promise.resolve({ id: ORDER_ID }) })
    expect(sendInvoiceFinalizedEmail).not.toHaveBeenCalled()
  })

  // --- Variant / sub-variant stock paths ---

  it('checks variant stock when item has variant_id', async () => {
    const bodyWithVariant = {
      ...VALID_BODY,
      items: [
        {
          ...VALID_BODY.items[0],
          product_id: '111e4567-e89b-12d3-a456-426614174001',
          variant_id: '222e4567-e89b-12d3-a456-426614174002',
          sub_variant_id: null,
        },
      ],
    }

    vi.mocked(withTransaction).mockImplementation(async (fn: any) => {
      return fn(
        makeMockClient({
          0: { rows: [] },
          6: { rows: [{ id: 'item-1' }] },
          8: { rows: [{ perishable: false, serialized: false }] },
        })
      )
    })

    const res = await PATCH(patchReq(bodyWithVariant), { params: Promise.resolve({ id: ORDER_ID }) })
    expect(res.status).toBe(200)
  })

  it('checks sub_variant stock when item has sub_variant_id', async () => {
    const bodyWithSV = {
      ...VALID_BODY,
      items: [
        {
          ...VALID_BODY.items[0],
          product_id: '111e4567-e89b-12d3-a456-426614174001',
          variant_id: '222e4567-e89b-12d3-a456-426614174002',
          sub_variant_id: '333e4567-e89b-12d3-a456-426614174003',
        },
      ],
    }

    vi.mocked(withTransaction).mockImplementation(async (fn: any) => {
      return fn(
        makeMockClient({
          0: { rows: [] },
          6: { rows: [{ id: 'item-1' }] },
          8: { rows: [{ perishable: false, serialized: false }] },
        })
      )
    })

    const res = await PATCH(patchReq(bodyWithSV), { params: Promise.resolve({ id: ORDER_ID }) })
    expect(res.status).toBe(200)
  })

  // --- IGST path ---

  it('uses IGST when buyer has GSTIN and is inter-state', async () => {
    const { isInterState } = await import('@/lib/catalog/gst')
    vi.mocked(isInterState).mockReturnValue(true)

    const bodyIgst = { ...VALID_BODY, buyerGstin: '27AABCU9603R1ZM', state: 'Maharashtra' }

    vi.mocked(withTransaction).mockImplementation(async (fn: any) => {
      return fn(
        makeMockClient({
          0: { rows: [] },
          6: { rows: [{ id: 'item-1' }] },
          8: { rows: [{ perishable: false, serialized: false }] },
        })
      )
    })

    const res = await PATCH(patchReq(bodyIgst), { params: Promise.resolve({ id: ORDER_ID }) })
    expect(res.status).toBe(200)
  })

  // --- Error handling ---

  it('returns 500 on unexpected error', async () => {
    vi.mocked(withTransaction).mockRejectedValue(new Error('DB connection lost'))
    const res = await PATCH(patchReq(VALID_BODY), { params: Promise.resolve({ id: ORDER_ID }) })
    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json.error).toBe('DB connection lost')
  })

  it('handles item without product_id (skips stock check)', async () => {
    const bodyNoProductId = {
      ...VALID_BODY,
      items: [{ ...VALID_BODY.items[0], product_id: null }],
    }

    vi.mocked(withTransaction).mockImplementation(async (fn: any) => {
      // No stock check loop, no deduction loop — product_id is null
      // Sequence: 0=SELECT order_items, 1=UPDATE orders, 2=UPDATE addresses, 3=DELETE order_items, 4=INSERT order_item
      return fn(
        makeMockClient({
          4: { rows: [{ id: 'item-1' }] }, // INSERT order_item
        })
      )
    })

    const res = await PATCH(patchReq(bodyNoProductId), { params: Promise.resolve({ id: ORDER_ID }) })
    expect(res.status).toBe(200)
  })

  // --- Insufficient stock on variant / sub-variant (lines 145, 156) ---

  it('reports insufficient variant stock (moveToDraft) with variant_name label', async () => {
    const bodyVariant = {
      ...VALID_BODY,
      items: [
        {
          ...VALID_BODY.items[0],
          product_id: '111e4567-e89b-12d3-a456-426614174001',
          variant_id: '222e4567-e89b-12d3-a456-426614174002',
          sub_variant_id: null,
          variant_name: 'Blue',
        },
      ],
    }

    vi.mocked(withTransaction).mockImplementation(async (fn: any) => {
      // 0=SELECT order_items (empty existing so previousQty=0, rawExtra=2>0)
      // 1=unitRow, 2=SELECT product_variants stock (insufficient: 1 < 2)
      return fn(
        makeMockClient({
          0: { rows: [] },
          1: { rows: [{ factor: null, dimension: null }] },
          2: { rows: [{ inventory_quantity: '1' }] },
          // after moveToDraft: 3=UPDATE orders, 4=DELETE invoices, 5=UPDATE addresses, 6=DELETE order_items, 7=INSERT
          7: { rows: [{ id: 'item-1' }] },
        })
      )
    })

    const res = await PATCH(patchReq(bodyVariant), { params: Promise.resolve({ id: ORDER_ID }) })
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.movedToDraft).toBe(true)
    expect(json.insufficientItems[0]).toMatch(/Blue/)
  })

  it('reports insufficient sub_variant stock (moveToDraft)', async () => {
    const bodySV = {
      ...VALID_BODY,
      items: [
        {
          ...VALID_BODY.items[0],
          product_id: '111e4567-e89b-12d3-a456-426614174001',
          variant_id: '222e4567-e89b-12d3-a456-426614174002',
          sub_variant_id: '333e4567-e89b-12d3-a456-426614174003',
          variant_name: 'Small',
        },
      ],
    }

    vi.mocked(withTransaction).mockImplementation(async (fn: any) => {
      return fn(
        makeMockClient({
          0: { rows: [] },
          1: { rows: [{ factor: null, dimension: null }] },
          2: { rows: [{ inventory_quantity: '0' }] }, // sub_variant stock insufficient
          7: { rows: [{ id: 'item-1' }] },
        })
      )
    })

    const res = await PATCH(patchReq(bodySV), { params: Promise.resolve({ id: ORDER_ID }) })
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.movedToDraft).toBe(true)
    expect(json.insufficientItems[0]).toMatch(/Small/)
  })

  // --- Deduction: plain product with count-dimension unit factor (extraQty scaling) ---

  it('scales extra qty by unit factor when dimension is count', async () => {
    vi.mocked(withTransaction).mockImplementation(async (fn: any) => {
      // 0=SELECT order_items(empty), 1=unitRow(count,factor 5), 2=SELECT products stock(sufficient 100)
      // 3=UPDATE orders, 4=UPDATE addresses, 5=DELETE order_items, 6=INSERT
      // deduction: 7=unitRow2(count,factor 5), 8=perishable check, 9=SELECT products FOR UPDATE, 10=UPDATE products
      return fn(
        makeMockClient({
          0: { rows: [] },
          1: { rows: [{ factor: '5', dimension: 'count' }] },
          6: { rows: [{ id: 'item-1' }] },
          7: { rows: [{ factor: '5', dimension: 'count', qty_step: '1' }] },
          8: { rows: [{ perishable: false, serialized: false }] },
        })
      )
    })

    const res = await PATCH(patchReq(VALID_BODY), { params: Promise.resolve({ id: ORDER_ID }) })
    expect(res.status).toBe(200)
    // extraQty = rawExtra(2) * factor(5) = 10 deducted
    expect(logStockMovement).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ quantityChange: -10 }))
  })

  // --- Deduction: perishable product (batch FIFO path, lines 268-308) ---

  it('deducts from batches FIFO for perishable product', async () => {
    vi.mocked(withTransaction).mockImplementation(async (fn: any) => {
      // 0=SELECT order_items(empty), 1=unitRow, 2=SELECT products stock(sufficient)
      // 3=UPDATE orders, 4=UPDATE addresses, 5=DELETE order_items, 6=INSERT
      // deduction: 7=unitRow2, 8=perishable check(true), 9=SELECT product_batches
      // per batch: 10=UPDATE product_batches
      return fn(
        makeMockClient({
          0: { rows: [] },
          6: { rows: [{ id: 'item-1' }] },
          8: { rows: [{ perishable: true, serialized: false }] },
          9: {
            rows: [
              { id: 'batch-1', quantity_remaining: '1', lot_number: 'L1', expiry_date: '2025-01-01' },
              { id: 'batch-2', quantity_remaining: '10', lot_number: 'L2', expiry_date: '2025-06-01' },
            ],
          },
        })
      )
    })

    const res = await PATCH(patchReq(VALID_BODY), { params: Promise.resolve({ id: ORDER_ID }) })
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    // Two batches consumed to satisfy qty 2 (1 from batch-1, 1 from batch-2)
    expect(logStockMovement).toHaveBeenCalledTimes(2)
    expect(deleteBatchIfEmpty).toHaveBeenCalled()
    expect(syncPerishableStock).toHaveBeenCalled()
  })

  // --- Deduction: serialized product (serial FEFO path, lines 309-367) ---

  it('marks serials sold for serialized product with batch-carrying serials', async () => {
    vi.mocked(withTransaction).mockImplementation(async (fn: any) => {
      // 0=SELECT order_items(empty), 1=unitRow, 2=stock check(sufficient)
      // 3=UPDATE orders, 4=UPDATE addresses, 5=DELETE order_items, 6=INSERT
      // deduction: 7=unitRow2(qty_step '1'), 8=perishable check(serialized true)
      // 9=SELECT product_serials, 10=SELECT inventory FOR UPDATE
      // per serial(2): update serial + update batch (has batch_id)
      let queryCall = 0
      const client: any = {
        query: vi.fn().mockImplementation(async () => {
          const idx = queryCall++
          switch (idx) {
            case 0:
              return { rows: [] }
            case 6:
              return { rows: [{ id: 'item-1' }] }
            case 7:
              return { rows: [{ factor: null, dimension: null, qty_step: '1' }] }
            case 8:
              return { rows: [{ perishable: false, serialized: true }] }
            case 9:
              return {
                rows: [
                  { id: 's1', serial_number: 'SN1', batch_id: 'b1' },
                  { id: 's2', serial_number: 'SN2', batch_id: null },
                ],
              }
            case 10:
              return { rows: [{ inventory_quantity: '50' }] }
            // UPDATE product_batches RETURNING for serial s1
            default:
              return { rows: [{ lot_number: 'L1', expiry_date: '2025-01-01', inventory_quantity: '50' }] }
          }
        }),
        release: vi.fn(),
      }
      return fn(client)
    })

    const res = await PATCH(patchReq(VALID_BODY), { params: Promise.resolve({ id: ORDER_ID }) })
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    // Two serials marked sold => two stock movements of -1 each
    expect(logStockMovement).toHaveBeenCalledTimes(2)
    expect(logStockMovement).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ quantityChange: -1, serialNumber: 'SN1' })
    )
    // batch cleanup called for the touched batch
    expect(deleteBatchIfEmpty).toHaveBeenCalledWith(expect.anything(), 'b1')
    expect(syncPerishableStock).toHaveBeenCalled()
  })

  // --- Deduction: plain variant + sub_variant branches (lines 370-400) ---

  it('deducts plain stock from variant when item has variant_id (no sub_variant)', async () => {
    const bodyVariant = {
      ...VALID_BODY,
      items: [
        {
          ...VALID_BODY.items[0],
          variant_id: '222e4567-e89b-12d3-a456-426614174002',
          sub_variant_id: null,
        },
      ],
    }

    vi.mocked(withTransaction).mockImplementation(async (fn: any) => {
      // 0=SELECT order_items(empty), 1=unitRow, 2=SELECT product_variants stock(sufficient 100)
      // 3=UPDATE orders, 4=UPDATE addresses, 5=DELETE order_items, 6=INSERT
      // deduction: 7=unitRow2, 8=perishable check(both false), 9=SELECT product_variants FOR UPDATE, 10=UPDATE product_variants
      return fn(
        makeMockClient({
          0: { rows: [] },
          6: { rows: [{ id: 'item-1' }] },
          8: { rows: [{ perishable: false, serialized: false }] },
        })
      )
    })

    const res = await PATCH(patchReq(bodyVariant), { params: Promise.resolve({ id: ORDER_ID }) })
    expect(res.status).toBe(200)
    expect(decrementNonPerishableShelfStock).toHaveBeenCalled()
  })

  it('deducts plain stock from sub_variant when item has sub_variant_id', async () => {
    const bodySV = {
      ...VALID_BODY,
      items: [
        {
          ...VALID_BODY.items[0],
          variant_id: '222e4567-e89b-12d3-a456-426614174002',
          sub_variant_id: '333e4567-e89b-12d3-a456-426614174003',
        },
      ],
    }

    vi.mocked(withTransaction).mockImplementation(async (fn: any) => {
      return fn(
        makeMockClient({
          0: { rows: [] },
          6: { rows: [{ id: 'item-1' }] },
          8: { rows: [{ perishable: false, serialized: false }] },
        })
      )
    })

    const res = await PATCH(patchReq(bodySV), { params: Promise.resolve({ id: ORDER_ID }) })
    expect(res.status).toBe(200)
    expect(decrementNonPerishableShelfStock).toHaveBeenCalled()
  })

  // --- rawExtra <= 0 skip: quantity not increased vs existing order_items ---

  it('skips deduction when quantity is not increased (rawExtra <= 0)', async () => {
    vi.mocked(withTransaction).mockImplementation(async (fn: any) => {
      // existing order_items already has qty 5 for same key; new qty 2 => rawExtra negative => skip stock check AND deduction
      // 0=SELECT order_items(existing qty 5), 1=UPDATE orders, 2=UPDATE addresses, 3=DELETE order_items, 4=INSERT
      return fn(
        makeMockClient({
          0: {
            rows: [
              {
                product_id: '111e4567-e89b-12d3-a456-426614174001',
                variant_id: null,
                sub_variant_id: null,
                quantity: '5',
              },
            ],
          },
          4: { rows: [{ id: 'item-1' }] },
        })
      )
    })

    const res = await PATCH(patchReq(VALID_BODY), { params: Promise.resolve({ id: ORDER_ID }) })
    expect(res.status).toBe(200)
    // No stock movement because nothing extra was deducted
    expect(logStockMovement).not.toHaveBeenCalled()
  })

  // --- no addressLine1 => skip address update; no email when order lacks invoice_number ---

  it('skips address update and email when addressLine1 and invoice_number absent', async () => {
    vi.mocked(queryOne).mockResolvedValue({ ...OFFLINE_ORDER, invoice_number: null } as any)
    vi.mocked(withTransaction).mockImplementation(async (fn: any) => {
      // no addressLine1 => 0=SELECT order_items, 1=unitRow, 2=stock check
      // 3=UPDATE orders, 4=DELETE order_items, 5=INSERT
      // deduction: 6=unitRow2, 7=perishable check, 8=SELECT products FOR UPDATE, 9=UPDATE products
      return fn(
        makeMockClient({
          0: { rows: [] },
          5: { rows: [{ id: 'item-1' }] },
          7: { rows: [{ perishable: false, serialized: false }] },
        })
      )
    })

    const res = await PATCH(patchReq({ ...VALID_BODY, addressLine1: null }), {
      params: Promise.resolve({ id: ORDER_ID }),
    })
    expect(res.status).toBe(200)
    expect(sendInvoiceFinalizedEmail).not.toHaveBeenCalled()
  })

  // --- credit payment mode => payment_status unpaid; invoiceDate default ---

  it('handles credit payment mode and defaults invoiceDate when absent', async () => {
    vi.mocked(withTransaction).mockImplementation(async (fn: any) => {
      return fn(
        makeMockClient({
          0: { rows: [] },
          6: { rows: [{ id: 'item-1' }] },
          8: { rows: [{ perishable: false, serialized: false }] },
        })
      )
    })

    const res = await PATCH(patchReq({ ...VALID_BODY, paymentMode: 'credit', invoiceDate: null }), {
      params: Promise.resolve({ id: ORDER_ID }),
    })
    expect(res.status).toBe(200)
  })

  // --- discount + sold_unit_factor path (line-item branches) ---

  it('applies discount and sell_unit_factor when computing line items', async () => {
    const bodyDisc = {
      ...VALID_BODY,
      items: [
        {
          ...VALID_BODY.items[0],
          discount_pct: '10',
          sell_unit_factor: 3,
        },
      ],
    }

    vi.mocked(withTransaction).mockImplementation(async (fn: any) => {
      return fn(
        makeMockClient({
          0: { rows: [] },
          6: { rows: [{ id: 'item-1' }] },
          8: { rows: [{ perishable: false, serialized: false }] },
        })
      )
    })

    const res = await PATCH(patchReq(bodyDisc), { params: Promise.resolve({ id: ORDER_ID }) })
    expect(res.status).toBe(200)
    // discount_amount should be non-zero, base qty multiplied by factor
    expect(lineItemFromMrpIncl).toHaveBeenCalledWith(6, 100, 10, 18)
  })
})
