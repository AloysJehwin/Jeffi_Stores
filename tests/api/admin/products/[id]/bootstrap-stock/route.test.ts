import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

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
  syncCentralInventory: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/inventory', () => ({
  logStockMovement: vi.fn().mockResolvedValue(undefined),
}))

import { POST } from '@/app/api/admin/products/[id]/bootstrap-stock/route'
import { getClient, queryOne } from '@/lib/db'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { syncPerishableStock } from '@/lib/shelf'
import { logStockMovement } from '@/lib/inventory'

const PRODUCT_ID = '111e4567-e89b-12d3-a456-426614174001'
const VARIANT_ID = '222e4567-e89b-12d3-a456-426614174002'
const LOCATION_ID = '444e4567-e89b-12d3-a456-426614174004'

function makeReq(body: unknown, productId = PRODUCT_ID) {
  return new NextRequest(`http://localhost/api/admin/products/${productId}/bootstrap-stock`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function makeParams(productId = PRODUCT_ID) {
  return { params: Promise.resolve({ id: productId }) }
}

function makeMockClient(responses: Record<number, any> = {}) {
  let idx = 0
  return {
    query: vi.fn().mockImplementation(async () => responses[idx++] ?? { rows: [] }),
    release: vi.fn(),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(authenticateAdmin).mockResolvedValue({ adminId: 'admin-1', role: 'super_admin', scopes: [] } as any)
  vi.mocked(hasScope).mockReturnValue(true)
  vi.mocked(logStockMovement).mockResolvedValue(undefined)
  vi.mocked(syncPerishableStock).mockResolvedValue(undefined)
  // clearAllMocks wipes implementations; provide safe defaults
  vi.mocked(queryOne).mockResolvedValue(null as any)
  const defaultClient = makeMockClient()
  vi.mocked(getClient).mockResolvedValue(defaultClient as any)
})

describe('POST /api/admin/products/[id]/bootstrap-stock', () => {
  it('returns 400 for invalid body (bad uuid)', async () => {
    // bodySchema.safeParse fails before queryOne is called — no mock needed
    const res = await POST(makeReq({ variant_id: 'not-a-uuid' }), makeParams())
    expect(res.status).toBe(400)
  })

  it('returns 404 when product not found', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce(null)
    // getClient is never reached, but mock it to avoid undefined.release errors
    const client = makeMockClient()
    vi.mocked(getClient).mockResolvedValue(client as any)
    const res = await POST(makeReq({ expiry_date: '2025-12-31' }), makeParams())
    expect(res.status).toBe(404)
  })

  it('returns 400 when product is neither perishable nor serialized', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce({ id: PRODUCT_ID, perishable: false, serialized: false, inventory_quantity: '10' } as any)
    const res = await POST(makeReq({}), makeParams())
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/neither perishable nor serialized/)
  })

  it('returns 400 when perishable grain has quantity but no location_id', async () => {
    // Location is now required per grain, validated before any write.
    vi.mocked(queryOne).mockResolvedValueOnce({ id: PRODUCT_ID, perishable: true, serialized: false, inventory_quantity: '0' } as any)
    const res = await POST(makeReq({ assignments: [{ quantity: 5, expiry_date: '2025-12-31' }] }), makeParams())
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/shelf location is required/)
  })

  it('returns 400 when perishable grain missing expiry_date', async () => {
    // Location present, but perishable requires expiry_date up-front.
    vi.mocked(queryOne).mockResolvedValueOnce({ id: PRODUCT_ID, perishable: true, serialized: false, inventory_quantity: '5' } as any)
    const client = makeMockClient()
    vi.mocked(getClient).mockResolvedValue(client as any)
    const res = await POST(makeReq({ assignments: [{ quantity: 5, location_id: LOCATION_ID }] }), makeParams())
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/Expiry date is required/)
  })

  it('returns 400 when serialized grain has wrong serial count', async () => {
    // Explicit quantity 3 but only 2 serials → count mismatch caught up-front.
    vi.mocked(queryOne).mockResolvedValueOnce({ id: PRODUCT_ID, perishable: false, serialized: true, inventory_quantity: '3' } as any)
    const client = makeMockClient()
    vi.mocked(getClient).mockResolvedValue(client as any)
    const res = await POST(makeReq({ assignments: [{ quantity: 3, location_id: LOCATION_ID, serial_numbers: ['SN1', 'SN2'] }] }), makeParams())
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/needs 3 serial/)
  })

  it('returns 409 when a serial already exists in stock', async () => {
    // product → serial clash lookup returns a match → 409
    vi.mocked(queryOne)
      .mockResolvedValueOnce({ id: PRODUCT_ID, perishable: false, serialized: true, inventory_quantity: '1' } as any)
      .mockResolvedValueOnce({ serial_number: 'SN1' } as any) // clash
    const res = await POST(makeReq({ assignments: [{ quantity: 1, location_id: LOCATION_ID, serial_numbers: ['SN1'] }] }), makeParams())
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/already exists in stock/)
  })

  it('idempotent: already-bootstrapped grain returns 200 and skips new inserts', async () => {
    // existing total > 0 → skip creating new batch, still re-sync, returns 200.
    vi.mocked(queryOne)
      .mockResolvedValueOnce({ id: PRODUCT_ID, perishable: true, serialized: false, inventory_quantity: '5' } as any)
      .mockResolvedValueOnce({ total: 1 } as any) // existing active stock
    const client = makeMockClient()
    vi.mocked(getClient).mockResolvedValue(client as any)
    const res = await POST(makeReq({ assignments: [{ quantity: 5, location_id: LOCATION_ID, expiry_date: '2025-12-31' }] }), makeParams())
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.batch_ids).toEqual([]) // no new batch created
    expect(syncPerishableStock).toHaveBeenCalled() // still re-synced
  })

  it('returns 200 for perishable product (syncPerishableStock called)', async () => {
    vi.mocked(queryOne)
      .mockResolvedValueOnce({ id: PRODUCT_ID, perishable: true, serialized: false, inventory_quantity: '5' } as any)
      .mockResolvedValueOnce({ total: 0 } as any) // existing stock
    const client = makeMockClient({
      0: { rows: [] },              // BEGIN
      1: { rows: [{ id: 'batch-1' }] }, // INSERT batch
      2: { rows: [] },              // COMMIT
    })
    vi.mocked(getClient).mockResolvedValue(client as any)
    const res = await POST(makeReq({ assignments: [{ quantity: 5, location_id: LOCATION_ID, expiry_date: '2025-12-31', lot_number: 'LOT1' }] }), makeParams())
    expect(res.status).toBe(200)
    expect((await res.json()).success).toBe(true)
    expect(syncPerishableStock).toHaveBeenCalledWith(client, PRODUCT_ID, null, null)
  })

  it('returns 200 for serialized product (correct serial count)', async () => {
    vi.mocked(queryOne)
      .mockResolvedValueOnce({ id: PRODUCT_ID, perishable: false, serialized: true, inventory_quantity: '2' } as any)
      .mockResolvedValueOnce(null as any) // no serial clash
      .mockResolvedValueOnce({ total: 0 } as any) // existing stock
    const client = makeMockClient({
      0: { rows: [] },                   // BEGIN
      1: { rows: [{ id: 'batch-1' }] },  // INSERT batch
    })
    vi.mocked(getClient).mockResolvedValue(client as any)
    const res = await POST(makeReq({ assignments: [{ quantity: 2, location_id: LOCATION_ID, serial_numbers: ['SN1', 'SN2'] }] }), makeParams())
    expect(res.status).toBe(200)
    expect(logStockMovement).toHaveBeenCalled()
  })

  it('returns 200 with location_id for serialized (shelf_stock insert)', async () => {
    vi.mocked(queryOne)
      .mockResolvedValueOnce({ id: PRODUCT_ID, perishable: false, serialized: true, inventory_quantity: '1' } as any)
      .mockResolvedValueOnce(null as any) // no serial clash
      .mockResolvedValueOnce({ total: 0 } as any) // existing stock
    const client = makeMockClient({
      0: { rows: [] },                   // BEGIN
      1: { rows: [{ id: 'batch-1' }] },  // INSERT batch
    })
    vi.mocked(getClient).mockResolvedValue(client as any)
    const res = await POST(makeReq({ assignments: [{ quantity: 1, serial_numbers: ['SN1'], location_id: LOCATION_ID }] }), makeParams())
    expect(res.status).toBe(200)
  })

  it('returns 500 when BEGIN fails', async () => {
    vi.mocked(queryOne)
      .mockResolvedValueOnce({ id: PRODUCT_ID, perishable: true, serialized: false, inventory_quantity: '5' } as any)
      .mockResolvedValueOnce({ total: 0 } as any) // existing stock
    const client = {
      query: vi.fn().mockRejectedValueOnce(new Error('connection reset')),
      release: vi.fn(),
    }
    vi.mocked(getClient).mockResolvedValue(client as any)
    const res = await POST(makeReq({ assignments: [{ quantity: 5, location_id: LOCATION_ID, expiry_date: '2025-12-31' }] }), makeParams())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/connection reset/)
  })
})
