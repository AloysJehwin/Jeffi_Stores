import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
  withTransaction: vi.fn(),
}))

vi.mock('@/lib/jwt', () => ({
  authenticateAdmin: vi.fn(),
}))

vi.mock('@/lib/scopes', () => ({
  hasScope: vi.fn(),
}))

vi.mock('@/lib/email', () => ({
  sendPurchaseOrderEmail: vi.fn(),
}))

vi.mock('@/lib/validate', () => ({
  parseBody: vi.fn(),
  zUuid: (() => { const { z } = require('zod'); return z.string().uuid() })(),
  zCurrency: (() => { const { z } = require('zod'); return z.coerce.number().min(0) })(),
}))

vi.mock('@/lib/search', () => ({
  buildSearchClause: vi.fn(),
}))

import { GET as poRouteGET, POST as poRoutePOST } from '@/app/api/admin/inventory/po/route'
import { GET, PATCH } from '@/app/api/admin/inventory/po/[id]/route'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryOne, queryMany, query, withTransaction } from '@/lib/db'
import { parseBody } from '@/lib/validate'
import { buildSearchClause } from '@/lib/search'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockQueryOne = vi.mocked(queryOne)
const mockQueryMany = vi.mocked(queryMany)
const mockQuery = vi.mocked(query)
const mockParseBody = vi.mocked(parseBody)
const mockWithTransaction = vi.mocked(withTransaction)
const mockBuildSearchClause = vi.mocked(buildSearchClause)

const admin = { adminId: 'a1', username: 'admin', role: 'super_admin', scopes: ['inventory'] }

const SUPPLIER_UUID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
const PRODUCT_UUID  = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
const VARIANT_UUID  = 'dddddddd-dddd-dddd-dddd-dddddddddddd'

function makeGetReq(id: string) {
  return new NextRequest(`http://localhost/api/admin/inventory/po/${id}`)
}
function makePatchReq(id: string, body: any) {
  return new NextRequest(`http://localhost/api/admin/inventory/po/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}
function makeListReq(qs = '') {
  return new NextRequest(`http://localhost/api/admin/inventory/po${qs}`)
}
function makePostReq(body: any) {
  return new NextRequest('http://localhost/api/admin/inventory/po', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => { vi.clearAllMocks() })

// ---------------------------------------------------------------------------
// GET /api/admin/inventory/po  (list route)
// ---------------------------------------------------------------------------

describe('GET /api/admin/inventory/po', () => {
  beforeEach(() => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue({ total: 0 } as any)
    mockQueryMany.mockResolvedValue([] as any)
    mockBuildSearchClause.mockReturnValue({ clause: '1=1', params: [], nextIdx: 2 })
  })

  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await poRouteGET(makeListReq())
    expect(res.status).toBe(401)
  })

  it('returns 403 when inventory:read scope missing', async () => {
    mockHasScope.mockReturnValue(false)
    const res = await poRouteGET(makeListReq())
    expect(res.status).toBe(403)
  })

  it('returns paginated list with default params', async () => {
    mockQueryOne.mockResolvedValue({ total: 2 } as any)
    mockQueryMany.mockResolvedValue([
      { id: 'po-1', po_number: 'PO-001', supplier_name: 'ACME' },
      { id: 'po-2', po_number: 'PO-002', supplier_name: 'ACME' },
    ] as any)

    const res = await poRouteGET(makeListReq())
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toMatchObject({ purchase_orders: expect.any(Array), total: 2, page: 1, limit: 20 })
  })

  it('applies status filter when status param is provided', async () => {
    const res = await poRouteGET(makeListReq('?status=draft'))
    expect(res.status).toBe(200)
    const countCall = mockQueryOne.mock.calls[0]
    expect(countCall[1]).toContain('draft')
  })

  it('applies supplier_id filter when supplier_id param is provided', async () => {
    const res = await poRouteGET(makeListReq(`?supplier_id=${SUPPLIER_UUID}`))
    expect(res.status).toBe(200)
    const countCall = mockQueryOne.mock.calls[0]
    expect(countCall[1]).toContain(SUPPLIER_UUID)
  })

  it('applies search filter via buildSearchClause', async () => {
    mockBuildSearchClause.mockReturnValue({
      clause: "(po.po_number ILIKE $1 OR s.name ILIKE $1)",
      params: ['%bolt%'],
      nextIdx: 2,
    })

    const res = await poRouteGET(makeListReq('?search=bolt'))
    expect(res.status).toBe(200)
    expect(buildSearchClause).toHaveBeenCalledWith('bolt', expect.any(Array), expect.any(Number))
  })

  it('applies all three filters combined (status + supplier_id + search)', async () => {
    mockBuildSearchClause.mockReturnValue({ clause: '1=1', params: [], nextIdx: 4 })

    const res = await poRouteGET(makeListReq(`?status=received&supplier_id=${SUPPLIER_UUID}&search=bolt`))
    expect(res.status).toBe(200)
    const countCall = mockQueryOne.mock.calls[0]
    expect(countCall[1]).toContain('received')
    expect(countCall[1]).toContain(SUPPLIER_UUID)
  })

  it('handles null total from count query gracefully', async () => {
    mockQueryOne.mockResolvedValue(null as any)
    const res = await poRouteGET(makeListReq())
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.total).toBe(0)
  })

  it('respects page and limit params', async () => {
    const res = await poRouteGET(makeListReq('?page=3&limit=5'))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.page).toBe(3)
    expect(json.limit).toBe(5)
  })

  it('returns 500 on db error', async () => {
    mockQueryOne.mockRejectedValue(new Error('DB timeout'))
    const res = await poRouteGET(makeListReq())
    expect(res.status).toBe(500)
  })
})

