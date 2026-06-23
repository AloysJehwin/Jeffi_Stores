import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

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
  withTransaction: vi.fn(),
}))

vi.mock('@/lib/gst', () => ({
  calculateGST: vi.fn(),
  getFinancialYear: vi.fn(),
  generateInvoiceNumber: vi.fn(),
  getNextInvoiceSequence: vi.fn(),
}))

vi.mock('@/lib/pricing', () => ({
  lineItemFromMrpIncl: vi.fn(),
}))

vi.mock('@/lib/inventory', () => ({
  logStockMovement: vi.fn(),
}))

vi.mock('@/lib/validate', () => {
  return {
    parseBody: vi.fn((schema: any, data: any) => {
      const result = schema.safeParse(data)
      if (result.success) return { ok: true, data: result.data }
      return {
        ok: false,
        response: NextResponse.json(
          { error: result.error.issues[0]?.message ?? 'Validation error' },
          { status: 400 },
        ),
      }
    }),
  }
})

// ---------------------------------------------------------------------------
// Import handler AFTER mocks
// ---------------------------------------------------------------------------

import { POST } from '@/app/api/admin/invoices/cash-sale/route'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { withTransaction } from '@/lib/db'
import { calculateGST, getFinancialYear, generateInvoiceNumber, getNextInvoiceSequence } from '@/lib/gst'
import { lineItemFromMrpIncl } from '@/lib/pricing'
import { logStockMovement } from '@/lib/inventory'
import { parseBody } from '@/lib/validate'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ADMIN = { adminId: 'admin-1', username: 'testadmin', id: 'admin-1', role: 'super_admin', scopes: ['invoices'] }

function postReq(body: unknown) {
  return new NextRequest(new Request('http://localhost/api/admin/invoices/cash-sale', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }))
}

const VALID_BODY = {
  paymentMode: 'cash',
  notes: 'Walk-in',
  items: [
    {
      product_name: 'Widget',
      product_sku: 'WGT',
      unit_price: 100,
      quantity: 2,
      gst_rate: 18,
    },
  ],
}

