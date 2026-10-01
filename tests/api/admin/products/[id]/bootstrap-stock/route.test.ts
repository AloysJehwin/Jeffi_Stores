import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({
  authenticateAdmin: vi.fn(),
}))
vi.mock('@/lib/auth/scopes', () => ({
  hasScope: vi.fn(),
}))

vi.mock('@/lib/shared/db', () => ({
  getClient: vi.fn(),
  queryOne: vi.fn(),
  // resolveGrainUnit reads the grain's base unit; no row => qty_step defaults to 1,
  // which is what these fixtures assume.
  query: vi.fn().mockResolvedValue({ rows: [] }),
}))

vi.mock('@/lib/catalog/shelf', () => ({
  syncPerishableStock: vi.fn().mockResolvedValue(undefined),
  upsertShelfStock: vi.fn().mockResolvedValue(undefined),
  syncCentralInventory: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/orders/inventory', () => ({
  logStockMovement: vi.fn().mockResolvedValue(undefined),
}))

import { POST } from '@/app/api/(admin)/admin/products/[id]/bootstrap-stock/route'
import { getClient, queryOne } from '@/lib/shared/db'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { syncPerishableStock, upsertShelfStock, syncCentralInventory } from '@/lib/catalog/shelf'
import { logStockMovement } from '@/lib/orders/inventory'