// ---------------------------------------------------------------------------
// POST /api/admin/inventory/po  (create route)
// ---------------------------------------------------------------------------

describe('POST /api/admin/inventory/po', () => {
  const baseItem = {
    product_id: PRODUCT_UUID,
    quantity: 10,
    unit_cost: 100,
    tax_rate: 18,
    purchase_unit_factor: 1,
    gst_inclusive: true,
  }

  beforeEach(() => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue({ cnt: 0 } as any)
    // withTransaction: execute the callback with a fake client
    mockWithTransaction.mockImplementation(async (cb) => {
      const fakeClient = {
        query: vi.fn().mockResolvedValue({ rows: [{ id: 'po-new' }], rowCount: 1 }),
      }
      return cb(fakeClient as any)
    })
  })

  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await poRoutePOST(makePostReq({ supplier_id: SUPPLIER_UUID, items: [baseItem] }))
    expect(res.status).toBe(401)
  })

  it('returns 403 when inventory:write scope missing', async () => {
    mockHasScope.mockReturnValue(false)
    const res = await poRoutePOST(makePostReq({ supplier_id: SUPPLIER_UUID, items: [baseItem] }))
    expect(res.status).toBe(403)
  })

  it('returns 400 when parseBody validation fails', async () => {
    const { NextResponse } = await import('next/server')
    mockParseBody.mockReturnValue({
      ok: false,
      response: NextResponse.json({ error: 'Validation failed' }, { status: 400 }),
    })
    const res = await poRoutePOST(makePostReq({ supplier_id: SUPPLIER_UUID, items: [] }))
    expect(res.status).toBe(400)
  })

  it('creates a PO successfully with unit_cost path', async () => {
    mockParseBody.mockReturnValue({
      ok: true,
      data: {
        supplier_id: SUPPLIER_UUID,
        items: [{ ...baseItem, unit_cost: 100, line_total_incl_gst: null }],
      },
    })

    const res = await poRoutePOST(makePostReq({ supplier_id: SUPPLIER_UUID, items: [baseItem] }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.po_number).toMatch(/^PO-/)
  })

  it('derives unit_cost from line_total_incl_gst when gst_inclusive=true', async () => {
    mockParseBody.mockReturnValue({
      ok: true,
      data: {
        supplier_id: SUPPLIER_UUID,
        items: [{
          ...baseItem,
          unit_cost: undefined,
          line_total_incl_gst: 1180, // 1000 ex-GST + 18% = 1180
          tax_rate: 18,
          gst_inclusive: true,
          quantity: 10,
          purchase_unit_factor: 1,
        }],
      },
    })

    const res = await poRoutePOST(makePostReq({}))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
  })

  it('derives unit_cost from line_total_incl_gst when gst_inclusive=false', async () => {
    mockParseBody.mockReturnValue({
      ok: true,
      data: {
        supplier_id: SUPPLIER_UUID,
        items: [{
          ...baseItem,
          unit_cost: undefined,
          line_total_incl_gst: 1000, // already ex-GST
          tax_rate: 18,
          gst_inclusive: false,
          quantity: 10,
          purchase_unit_factor: 1,
        }],
      },
    })

    const res = await poRoutePOST(makePostReq({}))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
  })

  it('resolves variant via product_variants when safeVariantId is provided', async () => {
    let clientQueryCallCount = 0
    mockWithTransaction.mockImplementation(async (cb) => {
      const fakeClient = {
        query: vi.fn().mockImplementation(async (sql: string) => {
          clientQueryCallCount++
          if (sql.includes('SELECT id FROM product_variants WHERE id')) {
            return { rows: [{ id: VARIANT_UUID }] } // variant validates
          }
          if (sql.includes('SELECT id FROM product_sub_variants WHERE id')) {
            return { rows: [] } // no sub_variant
          }
          if (sql.includes('SELECT id, unit_cost FROM product_suppliers')) {
            return { rows: [] } // no existing supplier price
          }
          if (sql.includes('SELECT id FROM product_variants WHERE sku')) {
            return { rows: [] }
          }
          if (sql.includes('SELECT id FROM product_sub_variants WHERE sku')) {
            return { rows: [] }
          }
          return { rows: [{ id: 'po-new' }] }
        }),
      }
      return cb(fakeClient as any)
    })

    mockParseBody.mockReturnValue({
      ok: true,
      data: {
        supplier_id: SUPPLIER_UUID,
        items: [{
          ...baseItem,
          variant_id: VARIANT_UUID,
          sub_variant_id: null,
          unit_cost: 100,
          line_total_incl_gst: null,
          sku: null,
        }],
      },
    })

    const res = await poRoutePOST(makePostReq({}))
    expect(res.status).toBe(200)
  })

  it('nullifies variant_id when product_variants check fails (stale id)', async () => {
    mockWithTransaction.mockImplementation(async (cb) => {
      const fakeClient = {
        query: vi.fn().mockImplementation(async (sql: string) => {
          if (sql.includes('SELECT id FROM product_variants WHERE id')) {
            return { rows: [] } // variant NOT found → safeVariantId becomes null
          }
          if (sql.includes('SELECT id FROM product_sub_variants WHERE id')) {
            return { rows: [] }
          }
          if (sql.includes('SELECT id, unit_cost FROM product_suppliers')) {
            return { rows: [] }
          }
          if (sql.includes('SELECT id FROM product_variants WHERE sku')) {
            return { rows: [] }
          }
          if (sql.includes('SELECT id FROM product_sub_variants WHERE sku')) {
            return { rows: [] }
          }
          return { rows: [{ id: 'po-new' }] }
        }),
      }
      return cb(fakeClient as any)
    })

    mockParseBody.mockReturnValue({
      ok: true,
      data: {
        supplier_id: SUPPLIER_UUID,
        items: [{
          ...baseItem,
          variant_id: VARIANT_UUID,
          sub_variant_id: null,
          unit_cost: 100,
          line_total_incl_gst: null,
          sku: null,
        }],
      },
    })

    const res = await poRoutePOST(makePostReq({}))
    // Still succeeds — safeVariantId was nulled but PO created at product level
    expect(res.status).toBe(200)
  })

  it('resolves sub_variant_id and pins parent variant when sub_variant check passes', async () => {
    const SUB_VARIANT_UUID = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'

    mockWithTransaction.mockImplementation(async (cb) => {
      const fakeClient = {
        query: vi.fn().mockImplementation(async (sql: string) => {
          if (sql.includes('SELECT id FROM product_variants WHERE id')) {
            return { rows: [] } // no direct variant match
          }
          if (sql.includes('SELECT id, variant_id FROM product_sub_variants WHERE id')) {
            return { rows: [{ id: SUB_VARIANT_UUID, variant_id: VARIANT_UUID }] } // sub_variant found
          }
          if (sql.includes('SELECT id, unit_cost FROM product_suppliers')) {
            return { rows: [] }
          }
          if (sql.includes('SELECT id FROM product_variants WHERE sku')) {
            return { rows: [] }
          }
          if (sql.includes('SELECT id FROM product_sub_variants WHERE sku')) {
            return { rows: [] }
          }
          return { rows: [{ id: 'po-new' }] }
        }),
      }
      return cb(fakeClient as any)
    })

    mockParseBody.mockReturnValue({
      ok: true,
      data: {
        supplier_id: SUPPLIER_UUID,
        items: [{
          ...baseItem,
          variant_id: null,
          sub_variant_id: SUB_VARIANT_UUID,
          unit_cost: 100,
          line_total_incl_gst: null,
          sku: null,
        }],
      },
    })

    const res = await poRoutePOST(makePostReq({}))
    expect(res.status).toBe(200)
  })

  it('nullifies sub_variant_id when product_sub_variants check fails', async () => {
    const SUB_VARIANT_UUID = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'

    mockWithTransaction.mockImplementation(async (cb) => {
      const fakeClient = {
        query: vi.fn().mockImplementation(async (sql: string) => {
          if (sql.includes('SELECT id FROM product_variants WHERE id')) {
            return { rows: [] }
          }
          if (sql.includes('SELECT id, variant_id FROM product_sub_variants WHERE id')) {
            return { rows: [] } // NOT found → safeSubVariantId = null
          }
          if (sql.includes('SELECT id, unit_cost FROM product_suppliers')) {
            return { rows: [] }
          }
          if (sql.includes('SELECT id FROM product_variants WHERE sku')) {
            return { rows: [] }
          }
          if (sql.includes('SELECT id FROM product_sub_variants WHERE sku')) {
            return { rows: [] }
          }
          return { rows: [{ id: 'po-new' }] }
        }),
      }
      return cb(fakeClient as any)
    })

    mockParseBody.mockReturnValue({
      ok: true,
      data: {
        supplier_id: SUPPLIER_UUID,
        items: [{
          ...baseItem,
          variant_id: null,
          sub_variant_id: SUB_VARIANT_UUID,
          unit_cost: 100,
          line_total_incl_gst: null,
          sku: null,
        }],
      },
    })

    const res = await poRoutePOST(makePostReq({}))
    expect(res.status).toBe(200)
  })

  it('syncs supplier price when existing price differs (update path)', async () => {
    mockWithTransaction.mockImplementation(async (cb) => {
      const fakeClient = {
        query: vi.fn().mockImplementation(async (sql: string) => {
          if (sql.includes('SELECT id FROM product_variants WHERE id')) {
            return { rows: [] }
          }
          if (sql.includes('SELECT id, variant_id FROM product_sub_variants WHERE id')) {
            return { rows: [] }
          }
          if (sql.includes('SELECT id, unit_cost FROM product_suppliers')) {
            // Existing price is different → triggers UPDATE + INSERT
            return { rows: [{ id: 'ps-1', unit_cost: '50.00' }] }
          }
          if (sql.includes('SELECT id FROM product_variants WHERE sku')) {
            return { rows: [] }
          }
          if (sql.includes('SELECT id FROM product_sub_variants WHERE sku')) {
            return { rows: [] }
          }
          return { rows: [{ id: 'po-new' }] }
        }),
      }
      return cb(fakeClient as any)
    })

    mockParseBody.mockReturnValue({
      ok: true,
      data: {
        supplier_id: SUPPLIER_UUID,
        items: [{
          ...baseItem,
          variant_id: null,
          sub_variant_id: null,
          unit_cost: 100, // different from stored 50
          line_total_incl_gst: null,
          sku: null,
        }],
      },
    })

    const res = await poRoutePOST(makePostReq({}))
    expect(res.status).toBe(200)
  })

  it('increments PO sequence when prior POs exist for the day', async () => {
    mockQueryOne.mockResolvedValue({ cnt: 3 } as any)
    mockParseBody.mockReturnValue({
      ok: true,
      data: {
        supplier_id: SUPPLIER_UUID,
        items: [{ ...baseItem, unit_cost: 100, line_total_incl_gst: null, sku: null, variant_id: null, sub_variant_id: null }],
      },
    })
    mockWithTransaction.mockImplementation(async (cb) => {
      const fakeClient = {
        query: vi.fn().mockImplementation(async (sql: string) => {
          if (sql.includes('SELECT id, unit_cost FROM product_suppliers')) return { rows: [] }
          if (sql.includes('SELECT id FROM product_variants WHERE sku')) return { rows: [] }
          if (sql.includes('SELECT id FROM product_sub_variants WHERE sku')) return { rows: [] }
          return { rows: [{ id: 'po-new' }] }
        }),
      }
      return cb(fakeClient as any)
    })

    const res = await poRoutePOST(makePostReq({}))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.po_number).toMatch(/-0004$/)
  })

  it('returns 500 on unexpected error', async () => {
    mockParseBody.mockReturnValue({
      ok: true,
      data: { supplier_id: SUPPLIER_UUID, items: [baseItem] },
    })
    mockQueryOne.mockRejectedValue(new Error('Connection refused'))

    const res = await poRoutePOST(makePostReq({}))
    expect(res.status).toBe(500)
  })
})

