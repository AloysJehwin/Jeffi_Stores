import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/scopes', () => ({ hasScope: vi.fn().mockReturnValue(true) }))

const mockQueryOne = vi.fn()
const mockQueryMany = vi.fn()
const mockWithTransaction = vi.fn()
vi.mock('@/lib/db', () => ({
  queryOne: (...a: any[]) => mockQueryOne(...a),
  queryMany: (...a: any[]) => mockQueryMany(...a),
  withTransaction: (...a: any[]) => mockWithTransaction(...a),
}))

import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { GET, POST } from '@/app/api/admin/products/[id]/suppliers/route'
import { PATCH, DELETE } from '@/app/api/admin/products/[id]/suppliers/[psId]/route'

const admin = { id: 'a1', role: 'super_admin', scopes: [] }

function req(method: string, body?: unknown) {
  return new NextRequest('http://localhost/api', {
    method,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    headers: { 'Content-Type': 'application/json' },
  })
}
// raw request to force JSON parse failure
function badReq(method: string) {
  return new NextRequest('http://localhost/api', {
    method,
    body: 'not-json{',
    headers: { 'Content-Type': 'application/json' },
  })
}

const listParams = Promise.resolve({ id: 'prod-1' })
const editParams = Promise.resolve({ id: 'prod-1', psId: 'ps-1' })

describe('GET /api/admin/products/[id]/suppliers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateAdmin).mockResolvedValue(admin as any)
    vi.mocked(hasScope).mockReturnValue(true)
  })

  it('401 unauthenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    const res = await GET(req('GET'), { params: listParams })
    expect(res.status).toBe(401)
  })

  it('403 insufficient scope', async () => {
    vi.mocked(hasScope).mockReturnValue(false)
    const res = await GET(req('GET'), { params: listParams })
    expect(res.status).toBe(403)
  })

  it('404 product not found', async () => {
    mockQueryOne.mockResolvedValueOnce(null)
    const res = await GET(req('GET'), { params: listParams })
    expect(res.status).toBe(404)
  })

  it('returns suppliers sorted by cost and bestByLeaf', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'prod-1' }) // ensureProduct
    mockQueryMany.mockResolvedValueOnce([
      { id: 's2', supplier_id: 'sup-b', unit_cost: '50', variant_id: null, sub_variant_id: null },
      { id: 's1', supplier_id: 'sup-a', unit_cost: '10', variant_id: 'v1', sub_variant_id: null },
      { id: 's3', supplier_id: 'sup-c', unit_cost: '30', variant_id: 'v1', sub_variant_id: null },
    ])
    const res = await GET(req('GET'), { params: listParams })
    const data = await res.json()
    expect(res.status).toBe(200)
    // sorted asc: 10, 30, 50
    expect(data.suppliers.map((s: any) => s.unit_cost)).toEqual(['10', '30', '50'])
    // leaf v1:NIL -> cheapest supplier sup-a; leaf NIL:NIL -> sup-b
    expect(data.bestByLeaf['v1:00000000-0000-0000-0000-000000000000']).toBe('sup-a')
    expect(data.bestByLeaf['00000000-0000-0000-0000-000000000000:00000000-0000-0000-0000-000000000000']).toBe('sup-b')
  })
})

