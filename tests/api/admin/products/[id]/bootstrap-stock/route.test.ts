import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/db', () => ({
  getClient: vi.fn(),
  queryOne: vi.fn(),
}))

vi.mock('@/lib/shelf', () => ({
  syncPerishableStock: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/inventory', () => ({
  logStockMovement: vi.fn().mockResolvedValue(undefined),
}))

import { POST } from '@/app/api/admin/products/[id]/bootstrap-stock/route'
import { getClient, queryOne } from '@/lib/db'
import { syncPerishableStock } from '@/lib/shelf'
import { logStockMovement } from '@/lib/inventory'

const PRODUCT_ID = '111e4567-e89b-12d3-a456-426614174001'
const VARIANT_ID = '222e4567-e89b-12d3-a456-426614174002'

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

  it('returns 400 when inventory_quantity is zero', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce({ id: PRODUCT_ID, perishable: true, serialized: false, inventory_quantity: '0' } as any)
    const res = await POST(makeReq({ expiry_date: '2025-12-31' }), makeParams())
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/No existing stock/)
  })

  it('returns 400 when perishable product missing expiry_date', async () => {
    // product → inventoryQty OK → perishable+no expiry → returns 400 (never reaches existingBatch check)
    vi.mocked(queryOne)
      .mockResolvedValueOnce({ id: PRODUCT_ID, perishable: true, serialized: false, inventory_quantity: '5' } as any)
    const client = makeMockClient()
    vi.mocked(getClient).mockResolvedValue(client as any)
    const res = await POST(makeReq({}), makeParams())
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/Expiry date/)
  })

  it('returns 409 when already bootstrapped', async () => {
    // product → inventoryQty OK → expiry OK → serial count OK (not serialized) → existingBatch check
    vi.mocked(queryOne)
      .mockResolvedValueOnce({ id: PRODUCT_ID, perishable: true, serialized: false, inventory_quantity: '5' } as any)
      .mockResolvedValueOnce({ total: 1 } as any) // existingBatch > 0
      .mockResolvedValueOnce({ total: 0 } as any)
    const client = makeMockClient()
    vi.mocked(getClient).mockResolvedValue(client as any)
    const res = await POST(makeReq({ expiry_date: '2025-12-31' }), makeParams())
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/already bootstrapped/)
  })

  it('returns 400 when serialized wrong serial count', async () => {
    // product → inventoryQty OK → not perishable so no expiry check → serial count wrong → 400
    vi.mocked(queryOne)
      .mockResolvedValueOnce({ id: PRODUCT_ID, perishable: false, serialized: true, inventory_quantity: '3' } as any)
    const client = makeMockClient()
    vi.mocked(getClient).mockResolvedValue(client as any)
    // only provide 2 serials but inventory is 3
    const res = await POST(makeReq({ serial_numbers: ['SN1', 'SN2'] }), makeParams())
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/3 serial/)
  })

  it('returns 200 for perishable product (syncPerishableStock called)', async () => {
    vi.mocked(queryOne)
      .mockResolvedValueOnce({ id: PRODUCT_ID, perishable: true, serialized: false, inventory_quantity: '5' } as any)
      .mockResolvedValueOnce({ total: 0 } as any) // existingBatch
      .mockResolvedValueOnce({ total: 0 } as any) // existingSerial
    const client = makeMockClient({
      0: { rows: [] },              // BEGIN
      1: { rows: [{ id: 'batch-1' }] }, // INSERT batch
      // logStockMovement is mocked at lib level — no client.query
      // syncPerishableStock is mocked at lib level — no client.query
      2: { rows: [] },              // COMMIT
    })
    vi.mocked(getClient).mockResolvedValue(client as any)
    const res = await POST(makeReq({ expiry_date: '2025-12-31', lot_number: 'LOT1' }), makeParams())
    expect(res.status).toBe(200)
    expect((await res.json()).success).toBe(true)
    expect(syncPerishableStock).toHaveBeenCalledWith(client, PRODUCT_ID, null, null)
  })

  it('returns 200 for serialized product (correct serial count)', async () => {
    vi.mocked(queryOne)
      .mockResolvedValueOnce({ id: PRODUCT_ID, perishable: false, serialized: true, inventory_quantity: '2' } as any)
      .mockResolvedValueOnce({ total: 0 } as any) // existingBatch
      .mockResolvedValueOnce({ total: 0 } as any) // existingSerial
    const client = makeMockClient({
      0: { rows: [] },                   // BEGIN
      1: { rows: [{ id: 'batch-1' }] },  // INSERT batch
      2: { rows: [] },                   // INSERT serial SN1
      3: { rows: [] },                   // INSERT serial SN2
      // logStockMovement is mocked at lib level
      4: { rows: [] },                   // COMMIT
    })
    vi.mocked(getClient).mockResolvedValue(client as any)
    const res = await POST(makeReq({ serial_numbers: ['SN1', 'SN2'] }), makeParams())
    expect(res.status).toBe(200)
    expect(logStockMovement).toHaveBeenCalled()
  })

  it('returns 200 with location_id for serialized (shelf_stock insert)', async () => {
    vi.mocked(queryOne)
      .mockResolvedValueOnce({ id: PRODUCT_ID, perishable: false, serialized: true, inventory_quantity: '1' } as any)
      .mockResolvedValueOnce({ total: 0 } as any) // existingBatch
      .mockResolvedValueOnce({ total: 0 } as any) // existingSerial
    const locationId = '444e4567-e89b-12d3-a456-426614174004'
    const client = makeMockClient({
      0: { rows: [] },                   // BEGIN
      1: { rows: [{ id: 'batch-1' }] },  // INSERT batch
      2: { rows: [] },                   // INSERT serial SN1
      // logStockMovement is mocked at lib level
      3: { rows: [] },                   // shelf_stock upsert
      4: { rows: [] },                   // COMMIT
    })
    vi.mocked(getClient).mockResolvedValue(client as any)
    const res = await POST(makeReq({ serial_numbers: ['SN1'], location_id: locationId }), makeParams())
    expect(res.status).toBe(200)
  })

  it('returns 404 when variant_id not found', async () => {
    vi.mocked(queryOne)
      .mockResolvedValueOnce({ id: PRODUCT_ID, perishable: true, serialized: false, inventory_quantity: '5' } as any)
      .mockResolvedValueOnce(null) // variant not found
    const client = makeMockClient()
    vi.mocked(getClient).mockResolvedValue(client as any)
    const res = await POST(makeReq({ variant_id: VARIANT_ID, expiry_date: '2025-12-31' }), makeParams())
    expect(res.status).toBe(404)
    expect((await res.json()).error).toMatch(/Variant not found/)
  })

  it('returns 500 when BEGIN fails', async () => {
    vi.mocked(queryOne)
      .mockResolvedValueOnce({ id: PRODUCT_ID, perishable: true, serialized: false, inventory_quantity: '5' } as any)
      .mockResolvedValueOnce({ total: 0 } as any) // existingBatch
      .mockResolvedValueOnce({ total: 0 } as any) // existingSerial
    const client = {
      query: vi.fn().mockRejectedValueOnce(new Error('connection reset')),
      release: vi.fn(),
    }
    vi.mocked(getClient).mockResolvedValue(client as any)
    const res = await POST(makeReq({ expiry_date: '2025-12-31' }), makeParams())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/connection reset/)
  })
})