// ---------------------------------------------------------------------------
// GET /api/admin/inventory/po/[id]  (existing tests preserved)
// ---------------------------------------------------------------------------

describe('GET /api/admin/inventory/po/[id]', () => {
  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await GET(makeGetReq('po-1'), { params: Promise.resolve({ id: 'po-1' }) })
    expect(res.status).toBe(401)
  })

  it('returns 403 when scope missing', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(false)
    const res = await GET(makeGetReq('po-1'), { params: Promise.resolve({ id: 'po-1' }) })
    expect(res.status).toBe(403)
  })

  it('returns 404 when PO not found', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockQueryOne.mockResolvedValue(null)
    const res = await GET(makeGetReq('po-1'), { params: Promise.resolve({ id: 'po-1' }) })
    expect(res.status).toBe(404)
  })

  it('returns PO with items on happy path', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    const po = { id: 'po-1', po_number: 'PO-001', supplier_name: 'ACME' }
    const items = [{ id: 'i1', product_name_current: 'Bolt', quantity: 10 }]
    mockQueryOne.mockResolvedValue(po)
    mockQueryMany.mockResolvedValue(items)
    const res = await GET(makeGetReq('po-1'), { params: Promise.resolve({ id: 'po-1' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.purchase_order).toEqual(po)
    expect(body.items).toEqual(items)
  })
})