describe('POST /api/admin/products/[id]/suppliers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateAdmin).mockResolvedValue(admin as any)
    vi.mocked(hasScope).mockReturnValue(true)
    mockWithTransaction.mockImplementation(async (fn: any) =>
      fn({ query: vi.fn().mockResolvedValue({ rows: [{ id: 'new-ps' }] }) })
    )
  })

  it('401 unauthenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    const res = await POST(req('POST', { supplier_id: 'x', unit_cost: 1 }), { params: listParams })
    expect(res.status).toBe(401)
  })

  it('403 insufficient scope', async () => {
    vi.mocked(hasScope).mockReturnValue(false)
    const res = await POST(req('POST', { supplier_id: 'x', unit_cost: 1 }), { params: listParams })
    expect(res.status).toBe(403)
  })

  it('400 invalid JSON', async () => {
    const res = await POST(badReq('POST'), { params: listParams })
    expect(res.status).toBe(400)
  })

  it('400 missing supplier_id', async () => {
    const res = await POST(req('POST', { unit_cost: 5 }), { params: listParams })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/supplier_id/)
  })

  it('400 both variant and sub_variant set', async () => {
    const res = await POST(req('POST', { supplier_id: 's', unit_cost: 5, variant_id: 'v', sub_variant_id: 'sv' }), {
      params: listParams,
    })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/one leaf/)
  })

  it('400 negative unit_cost', async () => {
    const res = await POST(req('POST', { supplier_id: 's', unit_cost: -1 }), { params: listParams })
    expect(res.status).toBe(400)
  })

  it('400 non-finite unit_cost', async () => {
    const res = await POST(req('POST', { supplier_id: 's', unit_cost: 'abc' }), { params: listParams })
    expect(res.status).toBe(400)
  })

  it('404 product not found', async () => {
    mockQueryOne.mockResolvedValueOnce(null)
    const res = await POST(req('POST', { supplier_id: 's', unit_cost: 5 }), { params: listParams })
    expect(res.status).toBe(404)
  })

  it('creates supplier with defaults (not preferred)', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'prod-1' })
    const res = await POST(req('POST', { supplier_id: 's', unit_cost: 5 }), { params: listParams })
    const data = await res.json()
    expect(res.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.id).toBe('new-ps')
  })

  it('creates preferred supplier with all optional fields', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'prod-1' })
    const res = await POST(
      req('POST', {
        supplier_id: 's',
        unit_cost: 5,
        is_preferred: true,
        currency: 'USDX',
        gst_inclusive: true,
        moq: 10,
        lead_time_days: 3,
        notes: 'hello',
        variant_id: 'v1',
      }),
      { params: listParams }
    )
    const data = await res.json()
    expect(res.status).toBe(200)
    expect(data.success).toBe(true)
  })

  it('handles invalid moq / lead_time_days as null', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'prod-1' })
    const res = await POST(
      req('POST', {
        supplier_id: 's',
        unit_cost: 5,
        moq: 'abc',
        lead_time_days: 1.5,
      }),
      { params: listParams }
    )
    expect(res.status).toBe(200)
  })

  it('500 when transaction throws', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'prod-1' })
    mockWithTransaction.mockRejectedValueOnce(new Error('boom'))
    const res = await POST(req('POST', { supplier_id: 's', unit_cost: 5 }), { params: listParams })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('boom')
  })

  it('500 with fallback message when error has no message', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'prod-1' })
    mockWithTransaction.mockRejectedValueOnce({})
    const res = await POST(req('POST', { supplier_id: 's', unit_cost: 5 }), { params: listParams })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/Failed to add supplier/)
  })
})