function makeDefaultClient() {
  return {
    query: vi.fn()
      // site_settings for invoice_prefix
      .mockResolvedValueOnce({ rows: [{ value: 'JS' }] })
      // INSERT cash_sales RETURNING id, sale_number
      // (getNextInvoiceSequence is mocked at lib level — no client.query call)
      .mockResolvedValueOnce({ rows: [{ id: 'sale-uuid-1', sale_number: 'CS-123-ABC' }] })
      // INSERT invoices
      .mockResolvedValueOnce({ rows: [] })
      // INSERT cash_sale_items (one item)
      .mockResolvedValueOnce({ rows: [] }),
    release: vi.fn(),
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/admin/invoices/cash-sale', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    process.env.ENABLE_GST = 'true'
    // Re-setup lib mocks cleared by resetAllMocks
    vi.mocked(calculateGST).mockReturnValue({ taxableAmount: 84.75, cgst: 7.63, sgst: 7.63, igst: 0 } as any)
    vi.mocked(getFinancialYear).mockReturnValue('24-25')
    vi.mocked(generateInvoiceNumber).mockReturnValue('JS/24-25/APR/1')
    vi.mocked(getNextInvoiceSequence).mockResolvedValue(1 as any)
    vi.mocked(lineItemFromMrpIncl).mockReturnValue(100)
    vi.mocked(logStockMovement).mockResolvedValue(undefined)
    // Re-setup parseBody — resetAllMocks wipes the factory implementation
    vi.mocked(parseBody).mockImplementation((schema: any, data: any) => {
      const result = schema.safeParse(data)
      if (result.success) return { ok: true, data: result.data }
      return {
        ok: false,
        response: NextResponse.json(
          { error: result.error.issues[0]?.message ?? 'Validation error' },
          { status: 400 },
        ),
      }
    })
  })

  // --- Auth ---

  it('returns 401 when not authenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    const res = await POST(postReq(VALID_BODY))
    expect(res.status).toBe(401)
  })

  it('returns 403 when invoices scope is missing', async () => {
    vi.mocked(hasScope).mockReturnValue(false)
    const res = await POST(postReq(VALID_BODY))
    expect(res.status).toBe(403)
  })

  // --- Validation ---

  it('returns 400 when items array is missing', async () => {
    const res = await POST(postReq({ paymentMode: 'cash' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 when items array is empty', async () => {
    const res = await POST(postReq({ ...VALID_BODY, items: [] }))
    expect(res.status).toBe(400)
  })

  it('returns 400 when item unit_price is negative', async () => {
    const res = await POST(postReq({
      ...VALID_BODY,
      items: [{ ...VALID_BODY.items[0], unit_price: -1 }],
    }))
    expect(res.status).toBe(400)
  })

  it('returns 400 when item quantity is zero', async () => {
    const res = await POST(postReq({
      ...VALID_BODY,
      items: [{ ...VALID_BODY.items[0], quantity: 0 }],
    }))
    expect(res.status).toBe(400)
  })

  it('returns 400 for invalid payment mode', async () => {
    vi.mocked(withTransaction).mockImplementation(async (fn: any) => fn(makeDefaultClient()))
    const res = await POST(postReq({ ...VALID_BODY, paymentMode: 'credit' }))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/payment mode/i)
  })

  // --- Happy path with GST enabled ---

  it('creates cash sale and returns saleId and invoiceNumber', async () => {
    vi.mocked(withTransaction).mockImplementation(async (fn: any) => {
      const client = makeDefaultClient()
      return fn(client)
    })

    const res = await POST(postReq(VALID_BODY))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(json.saleId).toBeDefined()
    expect(json.invoiceUrl).toContain('/api/admin/cash-sale/')
  })

  // --- GST disabled ---

  it('skips invoice number generation when GST is disabled', async () => {
    process.env.ENABLE_GST = 'false'

    vi.mocked(withTransaction).mockImplementation(async (fn: any) => {
      const client = {
        query: vi.fn()
          // INSERT cash_sales RETURNING
          .mockResolvedValueOnce({ rows: [{ id: 'sale-uuid-2', sale_number: 'CS-456-XYZ' }] })
          // INSERT cash_sale_items
          .mockResolvedValueOnce({ rows: [] }),
        release: vi.fn(),
      }
      return fn(client)
    })

    const res = await POST(postReq(VALID_BODY))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.invoiceNumber).toBeNull()
  })

  // --- Stock deduction paths ---

  it('deducts stock at product level when no variant', async () => {
    const bodyWithProduct = {
      ...VALID_BODY,
      items: [{ ...VALID_BODY.items[0], product_id: '111e4567-e89b-12d3-a456-426614174001' }],
    }

    vi.mocked(withTransaction).mockImplementation(async (fn: any) => {
      const client = {
        query: vi.fn()
          .mockResolvedValueOnce({ rows: [{ value: 'JS' }] })   // site_settings (GST enabled)
          .mockResolvedValueOnce({ rows: [{ id: 'sale-1', sale_number: 'CS-1' }] }) // INSERT cash_sales
          .mockResolvedValueOnce({ rows: [] })                   // INSERT invoices
          .mockResolvedValueOnce({ rows: [] })                   // INSERT cash_sale_items
          // unit factor lookup (buy_unit is null → returns empty)
          .mockResolvedValueOnce({ rows: [] })
          // stock path
          .mockResolvedValueOnce({ rows: [{ inventory_quantity: 50 }] }) // SELECT FOR UPDATE
          .mockResolvedValueOnce({ rows: [] }),                  // UPDATE products
        release: vi.fn(),
      }
      return fn(client)
    })

    const res = await POST(postReq(bodyWithProduct))
    expect(res.status).toBe(200)
  })

  it('deducts stock at variant level when variant_id provided', async () => {
    const bodyWithVariant = {
      ...VALID_BODY,
      items: [{
        ...VALID_BODY.items[0],
        product_id: '111e4567-e89b-12d3-a456-426614174001',
        variant_id: '222e4567-e89b-12d3-a456-426614174002',
      }],
    }

    vi.mocked(withTransaction).mockImplementation(async (fn: any) => {
      const client = {
        query: vi.fn()
          .mockResolvedValueOnce({ rows: [{ value: 'JS' }] })   // site_settings (GST enabled)
          .mockResolvedValueOnce({ rows: [{ id: 'sale-1', sale_number: 'CS-1' }] }) // INSERT cash_sales
          .mockResolvedValueOnce({ rows: [] })                   // INSERT invoices
          .mockResolvedValueOnce({ rows: [] })                   // INSERT cash_sale_items
          // unit factor lookup
          .mockResolvedValueOnce({ rows: [] })
          // stock path
          .mockResolvedValueOnce({ rows: [{ inventory_quantity: 50 }] }) // SELECT FOR UPDATE
          .mockResolvedValueOnce({ rows: [] }),                  // UPDATE product_variants
        release: vi.fn(),
      }
      return fn(client)
    })

    const res = await POST(postReq(bodyWithVariant))
    expect(res.status).toBe(200)
  })

  it('deducts stock at sub_variant level when sub_variant_id provided', async () => {
    const bodyWithSV = {
      ...VALID_BODY,
      items: [{
        ...VALID_BODY.items[0],
        product_id: '111e4567-e89b-12d3-a456-426614174001',
        variant_id: '222e4567-e89b-12d3-a456-426614174002',
        sub_variant_id: '333e4567-e89b-12d3-a456-426614174003',
      }],
    }

    vi.mocked(withTransaction).mockImplementation(async (fn: any) => {
      const client = {
        query: vi.fn()
          .mockResolvedValueOnce({ rows: [{ value: 'JS' }] })   // site_settings (GST enabled)
          .mockResolvedValueOnce({ rows: [{ id: 'sale-1', sale_number: 'CS-1' }] }) // INSERT cash_sales
          .mockResolvedValueOnce({ rows: [] })                   // INSERT invoices
          .mockResolvedValueOnce({ rows: [] })                   // INSERT cash_sale_items
          // unit factor lookup
          .mockResolvedValueOnce({ rows: [] })
          // stock path
          .mockResolvedValueOnce({ rows: [{ inventory_quantity: 50 }] }) // SELECT FOR UPDATE
          .mockResolvedValueOnce({ rows: [] }),                  // UPDATE product_sub_variants
        release: vi.fn(),
      }
      return fn(client)
    })

    const res = await POST(postReq(bodyWithSV))
    expect(res.status).toBe(200)
  })

  it('throws 500 when stock is insufficient', async () => {
    const bodyWithProduct = {
      ...VALID_BODY,
      items: [{ ...VALID_BODY.items[0], product_id: '111e4567-e89b-12d3-a456-426614174001', quantity: 99 }],
    }

    vi.mocked(withTransaction).mockImplementation(async (fn: any) => {
      const client = {
        query: vi.fn()
          .mockResolvedValueOnce({ rows: [{ value: 'JS' }] })   // site_settings (GST enabled)
          .mockResolvedValueOnce({ rows: [{ id: 'sale-1', sale_number: 'CS-1' }] }) // INSERT cash_sales
          .mockResolvedValueOnce({ rows: [] })                   // INSERT invoices
          .mockResolvedValueOnce({ rows: [] })                   // INSERT cash_sale_items
          // unit factor lookup
          .mockResolvedValueOnce({ rows: [] })
          // stock check returns only 1
          .mockResolvedValueOnce({ rows: [{ inventory_quantity: 1 }] }),
        release: vi.fn(),
      }
      return fn(client)
    })

    const res = await POST(postReq(bodyWithProduct))
    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json.error).toMatch(/Insufficient stock/)
  })

  // --- UPI payment mode ---

  it('accepts upi payment mode', async () => {
    vi.mocked(withTransaction).mockImplementation(async (fn: any) => fn(makeDefaultClient()))

    const res = await POST(postReq({ ...VALID_BODY, paymentMode: 'upi' }))
    expect(res.status).toBe(200)
  })

  it('accepts upi_qr payment mode', async () => {
    vi.mocked(withTransaction).mockImplementation(async (fn: any) => fn(makeDefaultClient()))

    const res = await POST(postReq({ ...VALID_BODY, paymentMode: 'upi_qr' }))
    expect(res.status).toBe(200)
  })

  // --- null paymentMode defaults to cash ---

  it('defaults paymentMode to cash when null', async () => {
    vi.mocked(withTransaction).mockImplementation(async (fn: any) => fn(makeDefaultClient()))

    const res = await POST(postReq({ ...VALID_BODY, paymentMode: null }))
    expect(res.status).toBe(200)
  })

  // --- DB error ---

  it('returns 500 on transaction error', async () => {
    vi.mocked(withTransaction).mockRejectedValue(new Error('Connection refused'))
    const res = await POST(postReq(VALID_BODY))
    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json.error).toBe('Connection refused')
  })
})
