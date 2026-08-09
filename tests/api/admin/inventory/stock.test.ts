import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/lib/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/db', () => ({
  getClient: vi.fn(),
  queryOne: vi.fn(),
  query: vi.fn(),
  queryMany: vi.fn(),
}))
vi.mock('@/lib/inventory', () => ({
  getStockLedger: vi.fn(),
  getStockValuation: vi.fn(),
  logStockMovement: vi.fn(),
}))
vi.mock('@/lib/admin-audit', () => ({ logAdminAudit: vi.fn() }))
vi.mock('@/lib/validate', () => {
  const actual = vi.importActual('@/lib/validate')
  return actual
})
vi.mock('@/lib/shelf', () => ({
  getOrCreateOpenShelf: vi.fn().mockResolvedValue('shelf-loc-1'),
  upsertShelfStock: vi.fn().mockResolvedValue(undefined),
}))

// ── Imports ───────────────────────────────────────────────────────────────────

import { GET, PATCH } from '@/app/api/admin/inventory/stock/route'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { getClient, queryOne, query, queryMany } from '@/lib/db'
import { getStockLedger, getStockValuation, logStockMovement } from '@/lib/inventory'
import { logAdminAudit } from '@/lib/admin-audit'
import { getOrCreateOpenShelf, upsertShelfStock } from '@/lib/shelf'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockGetClient = vi.mocked(getClient)
const mockQueryOne = vi.mocked(queryOne)
const mockGetStockLedger = vi.mocked(getStockLedger)
const mockGetStockValuation = vi.mocked(getStockValuation)
const mockLogStockMovement = vi.mocked(logStockMovement)
const mockLogAdminAudit = vi.mocked(logAdminAudit)
const mockGetOrCreateOpenShelf = vi.mocked(getOrCreateOpenShelf)
const mockUpsertShelfStock = vi.mocked(upsertShelfStock)

// ── Helpers ───────────────────────────────────────────────────────────────────

const ADMIN = { adminId: 'admin-1', role: 'super_admin', scopes: ['inventory'], first_name: 'Test', last_name: 'Admin', username: 'testadmin' }
const PRODUCT_UUID = '00000000-0000-4000-8000-000000000001'
const VARIANT_UUID = '00000000-0000-4000-8000-000000000002'
const SUB_VARIANT_UUID = '00000000-0000-4000-8000-000000000003'
const UNIT_UUID = '00000000-0000-4000-8000-000000000004'

function makeGetReq(params = '') {
  return new NextRequest(`http://localhost/api/admin/inventory/stock${params}`)
}