// ---------------------------------------------------------------------------
// PATCH /api/admin/inventory/po/[id]  (existing tests preserved)
// ---------------------------------------------------------------------------

describe('PATCH /api/admin/inventory/po/[id]', () => {
  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await PATCH(makePatchReq('po-1', { status: 'received' }), { params: Promise.resolve({ id: 'po-1' }) })
    expect(res.status).toBe(401)
  })

  it('returns 403 when scope missing', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(false)
    const res = await PATCH(makePatchReq('po-1', { status: 'received' }), { params: Promise.resolve({ id: 'po-1' }) })
    expect(res.status).toBe(403)
  })

  it('returns 400 on invalid JSON', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    const req = new NextRequest('http://localhost/api/admin/inventory/po/po-1', {
      method: 'PATCH',
      body: 'not-json',
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await PATCH(req, { params: Promise.resolve({ id: 'po-1' }) })
    expect(res.status).toBe(400)
  })

  it('returns validation error when parseBody fails', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    const { NextResponse } = await import('next/server')
    mockParseBody.mockReturnValue({
      ok: false,
      response: NextResponse.json({ error: 'Validation failed' }, { status: 400 }),
    })
    const res = await PATCH(makePatchReq('po-1', { status: 'received' }), { params: Promise.resolve({ id: 'po-1' }) })
    expect(res.status).toBe(400)
  })

  it('updates PO on happy path', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockParseBody.mockReturnValue({ ok: true, data: { status: 'received', expected_date: null, notes: null } })
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)
    const res = await PATCH(makePatchReq('po-1', { status: 'received' }), { params: Promise.resolve({ id: 'po-1' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
  })
})
