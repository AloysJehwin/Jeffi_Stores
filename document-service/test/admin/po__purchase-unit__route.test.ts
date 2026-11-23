import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from '../../src/next.js'

vi.mock('@jeffi/tenancy', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
  withTransaction: vi.fn(),
  getClient: vi.fn(),
}))

import { GET } from '../../src/admin/po/purchase-unit.js'
import { queryOne } from '@jeffi/tenancy'

const mockQueryOne = vi.mocked(queryOne)

const PRODUCT = '55555555-5555-4555-8555-555555555555'
const SUPPLIER = '66666666-6666-4666-8666-666666666666'
const adminClaims = { internal: true, adminId: 'a1', tenantId: 't1', role: 'administrator', scopes: [] }
const noScopeClaims = { internal: true, adminId: 'a1', tenantId: 't1', role: 'staff', scopes: [] }

function makeReq(qs = '', claims?: any) {
  const req = new NextRequest(`http://localhost/api/admin/po/purchase-unit${qs}`)
  if (claims) req.claims = claims
  return req
}

beforeEach(() => vi.clearAllMocks())

describe('GET po/purchase-unit', () => {
  it('401 when unauthenticated', async () => {
    expect((await GET(makeReq())).status).toBe(401)
  })
  it('403 when scope missing', async () => {
    expect((await GET(makeReq('', noScopeClaims))).status).toBe(403)
  })
  it('returns nulls when product_id missing', async () => {
    const res = await GET(makeReq('', adminClaims))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ conversion: null, baseUnit: null })
    expect(mockQueryOne).not.toHaveBeenCalled()
  })
  it('returns baseUnit and null conversion when no supplier', async () => {
    mockQueryOne.mockResolvedValueOnce({ unit: 'kg', display_label: 'Kilogram', dimension: 'weight' } as any)
    const res = await GET(makeReq(`?product_id=${PRODUCT}`, adminClaims))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.baseUnit).toEqual({ unit: 'kg', label: 'Kilogram', dimension: 'weight' })
    expect(body.conversion).toBeNull()
  })
  it('null baseUnit when product_units has no row', async () => {
    mockQueryOne.mockResolvedValueOnce(null)
    const res = await GET(makeReq(`?product_id=${PRODUCT}`, adminClaims))
    expect(res.status).toBe(200)
    expect((await res.json()).baseUnit).toBeNull()
  })
  it('returns conversion when supplier_id resolves a product_suppliers row', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ unit: 'ea', display_label: null, dimension: 'count' } as any) // baseRow
      .mockResolvedValueOnce({ purchase_unit: 'box', purchase_unit_factor: '12' } as any) // conversion
    const res = await GET(makeReq(`?product_id=${PRODUCT}&supplier_id=${SUPPLIER}`, adminClaims))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.baseUnit).toEqual({ unit: 'ea', label: 'ea', dimension: 'count' })
    expect(body.conversion).toEqual({ purchase_unit: 'box', purchase_unit_factor: 12 })
  })
  it('null conversion when supplier_id has no matching row', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ unit: 'ea', display_label: 'Each', dimension: 'count' } as any)
      .mockResolvedValueOnce(null) // no conversion
    const res = await GET(makeReq(`?product_id=${PRODUCT}&supplier_id=${SUPPLIER}`, adminClaims))
    expect(res.status).toBe(200)
    expect((await res.json()).conversion).toBeNull()
  })
  it('500 when a query throws', async () => {
    mockQueryOne.mockRejectedValue(new Error('DB down'))
    const res = await GET(makeReq(`?product_id=${PRODUCT}`, adminClaims))
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('DB down')
  })
})