function makePatchReq(body: any) {
  return new NextRequest('http://localhost/api/admin/inventory/stock', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

function makeDbClient(queryResponses: any[]) {
  let callIndex = 0
  return {
    query: vi.fn().mockImplementation(() => {
      return Promise.resolve(queryResponses[callIndex++] ?? { rows: [] })
    }),
    release: vi.fn(),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockLogAdminAudit.mockResolvedValue(undefined)
  mockLogStockMovement.mockResolvedValue(undefined)
  mockGetOrCreateOpenShelf.mockResolvedValue('shelf-loc-1')
  mockUpsertShelfStock.mockResolvedValue(undefined)
})

// ── GET tests ─────────────────────────────────────────────────────────────────

describe('GET /api/admin/inventory/stock', () => {
  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null as any)
    const res = await GET(makeGetReq())
    expect(res.status).toBe(401)
  })

  it('returns 403 when scope missing', async () => {
    mockAuth.mockResolvedValue(ADMIN as any)
    mockHasScope.mockReturnValue(false)
    const res = await GET(makeGetReq())
    expect(res.status).toBe(403)
  })

  it('returns ledger on default view', async () => {
    mockAuth.mockResolvedValue(ADMIN as any)
    mockHasScope.mockReturnValue(true)
    mockGetStockLedger.mockResolvedValue({ rows: [{ id: 'tx1' }], total: 1 } as any)
    const res = await GET(makeGetReq())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.transactions).toHaveLength(1)
    expect(body.total).toBe(1)
  })

  it('returns valuation when view=valuation', async () => {
    mockAuth.mockResolvedValue(ADMIN as any)
    mockHasScope.mockReturnValue(true)
    mockGetStockValuation.mockResolvedValue({ items: [], total: 0, totalValue: 0 } as any)
    const res = await GET(makeGetReq('?view=valuation'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.items).toBeDefined()
  })

  it('passes search/category/brand/stock_status params to getStockValuation', async () => {
    mockAuth.mockResolvedValue(ADMIN as any)
    mockHasScope.mockReturnValue(true)
    mockGetStockValuation.mockResolvedValue({ items: [], total: 0, totalValue: 0 } as any)
    await GET(makeGetReq('?view=valuation&search=bolt&category=Fasteners&brand=Unbrako&stock_status=low&page=2&limit=25'))
    expect(mockGetStockValuation).toHaveBeenCalledWith(expect.objectContaining({
      search: 'bolt',
      categoryName: 'Fasteners',
      brandName: 'Unbrako',
      stockStatus: 'low',
      limit: 25,
      offset: 25,
    }))
  })

  it('passes product_id/search/from/to params to getStockLedger', async () => {
    mockAuth.mockResolvedValue(ADMIN as any)
    mockHasScope.mockReturnValue(true)
    mockGetStockLedger.mockResolvedValue({ rows: [], total: 0 } as any)
    await GET(makeGetReq(`?product_id=${PRODUCT_UUID}&search=nut&from=2024-01-01&to=2024-12-31&page=3&limit=10`))
    expect(mockGetStockLedger).toHaveBeenCalledWith(expect.objectContaining({
      productId: PRODUCT_UUID,
      search: 'nut',
      from: '2024-01-01',
      to: '2024-12-31',
      limit: 10,
      offset: 20,
    }))
  })

  it('returns 500 on unexpected error', async () => {
    mockAuth.mockResolvedValue(ADMIN as any)
    mockHasScope.mockReturnValue(true)
    mockGetStockLedger.mockRejectedValue(new Error('DB failure'))
    const res = await GET(makeGetReq())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('DB failure')
  })
})

// ── GET batch_valuation view ──────────────────────────────────────────────────

describe('GET /api/admin/inventory/stock?view=batch_valuation', () => {
  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null as any)
    const res = await GET(makeGetReq('?view=batch_valuation'))
    expect(res.status).toBe(401)
  })

  it('returns 403 when scope missing', async () => {
    mockAuth.mockResolvedValue(ADMIN as any)
    mockHasScope.mockReturnValue(false)
    const res = await GET(makeGetReq('?view=batch_valuation'))
    expect(res.status).toBe(403)
  })

  it('returns batch list on happy path', async () => {
    mockAuth.mockResolvedValue(ADMIN as any)
    mockHasScope.mockReturnValue(true)
    vi.mocked(queryMany).mockResolvedValue([
      { batch_id: 'b1', lot_number: 'LOT-001', quantity_remaining: 50, product_name: 'Bolt M6' },
    ] as any)
    const res = await GET(makeGetReq('?view=batch_valuation'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.batches).toHaveLength(1)
    expect(body.batches[0].lot_number).toBe('LOT-001')
  })

  it('filters by product_id, variant_id, sub_variant_id when provided', async () => {
    mockAuth.mockResolvedValue(ADMIN as any)
    mockHasScope.mockReturnValue(true)
    vi.mocked(queryMany).mockResolvedValue([] as any)
    const res = await GET(makeGetReq(
      `?view=batch_valuation&product_id=${PRODUCT_UUID}&variant_id=${VARIANT_UUID}&sub_variant_id=${SUB_VARIANT_UUID}`
    ))
    expect(res.status).toBe(200)
    const call = vi.mocked(queryMany).mock.calls[0]
    expect(call[1]).toContain(PRODUCT_UUID)
    expect(call[1]).toContain(VARIANT_UUID)
    expect(call[1]).toContain(SUB_VARIANT_UUID)
  })

  it('applies text search filter', async () => {
    mockAuth.mockResolvedValue(ADMIN as any)
    mockHasScope.mockReturnValue(true)
    vi.mocked(queryMany).mockResolvedValue([] as any)
    const res = await GET(makeGetReq('?view=batch_valuation&search=bolt'))
    expect(res.status).toBe(200)
    const call = vi.mocked(queryMany).mock.calls[0]
    expect(call[1]).toContain('%bolt%')
  })

  it('applies stock_status=expired filter', async () => {
    mockAuth.mockResolvedValue(ADMIN as any)
    mockHasScope.mockReturnValue(true)
    vi.mocked(queryMany).mockResolvedValue([] as any)
    const res = await GET(makeGetReq('?view=batch_valuation&stock_status=expired'))
    expect(res.status).toBe(200)
    const sql = vi.mocked(queryMany).mock.calls[0][0] as string
    expect(sql).toContain('expiry_date < CURRENT_DATE')
  })

  it('applies stock_status=expiring_soon filter', async () => {
    mockAuth.mockResolvedValue(ADMIN as any)
    mockHasScope.mockReturnValue(true)
    vi.mocked(queryMany).mockResolvedValue([] as any)
    const res = await GET(makeGetReq('?view=batch_valuation&stock_status=expiring_soon'))
    expect(res.status).toBe(200)
    const sql = vi.mocked(queryMany).mock.calls[0][0] as string
    expect(sql).toContain('expiry_date BETWEEN')
  })

  it('returns empty batches array when queryMany returns null', async () => {
    mockAuth.mockResolvedValue(ADMIN as any)
    mockHasScope.mockReturnValue(true)
    vi.mocked(queryMany).mockResolvedValue(null as any)
    const res = await GET(makeGetReq('?view=batch_valuation'))
    expect(res.status).toBe(200)
    expect((await res.json()).batches).toEqual([])
  })
})

