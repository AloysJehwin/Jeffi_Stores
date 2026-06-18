import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ---------------------------------------------------------------------------
// Mocks — declared before any import of the module under test
// ---------------------------------------------------------------------------

vi.mock('@/lib/jwt', () => ({
  authenticateAdmin: vi.fn(),
}))

vi.mock('@/lib/scopes', () => ({
  hasScope: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  queryOne: vi.fn(),
  withTransaction: vi.fn(),
}))

vi.mock('@/lib/gst', () => ({
  isInterState: vi.fn(),
  calculateGST: vi.fn(),
  generateInvoiceNumber: vi.fn(),
  getNextInvoiceSequence: vi.fn(),
  getFinancialYear: vi.fn(),
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

// ---------------------------------------------------------------------------
// Import handlers AFTER mocks
// ---------------------------------------------------------------------------

import { PATCH } from '@/app/api/admin/invoices/[id]/route'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryOne, withTransaction } from '@/lib/db'
import { sendInvoiceFinalizedEmail } from '@/lib/email'
import { isInterState, calculateGST, generateInvoiceNumber, getNextInvoiceSequence, getFinancialYear } from '@/lib/gst'
import { lineItemFromMrpIncl } from '@/lib/pricing'
import { logStockMovement } from '@/lib/inventory'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ADMIN = { adminId: 'admin-1', id: 'admin-1', role: 'super_admin', scopes: ['invoices'] }
const ORDER_ID = '550e8400-e29b-41d4-a716-446655440000'

function patchReq(body: unknown) {
  return new NextRequest(new Request(`http://localhost/api/admin/invoices/${ORDER_ID}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }))
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
    vi.mocked(logStockMovement).mockResolvedValue(undefined)
    vi.mocked(sendInvoiceFinalizedEmail).mockResolvedValue(undefined as any)
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
      const client = {
        query: vi.fn()
          // existing order_items
          .mockResolvedValueOnce({ rows: [] })
          // stock check for product
          .mockResolvedValueOnce({ rows: [{ inventory_quantity: '100' }] })
          // UPDATE orders
          .mockResolvedValueOnce({ rows: [] })
          // UPDATE addresses
          .mockResolvedValueOnce({ rows: [] })
          // DELETE order_items
          .mockResolvedValueOnce({ rows: [] })
          // INSERT order_item
          .mockResolvedValueOnce({ rows: [] })
          // stock deduction SELECT
          .mockResolvedValueOnce({ rows: [{ inventory_quantity: '100' }] })
          // stock deduction UPDATE
          .mockResolvedValueOnce({ rows: [] }),
      }
      return fn(client)
    })

    const res = await PATCH(patchReq(VALID_BODY), { params: Promise.resolve({ id: ORDER_ID }) })
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
  })

  // --- Draft fallback when stock insufficient ---

  it('returns movedToDraft=true when stock is insufficient', async () => {
    vi.mocked(withTransaction).mockImplementation(async (fn: any) => {
      const client = {
        query: vi.fn()
          // existing order_items (none)
          .mockResolvedValueOnce({ rows: [] })
          // stock check — only 1 available, 2 needed
          .mockResolvedValueOnce({ rows: [{ inventory_quantity: '1' }] })
          // UPDATE orders (draft)
          .mockResolvedValueOnce({ rows: [] })
          // DELETE FROM invoices (had invoice_number)
          .mockResolvedValueOnce({ rows: [] })
          // UPDATE addresses
          .mockResolvedValueOnce({ rows: [] })
          // DELETE order_items
          .mockResolvedValueOnce({ rows: [] })
          // INSERT order_item
          .mockResolvedValueOnce({ rows: [] }),
      }
      return fn(client)
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
      const client = {
        query: vi.fn()
          .mockResolvedValueOnce({ rows: [] })
          .mockResolvedValueOnce({ rows: [{ inventory_quantity: '100' }] })
          .mockResolvedValueOnce({ rows: [] })
          .mockResolvedValueOnce({ rows: [] })
          .mockResolvedValueOnce({ rows: [] })
          .mockResolvedValueOnce({ rows: [] })
          .mockResolvedValueOnce({ rows: [{ inventory_quantity: '100' }] })
          .mockResolvedValueOnce({ rows: [] }),
      }
      return fn(client)
    })

    await PATCH(patchReq(VALID_BODY), { params: Promise.resolve({ id: ORDER_ID }) })
    expect(sendInvoiceFinalizedEmail).toHaveBeenCalledWith(
      'test@example.com',
      'Test Customer',
      'JS/24-25/APR/1',
      expect.any(Number),
    )
  })

  it('does not send email when customerEmail is absent', async () => {
    vi.mocked(withTransaction).mockImplementation(async (fn: any) => {
      const client = {
        query: vi.fn()
          .mockResolvedValueOnce({ rows: [] })
          .mockResolvedValueOnce({ rows: [{ inventory_quantity: '100' }] })
          .mockResolvedValueOnce({ rows: [] })
          .mockResolvedValueOnce({ rows: [] })
          .mockResolvedValueOnce({ rows: [] })
          .mockResolvedValueOnce({ rows: [] })
          .mockResolvedValueOnce({ rows: [{ inventory_quantity: '100' }] })
          .mockResolvedValueOnce({ rows: [] }),
      }
      return fn(client)
    })

    await PATCH(
      patchReq({ ...VALID_BODY, customerEmail: null }),
      { params: Promise.resolve({ id: ORDER_ID }) },
    )
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
      const client = {
        query: vi.fn()
          .mockResolvedValueOnce({ rows: [] })
          .mockResolvedValueOnce({ rows: [{ inventory_quantity: '50' }] })
          .mockResolvedValueOnce({ rows: [] })
          .mockResolvedValueOnce({ rows: [] })
          .mockResolvedValueOnce({ rows: [] })
          .mockResolvedValueOnce({ rows: [] })
          .mockResolvedValueOnce({ rows: [{ inventory_quantity: '50' }] })
          .mockResolvedValueOnce({ rows: [] }),
      }
      return fn(client)
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
      const client = {
        query: vi.fn()
          .mockResolvedValueOnce({ rows: [] })
          .mockResolvedValueOnce({ rows: [{ inventory_quantity: '50' }] })
          .mockResolvedValueOnce({ rows: [] })
          .mockResolvedValueOnce({ rows: [] })
          .mockResolvedValueOnce({ rows: [] })
          .mockResolvedValueOnce({ rows: [] })
          .mockResolvedValueOnce({ rows: [{ inventory_quantity: '50' }] })
          .mockResolvedValueOnce({ rows: [] }),
      }
      return fn(client)
    })

    const res = await PATCH(patchReq(bodyWithSV), { params: Promise.resolve({ id: ORDER_ID }) })
    expect(res.status).toBe(200)
  })

  // --- IGST path ---

  it('uses IGST when buyer has GSTIN and is inter-state', async () => {
    const { isInterState } = await import('@/lib/gst')
    vi.mocked(isInterState).mockReturnValue(true)

    const bodyIgst = { ...VALID_BODY, buyerGstin: '27AABCU9603R1ZM', state: 'Maharashtra' }

    vi.mocked(withTransaction).mockImplementation(async (fn: any) => {
      const client = {
        query: vi.fn()
          .mockResolvedValueOnce({ rows: [] })
          .mockResolvedValueOnce({ rows: [{ inventory_quantity: '100' }] })
          .mockResolvedValueOnce({ rows: [] })
          .mockResolvedValueOnce({ rows: [] })
          .mockResolvedValueOnce({ rows: [] })
          .mockResolvedValueOnce({ rows: [] })
          .mockResolvedValueOnce({ rows: [{ inventory_quantity: '100' }] })
          .mockResolvedValueOnce({ rows: [] }),
      }
      return fn(client)
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
      const client = {
        query: vi.fn()
          .mockResolvedValueOnce({ rows: [] })
          // No stock check call needed
          .mockResolvedValueOnce({ rows: [] })
          .mockResolvedValueOnce({ rows: [] })
          .mockResolvedValueOnce({ rows: [] })
          .mockResolvedValueOnce({ rows: [] }),
      }
      return fn(client)
    })

    const res = await PATCH(patchReq(bodyNoProductId), { params: Promise.resolve({ id: ORDER_ID }) })
    expect(res.status).toBe(200)
  })
})
