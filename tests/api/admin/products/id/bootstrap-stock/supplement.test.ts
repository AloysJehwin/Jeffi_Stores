import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// Supplements the existing [id]/bootstrap-stock/route.test.ts, driving the
// legacy no-explicit-quantity branches (live inventory_quantity fallback per
// grain), the explicit-zero skip, the 23505 unique-violation catch, and the
// serialized-only shelf path.

vi.mock('@/lib/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/db', () => ({ getClient: vi.fn(), queryOne: vi.fn(), query: vi.fn().mockResolvedValue({ rows: [] }) }))
vi.mock('@/lib/shelf', () => ({
  syncPerishableStock: vi.fn().mockResolvedValue(undefined),
  upsertShelfStock: vi.fn().mockResolvedValue(undefined),
  syncCentralInventory: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/inventory', () => ({ logStockMovement: vi.fn().mockResolvedValue(undefined) }))

import { POST } from '@/app/api/admin/products/[id]/bootstrap-stock/route'
import { getClient, queryOne } from '@/lib/db'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { syncPerishableStock, upsertShelfStock, syncCentralInventory } from '@/lib/shelf'

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
    query: vi.fn().mockImplementation(async () => responses[idx++] ?? { rows: [] }),
    release: vi.fn(),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(authenticateAdmin).mockResolvedValue({ adminId: 'a1', role: 'super_admin', scopes: [] } as any)
  vi.mocked(hasScope).mockReturnValue(true)
  vi.mocked(queryOne).mockResolvedValue(null as any)
  vi.mocked(getClient).mockResolvedValue(makeMockClient() as any)
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
    const client = makeMockClient({ 0: { rows: [] }, 1: { rows: [{ id: 'batch-1' }] } })
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
      .mockResolvedValueOnce({ total: 0 } as any)                // existing stock
    const client = makeMockClient({ 0: { rows: [] }, 1: { rows: [{ id: 'batch-v' }] } })
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
      .mockResolvedValueOnce({ total: 0 } as any)                // existing stock
    const client = makeMockClient({ 0: { rows: [] }, 1: { rows: [{ id: 'batch-sv' }] } })
    vi.mocked(getClient).mockResolvedValue(client as any)
    const res = await POST(
      makeReq({ assignments: [{ variant_id: VARIANT_ID, sub_variant_id: SUB_VARIANT_ID, location_id: LOCATION_ID, expiry_date: '2025-12-31' }] }),
      makeParams()
    )
    expect(res.status).toBe(200)
    expect(syncPerishableStock).toHaveBeenCalledWith(client, PRODUCT_ID, VARIANT_ID, SUB_VARIANT_ID)
  })

  it('legacy grain with zero live inventory is skipped (no batch, still 200)', async () => {
    vi.mocked(queryOne)
      .mockResolvedValueOnce({ id: PRODUCT_ID, perishable: true, serialized: false, inventory_quantity: '0' } as any)
      // no variant/sub-variant → product fallback = 0 → skipped, existing-stock query never runs
    const client = makeMockClient({ 0: { rows: [] } }) // BEGIN then COMMIT
    vi.mocked(getClient).mockResolvedValue(client as any)
    const res = await POST(makeReq({ location_id: LOCATION_ID, expiry_date: '2025-12-31' }), makeParams())
    expect(res.status).toBe(200)
    expect((await res.json()).batch_ids).toEqual([])
    expect(syncPerishableStock).not.toHaveBeenCalled()
  })

  it('explicit quantity of 0 is skipped up-front (no writes)', async () => {
    vi.mocked(queryOne)
      .mockResolvedValueOnce({ id: PRODUCT_ID, perishable: true, serialized: false, inventory_quantity: '5' } as any)
    const client = makeMockClient({ 0: { rows: [] } })
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
      .mockResolvedValueOnce(null as any)        // no serial clash
      .mockResolvedValueOnce({ total: 0 } as any) // existing stock
    // client.query order for a serialized grain: BEGIN(0) -> resolveGrainUnit SELECT(1)
    // -> INSERT INTO product_batches(2). No product_units row configured -> resolveGrainUnit
    // falls back to step 1, matching pre-qty_step behaviour (needed = round(qty)).
    const client = makeMockClient({ 0: { rows: [] }, 1: { rows: [] }, 2: { rows: [{ id: 'batch-s' }] } })
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
      .mockResolvedValueOnce(null as any)        // no serial clash
      .mockResolvedValueOnce({ total: 1 } as any) // existing stock > 0 → alreadyBootstrapped
    const client = makeMockClient()
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
    vi.mocked(queryOne)
      .mockResolvedValueOnce({ id: PRODUCT_ID, perishable: false, serialized: true, inventory_quantity: '2' } as any)
    const res = await POST(
      makeReq({ assignments: [
        { quantity: 1, location_id: LOCATION_ID, serial_numbers: ['DUP'] },
        { quantity: 1, location_id: LOCATION_ID, serial_numbers: ['DUP'] },
      ] }),
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
      .mockResolvedValueOnce(null as any)        // no serial clash pre-check
      .mockResolvedValueOnce({ total: 0 } as any) // existing stock
    const err: any = new Error('duplicate key value violates unique constraint')
    err.code = '23505'
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [] })            // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: 'b' }] }) // INSERT batch
        .mockRejectedValueOnce(err)                     // INSERT serial → 23505
        .mockResolvedValue({ rows: [] }),               // ROLLBACK
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