// ── PATCH tests ───────────────────────────────────────────────────────────────

describe('PATCH /api/admin/inventory/stock', () => {
  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null as any)
    const res = await PATCH(makePatchReq({ product_id: PRODUCT_UUID, new_quantity: 10 }))
    expect(res.status).toBe(401)
  })

  it('returns 403 when scope missing', async () => {
    mockAuth.mockResolvedValue(ADMIN as any)
    mockHasScope.mockReturnValue(false)
    const res = await PATCH(makePatchReq({ product_id: PRODUCT_UUID, new_quantity: 10 }))
    expect(res.status).toBe(403)
  })

  it('returns 400 for invalid JSON body', async () => {
    mockAuth.mockResolvedValue(ADMIN as any)
    mockHasScope.mockReturnValue(true)
    const req = new NextRequest('http://localhost/api/admin/inventory/stock', {
      method: 'PATCH',
      body: 'not-json',
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await PATCH(req)
    expect(res.status).toBe(400)
  })

  it('returns 400 when schema validation fails (no new_quantity or unit_id)', async () => {
    mockAuth.mockResolvedValue(ADMIN as any)
    mockHasScope.mockReturnValue(true)
    // product_id valid UUID but no new_quantity and no unit_id — fails refine
    const res = await PATCH(makePatchReq({ product_id: PRODUCT_UUID }))
    expect(res.status).toBe(400)
  })

  it('adjusts product-level stock on happy path (new_quantity)', async () => {
    mockAuth.mockResolvedValue(ADMIN as any)
    mockHasScope.mockReturnValue(true)
    const client = makeDbClient([
      { rows: [] },                              // BEGIN
      { rows: [{ inventory_quantity: 5 }] },     // SELECT products
      { rows: [] },                              // UPDATE products
      { rows: [] },                              // COMMIT
    ])
    mockGetClient.mockResolvedValue(client as any)
    mockQueryOne.mockResolvedValue({ name: 'Test Bolt' } as any)

    const res = await PATCH(makePatchReq({ product_id: PRODUCT_UUID, new_quantity: 20 }))
    expect(res.status).toBe(200)
    expect((await res.json()).success).toBe(true)
    expect(mockLogStockMovement).toHaveBeenCalled()
  })

  it('adjusts variant-level stock when variant_id supplied', async () => {
    mockAuth.mockResolvedValue(ADMIN as any)
    mockHasScope.mockReturnValue(true)
    const client = makeDbClient([
      { rows: [] },                              // BEGIN
      { rows: [{ inventory_quantity: 3 }] },     // SELECT product_variants
      { rows: [] },                              // UPDATE product_variants
      { rows: [] },                              // COMMIT
    ])
    mockGetClient.mockResolvedValue(client as any)
    mockQueryOne.mockResolvedValue({ name: 'Bolt Variant' } as any)

    const res = await PATCH(makePatchReq({
      product_id: PRODUCT_UUID,
      variant_id: VARIANT_UUID,
      new_quantity: 15,
    }))
    expect(res.status).toBe(200)
    expect((await res.json()).success).toBe(true)
  })

  it('adjusts sub-variant-level stock when sub_variant_id supplied', async () => {
    mockAuth.mockResolvedValue(ADMIN as any)
    mockHasScope.mockReturnValue(true)
    const client = makeDbClient([
      { rows: [] },                              // BEGIN
      { rows: [{ inventory_quantity: 7 }] },     // SELECT product_sub_variants
      { rows: [] },                              // UPDATE product_sub_variants
      { rows: [] },                              // COMMIT
    ])
    mockGetClient.mockResolvedValue(client as any)
    mockQueryOne.mockResolvedValue({ name: 'Widget Sub' } as any)

    const res = await PATCH(makePatchReq({
      product_id: PRODUCT_UUID,
      variant_id: VARIANT_UUID,
      sub_variant_id: SUB_VARIANT_UUID,
      new_quantity: 50,
      notes: 'Stock count',
    }))
    expect(res.status).toBe(200)
    expect((await res.json()).success).toBe(true)
  })

  it('uses unit-aware path when unit_id and quantity_in_unit supplied', async () => {
    mockAuth.mockResolvedValue(ADMIN as any)
    mockHasScope.mockReturnValue(true)
    // queryOne for unit lookup
    mockQueryOne.mockResolvedValueOnce({
      id: UNIT_UUID, factor: '12', display_label: 'dozen', unit: 'dz', dimension: 'count',
    } as any)
    const client = makeDbClient([
      { rows: [] },                              // BEGIN
      { rows: [{ inventory_quantity: 24 }] },    // SELECT products
      { rows: [] },                              // UPDATE products
      { rows: [] },                              // COMMIT
    ])
    mockGetClient.mockResolvedValue(client as any)
    mockQueryOne.mockResolvedValueOnce({ name: 'Dozen Product' } as any)

    const res = await PATCH(makePatchReq({
      product_id: PRODUCT_UUID,
      unit_id: UNIT_UUID,
      quantity_in_unit: 3,  // 3 dozen = 36 base units
    }))
    expect(res.status).toBe(200)
    expect((await res.json()).success).toBe(true)
    const logCall = mockLogStockMovement.mock.calls[0][1]
    expect(logCall.unitId).toBe(UNIT_UUID)
    expect(logCall.quantityInUnit).toBe(3)
  })

  it('returns 400 when unit_id not found in DB', async () => {
    mockAuth.mockResolvedValue(ADMIN as any)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValueOnce(null)  // unit not found

    const res = await PATCH(makePatchReq({
      product_id: PRODUCT_UUID,
      unit_id: UNIT_UUID,
      quantity_in_unit: 5,
    }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Unit not found')
  })

  it('returns 500 and rolls back when DB query throws', async () => {
    mockAuth.mockResolvedValue(ADMIN as any)
    mockHasScope.mockReturnValue(true)
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [] })           // BEGIN
        .mockRejectedValueOnce(new Error('Lock timeout')), // SELECT fails
      release: vi.fn(),
    }
    mockGetClient.mockResolvedValue(client as any)

    const res = await PATCH(makePatchReq({ product_id: PRODUCT_UUID, new_quantity: 10 }))
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('Lock timeout')
    // ROLLBACK was attempted
    const rbCall = client.query.mock.calls.find((c: any[]) => c[0] === 'ROLLBACK')
    expect(rbCall).toBeDefined()
    expect(client.release).toHaveBeenCalled()
  })

  it('does not propagate logAdminAudit errors', async () => {
    mockAuth.mockResolvedValue(ADMIN as any)
    mockHasScope.mockReturnValue(true)
    const client = makeDbClient([
      { rows: [] },
      { rows: [{ inventory_quantity: 5 }] },
      { rows: [] },
      { rows: [] },
    ])
    mockGetClient.mockResolvedValue(client as any)
    mockQueryOne.mockResolvedValue({ name: 'Product' } as any)
    mockLogAdminAudit.mockRejectedValue(new Error('Audit failure'))

    const res = await PATCH(makePatchReq({ product_id: PRODUCT_UUID, new_quantity: 10 }))
    // Audit errors are swallowed via .catch(() => {})
    expect(res.status).toBe(200)
  })

  it('assigns product to shelf when warehouse_id supplied and product is non-perishable/non-serialized', async () => {
    mockAuth.mockResolvedValue(ADMIN as any)
    mockHasScope.mockReturnValue(true)
    const client = makeDbClient([
      { rows: [] },                              // BEGIN
      { rows: [{ inventory_quantity: 5 }] },     // SELECT products
      { rows: [] },                              // UPDATE products
      { rows: [] },                              // COMMIT
    ])
    mockGetClient.mockResolvedValue(client as any)
    // Source calls queryOne in order: (1) warehouse+product row, (2) DELETE shelf_stock, (3) product name
    mockQueryOne
      .mockResolvedValueOnce({ code: 'WH01', perishable: false, serialized: false } as any)
      .mockResolvedValueOnce(undefined as any)
      .mockResolvedValueOnce({ name: 'Test Bolt' } as any)

    const res = await PATCH(makePatchReq({
      product_id: PRODUCT_UUID,
      new_quantity: 20,
      warehouse_id: '00000000-0000-4000-8000-000000000010',
    }))
    expect(res.status).toBe(200)
    expect(mockGetOrCreateOpenShelf).toHaveBeenCalled()
    expect(mockUpsertShelfStock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ productId: PRODUCT_UUID, quantity: 20, mode: 'set' })
    )
  })

  it('skips shelf assignment when product is perishable', async () => {
    mockAuth.mockResolvedValue(ADMIN as any)
    mockHasScope.mockReturnValue(true)
    const client = makeDbClient([
      { rows: [] },
      { rows: [{ inventory_quantity: 5 }] },
      { rows: [] },
      { rows: [] },
    ])
    mockGetClient.mockResolvedValue(client as any)
    // Source calls: (1) warehouse+product row (perishable=true), (2) product name
    mockQueryOne
      .mockResolvedValueOnce({ code: 'WH01', perishable: true, serialized: false } as any)
      .mockResolvedValueOnce({ name: 'Perishable Product' } as any)

    const res = await PATCH(makePatchReq({
      product_id: PRODUCT_UUID,
      new_quantity: 10,
      warehouse_id: '00000000-0000-4000-8000-000000000010',
    }))
    expect(res.status).toBe(200)
    expect(mockUpsertShelfStock).not.toHaveBeenCalled()
  })

  it('uses explicit location_id when supplied with warehouse_id', async () => {
    mockAuth.mockResolvedValue(ADMIN as any)
    mockHasScope.mockReturnValue(true)
    const client = makeDbClient([
      { rows: [] },
      { rows: [{ inventory_quantity: 5 }] },
      { rows: [] },
      { rows: [] },
    ])
    mockGetClient.mockResolvedValue(client as any)
    // Source calls: (1) warehouse+product row, (2) DELETE shelf_stock, (3) product name
    mockQueryOne
      .mockResolvedValueOnce({ code: 'WH01', perishable: false, serialized: false } as any)
      .mockResolvedValueOnce(undefined as any)
      .mockResolvedValueOnce({ name: 'Test Product' } as any)

    const res = await PATCH(makePatchReq({
      product_id: PRODUCT_UUID,
      new_quantity: 15,
      warehouse_id: '00000000-0000-4000-8000-000000000010',
      location_id: '00000000-0000-4000-8000-000000000020',
    }))
    expect(res.status).toBe(200)
    // explicit location_id — should NOT call getOrCreateOpenShelf
    expect(mockGetOrCreateOpenShelf).not.toHaveBeenCalled()
    expect(mockUpsertShelfStock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ locationId: '00000000-0000-4000-8000-000000000020' })
    )
  })
})