const PRODUCT_ID = '111e4567-e89b-12d3-a456-426614174001'
const VARIANT_ID = '222e4567-e89b-12d3-a456-426614174002'
const SUB_VARIANT_ID = '333e4567-e89b-12d3-a456-426614174003'
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
    // resolveGrainUnit runs inside the transaction to read the grain's base unit.
    // Answer it out-of-band so the positional fixtures below keep their meaning;
    // no row => qty_step defaults to 1, which is what these fixtures assume.
    query: vi.fn().mockImplementation(async (sql: string) => {
      if (typeof sql === 'string' && /FROM product_units/.test(sql)) return { rows: [] }
      return responses[idx++] ?? { rows: [] }
    }),
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
    vi.mocked(queryOne).mockResolvedValueOnce({
      id: PRODUCT_ID,
      perishable: false,
      serialized: false,
      inventory_quantity: '10',
    } as any)
    const res = await POST(makeReq({}), makeParams())
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/neither perishable nor serialized/)
  })

  it('returns 400 when perishable grain has quantity but no location_id', async () => {
    // Location is now required per grain, validated before any write.
    vi.mocked(queryOne).mockResolvedValueOnce({
      id: PRODUCT_ID,
      perishable: true,
      serialized: false,
      inventory_quantity: '0',
    } as any)
    const res = await POST(makeReq({ assignments: [{ quantity: 5, expiry_date: '2025-12-31' }] }), makeParams())
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/shelf location is required/)
  })

  it('returns 400 when perishable grain missing expiry_date', async () => {
    // Location present, but perishable requires expiry_date up-front.
    vi.mocked(queryOne).mockResolvedValueOnce({
      id: PRODUCT_ID,
      perishable: true,
      serialized: false,
      inventory_quantity: '5',
    } as any)
    const client = makeMockClient()
    vi.mocked(getClient).mockResolvedValue(client as any)
    const res = await POST(makeReq({ assignments: [{ quantity: 5, location_id: LOCATION_ID }] }), makeParams())
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/Expiry date is required/)
  })

  it('returns 400 when serialized grain has wrong serial count', async () => {
    // Explicit quantity 3 but only 2 serials → count mismatch caught up-front.
    vi.mocked(queryOne).mockResolvedValueOnce({
      id: PRODUCT_ID,
      perishable: false,
      serialized: true,
      inventory_quantity: '3',
    } as any)
    const client = makeMockClient()
    vi.mocked(getClient).mockResolvedValue(client as any)
    const res = await POST(
      makeReq({ assignments: [{ quantity: 3, location_id: LOCATION_ID, serial_numbers: ['SN1', 'SN2'] }] }),
      makeParams()
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/needs 3 serial/)
  })

  it('returns 409 when a serial already exists in stock', async () => {
    // product → serial clash lookup returns a match → 409
    vi.mocked(queryOne)
      .mockResolvedValueOnce({ id: PRODUCT_ID, perishable: false, serialized: true, inventory_quantity: '1' } as any)
      .mockResolvedValueOnce({ serial_number: 'SN1' } as any) // clash
    const res = await POST(
      makeReq({ assignments: [{ quantity: 1, location_id: LOCATION_ID, serial_numbers: ['SN1'] }] }),
      makeParams()
    )
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
    const res = await POST(
      makeReq({ assignments: [{ quantity: 5, location_id: LOCATION_ID, expiry_date: '2025-12-31' }] }),
      makeParams()
    )
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
      0: { rows: [] }, // BEGIN
      1: { rows: [{ id: 'batch-1' }] }, // INSERT batch
      2: { rows: [] }, // COMMIT
    })
    vi.mocked(getClient).mockResolvedValue(client as any)
    const res = await POST(
      makeReq({
        assignments: [{ quantity: 5, location_id: LOCATION_ID, expiry_date: '2025-12-31', lot_number: 'LOT1' }],
      }),
      makeParams()
    )
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
      0: { rows: [] }, // BEGIN
      1: { rows: [{ id: 'batch-1' }] }, // INSERT batch
    })
    vi.mocked(getClient).mockResolvedValue(client as any)
    const res = await POST(
      makeReq({ assignments: [{ quantity: 2, location_id: LOCATION_ID, serial_numbers: ['SN1', 'SN2'] }] }),
      makeParams()
    )
    expect(res.status).toBe(200)
    expect(logStockMovement).toHaveBeenCalled()
  })

  it('returns 200 with location_id for serialized (shelf_stock insert)', async () => {
    vi.mocked(queryOne)
      .mockResolvedValueOnce({ id: PRODUCT_ID, perishable: false, serialized: true, inventory_quantity: '1' } as any)
      .mockResolvedValueOnce(null as any) // no serial clash
      .mockResolvedValueOnce({ total: 0 } as any) // existing stock
    const client = makeMockClient({
      0: { rows: [] }, // BEGIN
      1: { rows: [{ id: 'batch-1' }] }, // INSERT batch
    })
    vi.mocked(getClient).mockResolvedValue(client as any)
    const res = await POST(
      makeReq({ assignments: [{ quantity: 1, serial_numbers: ['SN1'], location_id: LOCATION_ID }] }),
      makeParams()
    )
    expect(res.status).toBe(200)
  })

  it('skips a grain that is no longer a leaf after publish', async () => {
    vi.mocked(queryOne)
      .mockResolvedValueOnce({ id: PRODUCT_ID, perishable: true, serialized: false, inventory_quantity: '5' } as any)
      .mockResolvedValueOnce({ total: 0 } as any) // existing stock
      .mockResolvedValueOnce({ is_leaf: false } as any) // product now has active variants
    const client = makeMockClient()
    vi.mocked(getClient).mockResolvedValue(client as any)
    const res = await POST(
      makeReq({ assignments: [{ quantity: 5, location_id: LOCATION_ID, expiry_date: '2025-12-31' }] }),
      makeParams()
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.skipped).toEqual(['product'])
    expect(json.batch_ids).toEqual([])
    expect(syncPerishableStock).not.toHaveBeenCalled()
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
    const res = await POST(
      makeReq({ assignments: [{ quantity: 5, location_id: LOCATION_ID, expiry_date: '2025-12-31' }] }),
      makeParams()
    )
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/connection reset/)
  })
})

function makePositionalClient(responses: Record<number, any> = {}) {
  let idx = 0
  return {
    query: vi.fn().mockImplementation(async () => responses[idx++] ?? { rows: [] }),
    release: vi.fn(),
  }
}