describe('PATCH /api/admin/products/[id]/suppliers/[psId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateAdmin).mockResolvedValue(admin as any)
    vi.mocked(hasScope).mockReturnValue(true)
  })

  const existing = {
    id: 'ps-1',
    product_id: 'prod-1',
    supplier_id: 'sup-1',
    unit_cost: '20',
    currency: 'INR',
    gst_inclusive: false,
    moq: 5,
    lead_time_days: 2,
    notes: 'x',
    is_preferred: false,
    variant_id: null,
    sub_variant_id: null,
    is_active: true,
  }

  it('401 unauthenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    const res = await PATCH(req('PATCH', {}), { params: editParams })
    expect(res.status).toBe(401)
  })

  it('403 insufficient scope', async () => {
    vi.mocked(hasScope).mockReturnValue(false)
    const res = await PATCH(req('PATCH', {}), { params: editParams })
    expect(res.status).toBe(403)
  })

  it('400 invalid JSON', async () => {
    const res = await PATCH(badReq('PATCH'), { params: editParams })
    expect(res.status).toBe(400)
  })

  it('404 when link not found', async () => {
    mockQueryOne.mockResolvedValueOnce(null)
    const res = await PATCH(req('PATCH', { unit_cost: 5 }), { params: editParams })
    expect(res.status).toBe(404)
  })

  it('400 negative newCost', async () => {
    mockQueryOne.mockResolvedValueOnce(existing)
    const res = await PATCH(req('PATCH', { unit_cost: -3 }), { params: editParams })
    expect(res.status).toBe(400)
  })

  it('metadata-only update in place (no price change, not preferred)', async () => {
    mockQueryOne.mockResolvedValueOnce(existing)
    const clientQuery = vi.fn().mockResolvedValue({ rows: [] })
    mockWithTransaction.mockImplementationOnce(async (fn: any) => fn({ query: clientQuery }))
    const res = await PATCH(req('PATCH', { notes: 'updated', gst_inclusive: true }), { params: editParams })
    const data = await res.json()
    expect(res.status).toBe(200)
    expect(data.newRow).toBe(false)
    expect(data.id).toBe('ps-1')
  })

  it('price change inserts new dated row', async () => {
    mockQueryOne.mockResolvedValueOnce(existing)
    const clientQuery = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] }) // deactivate old
      .mockResolvedValueOnce({ rows: [{ id: 'ps-new' }] }) // insert
    mockWithTransaction.mockImplementationOnce(async (fn: any) => fn({ query: clientQuery }))
    const res = await PATCH(req('PATCH', { unit_cost: 99 }), { params: editParams })
    const data = await res.json()
    expect(res.status).toBe(200)
    expect(data.newRow).toBe(true)
    expect(data.id).toBe('ps-new')
  })

  it('preferred toggle clears siblings then updates in place', async () => {
    mockQueryOne.mockResolvedValueOnce({ ...existing, variant_id: 'v1' })
    const clientQuery = vi.fn().mockResolvedValue({ rows: [] })
    mockWithTransaction.mockImplementationOnce(async (fn: any) => fn({ query: clientQuery }))
    const res = await PATCH(req('PATCH', { is_preferred: true, moq: 7 }), { params: editParams })
    expect(res.status).toBe(200)
    // first client.query is the clear-preferred update
    expect(clientQuery.mock.calls[0][0]).toMatch(/is_preferred = false/)
  })

  it('handles moq null / lead_time invalid branches', async () => {
    mockQueryOne.mockResolvedValueOnce(existing)
    const clientQuery = vi.fn().mockResolvedValue({ rows: [] })
    mockWithTransaction.mockImplementationOnce(async (fn: any) => fn({ query: clientQuery }))
    const res = await PATCH(req('PATCH', { moq: 'nope', lead_time_days: 2.5, notes: '', currency: 'EURX' }), {
      params: editParams,
    })
    expect(res.status).toBe(200)
  })

  it('500 when transaction throws', async () => {
    mockQueryOne.mockResolvedValueOnce(existing)
    mockWithTransaction.mockRejectedValueOnce(new Error('tx fail'))
    const res = await PATCH(req('PATCH', { notes: 'a' }), { params: editParams })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('tx fail')
  })

  it('500 fallback message', async () => {
    mockQueryOne.mockResolvedValueOnce(existing)
    mockWithTransaction.mockRejectedValueOnce({})
    const res = await PATCH(req('PATCH', { notes: 'a' }), { params: editParams })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/Failed to update supplier/)
  })
})

describe('DELETE /api/admin/products/[id]/suppliers/[psId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateAdmin).mockResolvedValue(admin as any)
    vi.mocked(hasScope).mockReturnValue(true)
  })

  it('401 unauthenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    const res = await DELETE(req('DELETE'), { params: editParams })
    expect(res.status).toBe(401)
  })

  it('403 insufficient scope', async () => {
    vi.mocked(hasScope).mockReturnValue(false)
    const res = await DELETE(req('DELETE'), { params: editParams })
    expect(res.status).toBe(403)
  })

  it('404 when nothing soft-deleted', async () => {
    mockQueryOne.mockResolvedValueOnce(null)
    const res = await DELETE(req('DELETE'), { params: editParams })
    expect(res.status).toBe(404)
  })

  it('soft-deletes successfully', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'ps-1' })
    const res = await DELETE(req('DELETE'), { params: editParams })
    const data = await res.json()
    expect(res.status).toBe(200)
    expect(data.success).toBe(true)
  })
})
