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
  getClient: vi.fn(),
  queryOne: vi.fn(),
}))

vi.mock('@/lib/shelf', () => ({
  syncPerishableStock: vi.fn().mockResolvedValue(undefined),
  upsertShelfStock: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/inventory', () => ({
  logStockMovement: vi.fn().mockResolvedValue(undefined),
}))

// ---------------------------------------------------------------------------
// Import handler AFTER mocks
// ---------------------------------------------------------------------------

import { POST } from '@/app/api/admin/products/[id]/bootstrap-stock/route'
import { getClient, queryOne } from '@/lib/db'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { syncPerishableStock, upsertShelfStock } from '@/lib/shelf'
import { logStockMovement } from '@/lib/inventory'

const PRODUCT_ID = '111e4567-e89b-12d3-a456-426614174001'
const VARIANT_ID = '222e4567-e89b-12d3-a456-426614174002'
const LOCATION_ID = '333e4567-e89b-12d3-a456-426614174003'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function postReq(body: unknown, id: string = PRODUCT_ID) {
  return new NextRequest(new Request(`http://localhost/api/admin/products/${id}/bootstrap-stock`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }))
}

function paramsFor(id: string = PRODUCT_ID) {
  return { params: Promise.resolve({ id }) }
}

function makeClient(rows: any[] = []) {
  const query = vi.fn().mockImplementation((sql: string) => {
    if (typeof sql === 'string') {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
        return Promise.resolve({ rows: [] })
      }
      if (sql.includes('INSERT INTO product_batches')) {
        return Promise.resolve({ rows: [{ id: 'batch-1' }] })
      }
    }
    return Promise.resolve({ rows: [] })
  })
  const release = vi.fn()
  return { query, release }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/admin/products/[id]/bootstrap-stock', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateAdmin).mockResolvedValue({ adminId: 'admin-1', role: 'super_admin', scopes: [] } as any)
    vi.mocked(hasScope).mockReturnValue(true)
  })

  // --- Validation ---

  it('returns 400 when body has invalid variant_id (non-uuid)', async () => {
    const res = await POST(postReq({ variant_id: 'not-a-uuid' }), paramsFor())
    expect(res.status).toBe(400)
  })

  it('returns 400 when serial_numbers is not an array of strings', async () => {
    const res = await POST(postReq({ serial_numbers: [123 as any] }), paramsFor())
    expect(res.status).toBe(400)
  })

  // --- 404 product not found ---

  it('returns 404 when product not found', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce(null)
    const res = await POST(postReq({}), paramsFor())
    expect(res.status).toBe(404)
    const json = await res.json()
    expect(json.error).toBe('Product not found')
  })

  // --- 400 neither perishable nor serialized ---

  it('returns 400 when product is neither perishable nor serialized', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce({
      id: PRODUCT_ID,
      perishable: false,
      serialized: false,
      inventory_quantity: '10',
    })
    const res = await POST(postReq({}), paramsFor())
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/perishable nor serialized/)
  })

  // --- 404 variant not found ---

  it('returns 404 when variant_id provided but variant not found', async () => {
    vi.mocked(queryOne)
      .mockResolvedValueOnce({ id: PRODUCT_ID, perishable: true, serialized: false, inventory_quantity: '10' })
      .mockResolvedValueOnce(null) // variant lookup
    const res = await POST(postReq({ variant_id: VARIANT_ID }), paramsFor())
    expect(res.status).toBe(404)
    const json = await res.json()
    expect(json.error).toBe('Variant not found')
  })

  // --- 400 no existing stock ---

  it('returns 400 when inventory qty is zero', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce({
      id: PRODUCT_ID,
      perishable: true,
      serialized: false,
      inventory_quantity: '0',
    })
    const res = await POST(postReq({}), paramsFor())
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe('No existing stock to bootstrap')
  })

  it('returns 400 when variant inventory qty is zero', async () => {
    vi.mocked(queryOne)
      .mockResolvedValueOnce({ id: PRODUCT_ID, perishable: true, serialized: false, inventory_quantity: '10' })
      .mockResolvedValueOnce({ inventory_quantity: '0', sub_variant_id: null })
    const res = await POST(postReq({ variant_id: VARIANT_ID }), paramsFor())
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe('No existing stock to bootstrap')
  })

  // --- 400 perishable requires expiry_date ---

  it('returns 400 when perishable but no expiry_date supplied', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce({
      id: PRODUCT_ID,
      perishable: true,
      serialized: false,
      inventory_quantity: '5',
    })
    const res = await POST(postReq({}), paramsFor())
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/Expiry date is required/)
  })

  // --- 400 serialized: wrong number of serials ---

  it('returns 400 when serial numbers count mismatch (serialized product)', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce({
      id: PRODUCT_ID,
      perishable: false,
      serialized: true,
      inventory_quantity: '3',
    })
    const res = await POST(postReq({ serial_numbers: ['A', 'B'] }), paramsFor())
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/serial number\(s\) required/)
  })

  // --- 409 already bootstrapped ---

  it('returns 409 when already bootstrapped (existing batch)', async () => {
    vi.mocked(queryOne)
      .mockResolvedValueOnce({ id: PRODUCT_ID, perishable: true, serialized: false, inventory_quantity: '5' })
      .mockResolvedValueOnce({ total: 1 }) // existing batch count
      .mockResolvedValueOnce({ total: 0 }) // existing serial count
    const res = await POST(postReq({ expiry_date: '2027-01-01' }), paramsFor())
    expect(res.status).toBe(409)
    const json = await res.json()
    expect(json.error).toBe('Stock already bootstrapped')
  })

  it('returns 409 when already bootstrapped (existing serial)', async () => {
    vi.mocked(queryOne)
      .mockResolvedValueOnce({ id: PRODUCT_ID, perishable: false, serialized: true, inventory_quantity: '3' })
      .mockResolvedValueOnce({ total: 0 })
      .mockResolvedValueOnce({ total: 3 })
    const res = await POST(postReq({ serial_numbers: ['A', 'B', 'C'] }), paramsFor())
    expect(res.status).toBe(409)
    const json = await res.json()
    expect(json.error).toBe('Stock already bootstrapped')
  })

  // --- Success: perishable product ---

  it('bootstraps a perishable product successfully', async () => {
    vi.mocked(queryOne)
      .mockResolvedValueOnce({ id: PRODUCT_ID, perishable: true, serialized: false, inventory_quantity: '10' })
      .mockResolvedValueOnce({ total: 0 })
      .mockResolvedValueOnce({ total: 0 })

    const client = makeClient()
    vi.mocked(getClient).mockResolvedValueOnce(client as any)

    const res = await POST(postReq({
      expiry_date: '2027-01-01',
      lot_number: 'LOT-1',
      manufacture_date: '2026-01-01',
      location_id: LOCATION_ID,
    }), paramsFor())
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(client.query).toHaveBeenCalledWith('BEGIN')
    expect(client.query).toHaveBeenCalledWith('COMMIT')
    expect(client.release).toHaveBeenCalled()
    expect(syncPerishableStock).toHaveBeenCalled()
    expect(logStockMovement).toHaveBeenCalled()
  })

  // --- Success: variant-scoped perishable ---

  it('bootstraps a variant-scoped perishable product', async () => {
    vi.mocked(queryOne)
      .mockResolvedValueOnce({ id: PRODUCT_ID, perishable: true, serialized: false, inventory_quantity: '10' })
      .mockResolvedValueOnce({ inventory_quantity: '5', sub_variant_id: null })
      .mockResolvedValueOnce({ total: 0 })
      .mockResolvedValueOnce({ total: 0 })

    const client = makeClient()
    vi.mocked(getClient).mockResolvedValueOnce(client as any)

    const res = await POST(postReq({
      variant_id: VARIANT_ID,
      expiry_date: '2027-01-01',
    }), paramsFor())
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
  })

  // --- Success: serialized product ---

  it('bootstraps a serialized product successfully', async () => {
    vi.mocked(queryOne)
      .mockResolvedValueOnce({ id: PRODUCT_ID, perishable: false, serialized: true, inventory_quantity: '3' })
      .mockResolvedValueOnce({ total: 0 })
      .mockResolvedValueOnce({ total: 0 })

    const client = makeClient()
    vi.mocked(getClient).mockResolvedValueOnce(client as any)

    const res = await POST(postReq({
      serial_numbers: ['SN-1', 'SN-2', 'SN-3'],
      location_id: LOCATION_ID,
    }), paramsFor())
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(syncPerishableStock).not.toHaveBeenCalled()
    // Serialized product stock is added to the bin (increment, not overwrite),
    // via the NULL-safe helper — never a raw ON CONFLICT that duplicates.
    expect(upsertShelfStock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ locationId: LOCATION_ID, quantity: 3, mode: 'add' })
    )
  })

  it('bootstraps a serialized product without location_id (no shelf_stock insert)', async () => {
    vi.mocked(queryOne)
      .mockResolvedValueOnce({ id: PRODUCT_ID, perishable: false, serialized: true, inventory_quantity: '2' })
      .mockResolvedValueOnce({ total: 0 })
      .mockResolvedValueOnce({ total: 0 })

    const client = makeClient()
    vi.mocked(getClient).mockResolvedValueOnce(client as any)

    const res = await POST(postReq({
      serial_numbers: ['A', 'B'],
    }), paramsFor())
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
  })

  // --- 500 on DB error inside transaction ---

  it('rolls back and returns 500 on DB error during batch insert', async () => {
    vi.mocked(queryOne)
      .mockResolvedValueOnce({ id: PRODUCT_ID, perishable: true, serialized: false, inventory_quantity: '5' })
      .mockResolvedValueOnce({ total: 0 })
      .mockResolvedValueOnce({ total: 0 })

    const client = {
      query: vi.fn().mockImplementation((sql: string) => {
        if (sql === 'BEGIN') return Promise.resolve({ rows: [] })
        if (typeof sql === 'string' && sql.includes('INSERT INTO product_batches')) {
          return Promise.reject(new Error('Duplicate lot number'))
        }
        if (sql === 'ROLLBACK') return Promise.resolve({ rows: [] })
        return Promise.resolve({ rows: [] })
      }),
      release: vi.fn(),
    }
    vi.mocked(getClient).mockResolvedValueOnce(client as any)

    const res = await POST(postReq({ expiry_date: '2027-01-01' }), paramsFor())
    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json.error).toBe('Duplicate lot number')
    expect(client.query).toHaveBeenCalledWith('ROLLBACK')
    expect(client.release).toHaveBeenCalled()
  })
})