describe('POST bootstrap-stock — legacy, serialized and conflict paths', () => {
  beforeEach(() => {
    vi.mocked(queryOne)
      .mockReset()
      .mockResolvedValue(null as any)
    vi.mocked(getClient)
      .mockReset()
      .mockResolvedValue(makePositionalClient() as any)
  })

  describe('POST bootstrap-stock — auth/scope', () => {
    it('returns 401 when unauthenticated', async () => {
      vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
      const res = await POST(makeReq({}), makeParams())
      expect(res.status).toBe(401)
    })
    it('returns 403 when scope missing', async () => {
      vi.mocked(hasScope).mockReturnValue(false)
      const res = await POST(makeReq({}), makeParams())
      expect(res.status).toBe(403)
    })
  })

  describe('POST bootstrap-stock — legacy no-quantity live fallback', () => {
    it('perishable legacy single-grain reads product.inventory_quantity', async () => {
      // No assignments, no explicit quantity → normalised to one legacy grain that
      // falls back to product.inventory_quantity ('4').
      vi.mocked(queryOne)
        .mockResolvedValueOnce({ id: PRODUCT_ID, perishable: true, serialized: false, inventory_quantity: '4' } as any)
        .mockResolvedValueOnce({ total: 0 } as any) // existing stock
      const client = makePositionalClient({ 0: { rows: [] }, 1: { rows: [{ id: 'batch-1' }] } })
      vi.mocked(getClient).mockResolvedValue(client as any)
      const res = await POST(makeReq({ location_id: LOCATION_ID, expiry_date: '2025-12-31' }), makeParams())
      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.batch_ids).toEqual(['batch-1'])
      expect(syncPerishableStock).toHaveBeenCalledWith(client, PRODUCT_ID, null, null)
    })

    it('perishable legacy grain: variant live inventory_quantity lookup', async () => {
      vi.mocked(queryOne)
        .mockResolvedValueOnce({ id: PRODUCT_ID, perishable: true, serialized: false, inventory_quantity: '0' } as any)
        .mockResolvedValueOnce({ inventory_quantity: '7' } as any) // variant lookup
        .mockResolvedValueOnce({ total: 0 } as any) // existing stock
      const client = makePositionalClient({ 0: { rows: [] }, 1: { rows: [{ id: 'batch-v' }] } })
      vi.mocked(getClient).mockResolvedValue(client as any)
      const res = await POST(
        makeReq({ assignments: [{ variant_id: VARIANT_ID, location_id: LOCATION_ID, expiry_date: '2025-12-31' }] }),
        makeParams()
      )
      expect(res.status).toBe(200)
      expect(syncPerishableStock).toHaveBeenCalledWith(client, PRODUCT_ID, VARIANT_ID, null)
    })

    it('perishable legacy grain: sub-variant live inventory_quantity lookup', async () => {
      vi.mocked(queryOne)
        .mockResolvedValueOnce({ id: PRODUCT_ID, perishable: true, serialized: false, inventory_quantity: '0' } as any)
        .mockResolvedValueOnce({ inventory_quantity: '3' } as any) // sub-variant lookup
        .mockResolvedValueOnce({ total: 0 } as any) // existing stock
      const client = makePositionalClient({ 0: { rows: [] }, 1: { rows: [{ id: 'batch-sv' }] } })
      vi.mocked(getClient).mockResolvedValue(client as any)
      const res = await POST(
        makeReq({
          assignments: [
            {
              variant_id: VARIANT_ID,
              sub_variant_id: SUB_VARIANT_ID,
              location_id: LOCATION_ID,
              expiry_date: '2025-12-31',
            },
          ],
        }),
        makeParams()
      )
      expect(res.status).toBe(200)
      expect(syncPerishableStock).toHaveBeenCalledWith(client, PRODUCT_ID, VARIANT_ID, SUB_VARIANT_ID)
    })

    it('legacy grain with zero live inventory is skipped (no batch, still 200)', async () => {
      vi.mocked(queryOne).mockResolvedValueOnce({
        id: PRODUCT_ID,
        perishable: true,
        serialized: false,
        inventory_quantity: '0',
      } as any)
      // no variant/sub-variant → product fallback = 0 → skipped, existing-stock query never runs
      const client = makePositionalClient({ 0: { rows: [] } }) // BEGIN then COMMIT
      vi.mocked(getClient).mockResolvedValue(client as any)
      const res = await POST(makeReq({ location_id: LOCATION_ID, expiry_date: '2025-12-31' }), makeParams())
      expect(res.status).toBe(200)
      expect((await res.json()).batch_ids).toEqual([])
      expect(syncPerishableStock).not.toHaveBeenCalled()
    })

    it('explicit quantity of 0 is skipped up-front (no writes)', async () => {
      vi.mocked(queryOne).mockResolvedValueOnce({
        id: PRODUCT_ID,
        perishable: true,
        serialized: false,
        inventory_quantity: '5',
      } as any)
      const client = makePositionalClient({ 0: { rows: [] } })
      vi.mocked(getClient).mockResolvedValue(client as any)
      // quantity 0 → up-front validation `continue`s past location/expiry requirement,
      // and write loop also skips. Even without location_id it should 200.
      const res = await POST(makeReq({ assignments: [{ quantity: 0 }] }), makeParams())
      expect(res.status).toBe(200)
      expect((await res.json()).batch_ids).toEqual([])
    })
  })

  describe('POST bootstrap-stock — serialized-only shelf path', () => {
    it('serialized-only writes shelf row and syncs central inventory', async () => {
      vi.mocked(queryOne)
        .mockResolvedValueOnce({ id: PRODUCT_ID, perishable: false, serialized: true, inventory_quantity: '2' } as any)
        .mockResolvedValueOnce(null as any) // no serial clash
        .mockResolvedValueOnce({ total: 0 } as any) // existing stock
      // client.query order for a serialized grain: BEGIN(0) -> resolveGrainUnit SELECT(1)
      // -> INSERT INTO product_batches(2). No product_units row configured -> resolveGrainUnit
      // falls back to step 1, matching pre-qty_step behaviour (needed = round(qty)).
      const client = makePositionalClient({ 0: { rows: [] }, 1: { rows: [] }, 2: { rows: [{ id: 'batch-s' }] } })
      vi.mocked(getClient).mockResolvedValue(client as any)
      const res = await POST(
        makeReq({ assignments: [{ quantity: 2, location_id: LOCATION_ID, serial_numbers: ['A1', 'A2'] }] }),
        makeParams()
      )
      expect(res.status).toBe(200)
      expect(upsertShelfStock).toHaveBeenCalledWith(
        client,
        expect.objectContaining({ locationId: LOCATION_ID, productId: PRODUCT_ID, quantity: 2, mode: 'add' })
      )
      expect(syncCentralInventory).toHaveBeenCalledWith(client, PRODUCT_ID, null, null)
    })

    it('serialized-only already-bootstrapped: skips shelf add but still syncs central', async () => {
      vi.mocked(queryOne)
        .mockResolvedValueOnce({ id: PRODUCT_ID, perishable: false, serialized: true, inventory_quantity: '1' } as any)
        .mockResolvedValueOnce(null as any) // no serial clash
        .mockResolvedValueOnce({ total: 1 } as any) // existing stock > 0 → alreadyBootstrapped
      const client = makePositionalClient()
      vi.mocked(getClient).mockResolvedValue(client as any)
      const res = await POST(
        makeReq({ assignments: [{ quantity: 1, location_id: LOCATION_ID, serial_numbers: ['B1'] }] }),
        makeParams()
      )
      expect(res.status).toBe(200)
      expect(upsertShelfStock).not.toHaveBeenCalled()
      expect(syncCentralInventory).toHaveBeenCalledWith(client, PRODUCT_ID, null, null)
    })
  })

  describe('POST bootstrap-stock — duplicate serials within request', () => {
    it('returns 400 when a serial repeats across grains', async () => {
      vi.mocked(queryOne).mockResolvedValueOnce({
        id: PRODUCT_ID,
        perishable: false,
        serialized: true,
        inventory_quantity: '2',
      } as any)
      const res = await POST(
        makeReq({
          assignments: [
            { quantity: 1, location_id: LOCATION_ID, serial_numbers: ['DUP'] },
            { quantity: 1, location_id: LOCATION_ID, serial_numbers: ['DUP'] },
          ],
        }),
        makeParams()
      )
      expect(res.status).toBe(400)
      expect((await res.json()).error).toMatch(/Duplicate serial number/)
    })
  })

  describe('POST bootstrap-stock — 23505 unique violation', () => {
    it('maps a Postgres 23505 raised mid-transaction to a clean 409', async () => {
      vi.mocked(queryOne)
        .mockResolvedValueOnce({ id: PRODUCT_ID, perishable: false, serialized: true, inventory_quantity: '1' } as any)
        .mockResolvedValueOnce(null as any) // no serial clash pre-check
        .mockResolvedValueOnce({ total: 0 } as any) // existing stock
      const err: any = new Error('duplicate key value violates unique constraint')
      err.code = '23505'
      const client = {
        query: vi
          .fn()
          .mockResolvedValueOnce({ rows: [] }) // BEGIN
          .mockResolvedValueOnce({ rows: [{ id: 'b' }] }) // INSERT batch
          .mockRejectedValueOnce(err) // INSERT serial → 23505
          .mockResolvedValue({ rows: [] }), // ROLLBACK
        release: vi.fn(),
      }
      vi.mocked(getClient).mockResolvedValue(client as any)
      const res = await POST(
        makeReq({ assignments: [{ quantity: 1, location_id: LOCATION_ID, serial_numbers: ['C1'] }] }),
        makeParams()
      )
      expect(res.status).toBe(409)
      expect((await res.json()).error).toMatch(/already exist in stock/)
    })
  })
})
