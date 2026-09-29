import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/scopes', () => ({ hasScope: vi.fn().mockReturnValue(true) }))

const mockQuery = vi.fn()
const mockQueryOne = vi.fn()
const mockQueryMany = vi.fn()
vi.mock('@/lib/db', () => ({
  query: (...a: any[]) => mockQuery(...a),
  queryOne: (...a: any[]) => mockQueryOne(...a),
  queryMany: (...a: any[]) => mockQueryMany(...a),
  withTransaction: vi.fn(),
}))

import { authenticateAdmin } from '@/lib/jwt'

// Products draft route
import {
  POST as prodDraftPost,
  PATCH as prodDraftPatch,
  DELETE as prodDraftDelete,
} from '@/app/api/admin/products/[id]/draft/route'

// Products draft sub-variants
import {
  GET as svGet,
  POST as svPost,
  DELETE as svDelete,
  PATCH as svPatch,
} from '@/app/api/admin/products/[id]/draft/sub-variants/route'

// Products draft units
import {
  GET as unitsGet,
  POST as unitsPost,
  DELETE as unitsDelete,
} from '@/app/api/admin/products/[id]/draft/units/route'

// Review forms draft
import {
  GET as rfGet,
  PATCH as rfPatch,
  POST as rfPublish,
  DELETE as rfDelete,
} from '@/app/api/admin/review-forms/[id]/draft/route'

const admin = { id: 'a1', role: 'super_admin', scopes: [] }

function req(method: string, body?: unknown, url = 'http://localhost/test') {
  return new NextRequest(url, {
    method,
    body: body ? JSON.stringify(body) : undefined,
    headers: { 'Content-Type': 'application/json' },
  })
}

function reqWithParams(method: string, searchParams: Record<string, string>, body?: unknown) {
  const url = new URL('http://localhost/test')
  Object.entries(searchParams).forEach(([k, v]) => url.searchParams.set(k, v))
  return new NextRequest(url.toString(), {
    method,
    body: body ? JSON.stringify(body) : undefined,
    headers: { 'Content-Type': 'application/json' },
  })
}

const idParams = Promise.resolve({ id: 'prod-1' })

describe('products draft route (POST/PATCH/DELETE)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateAdmin).mockResolvedValue(admin as any)
  })

  it('POST creates draft for active product', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'prod-1', name: 'P', sku: 'S' }) // product
    mockQueryOne.mockResolvedValueOnce(null) // no existing draft
    mockQuery.mockResolvedValueOnce({})
    const res = await prodDraftPost(req('POST'), { params: idParams })
    const data = await res.json()
    expect(data.success).toBe(true)
    expect(data.productId).toBe('prod-1')
    const sql = String(mockQuery.mock.calls[0][0])
    expect(sql).toContain("jsonb_build_object('sub_variant_type_on'")
    expect(sql).toContain("- 'inventory_quantity'")
    expect(sql).not.toContain('_seeded')
  })

  it('POST returns 409 when draft already exists', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'prod-1' })
    mockQueryOne.mockResolvedValueOnce({ product_id: 'prod-1' })
    const res = await prodDraftPost(req('POST'), { params: idParams })
    expect(res.status).toBe(409)
  })

  it('POST returns 404 for non-existent product', async () => {
    mockQueryOne.mockResolvedValueOnce(null)
    const res = await prodDraftPost(req('POST'), { params: idParams })
    expect(res.status).toBe(404)
  })

  it('PATCH autosaves fields', async () => {
    mockQueryOne.mockResolvedValueOnce({ product_id: 'prod-1' })
    // query() calls for images
    mockQuery.mockResolvedValue({ rows: [] })
    const res = await prodDraftPatch(req('PATCH', { fields: { name: 'New' } }), { params: idParams })
    expect(res.status).toBe(200)
  })

  it('PATCH returns 404 when no draft', async () => {
    mockQueryOne.mockResolvedValueOnce(null)
    const res = await prodDraftPatch(req('PATCH', { fields: {} }), { params: idParams })
    expect(res.status).toBe(404)
  })

  it('DELETE discards draft', async () => {
    mockQuery.mockResolvedValueOnce({})
    const res = await prodDraftDelete(req('DELETE'), { params: idParams })
    const data = await res.json()
    expect(data.success).toBe(true)
  })

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    const res = await prodDraftPost(req('POST'), { params: idParams })
    expect(res.status).toBe(401)
  })
})

describe('products draft sub-variants route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateAdmin).mockResolvedValue(admin as any)
  })

  it('GET returns sub-variants for variant', async () => {
    mockQueryOne.mockResolvedValueOnce({ sub_variants: [{ id: 'sv-1', variant_id: 'v-1', sub_variant_name: 'Red' }] })
    const r = reqWithParams('GET', { variant_id: 'v-1' })
    const res = await svGet(r, { params: idParams })
    const data = await res.json()
    expect(Array.isArray(data.sub_variants)).toBe(true)
  })

  it('GET falls back to live when no draft sub-variants', async () => {
    mockQueryOne.mockResolvedValueOnce({ sub_variants: [] })
    mockQueryMany.mockResolvedValueOnce([{ id: 'sv-live', sub_variant_name: 'Blue' }])
    const r = reqWithParams('GET', { variant_id: 'v-1' })
    const res = await svGet(r, { params: idParams })
    const data = await res.json()
    expect(data.sub_variants).toHaveLength(1)
  })

  it('POST adds sub-variant to draft', async () => {
    mockQueryOne.mockResolvedValueOnce({ sub_variants: [] })
    // Variant is untouched → ensureVariantSeeded reads the live sub-variant set
    // (complete-snapshot seeding). No live rows here, so nothing is seeded.
    mockQueryMany.mockResolvedValueOnce([])
    mockQuery.mockResolvedValueOnce({})
    const r = reqWithParams('POST', { variant_id: 'v-1' }, { sub_variant_name: 'Red', price: 100 })
    const res = await svPost(r, { params: idParams })
    const data = await res.json()
    expect(data.sub_variant).toBeDefined()
  })

  it('DELETE removes sub-variant from draft', async () => {
    mockQueryOne.mockResolvedValueOnce({ sub_variants: [{ id: 'sv-1', variant_id: 'v-1' }] })
    mockQuery.mockResolvedValueOnce({})
    const r = reqWithParams('DELETE', { variant_id: 'v-1' }, { id: 'sv-1' })
    const res = await svDelete(r, { params: idParams })
    const data = await res.json()
    expect(data.success).toBe(true)
  })

  it('PATCH updates sub-variant in draft', async () => {
    mockQueryOne.mockResolvedValueOnce({ sub_variants: [{ id: 'sv-1', variant_id: 'v-1', sub_variant_name: 'Old' }] })
    mockQuery.mockResolvedValueOnce({})
    const r = reqWithParams('PATCH', { variant_id: 'v-1' }, { id: 'sv-1', sub_variant_name: 'New' })
    const res = await svPatch(r, { params: idParams })
    expect(res.status).toBe(200)
  })
})

describe('products draft units route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateAdmin).mockResolvedValue(admin as any)
  })

  it('GET returns units for product scope', async () => {
    mockQueryOne.mockResolvedValueOnce({ units: [{ id: 'u-1', unit: 'pc', is_base: true, variant_id: null }] })
    const res = await unitsGet(req('GET'), { params: idParams })
    const data = await res.json()
    expect(Array.isArray(data.units)).toBe(true)
  })

  it('GET falls back to live when no draft units', async () => {
    mockQueryOne.mockResolvedValueOnce({ units: [] })
    mockQueryMany.mockResolvedValueOnce([{ unit: 'pc', is_base: true }])
    const res = await unitsGet(req('GET'), { params: idParams })
    const data = await res.json()
    expect(Array.isArray(data.units)).toBe(true)
  })

  it('POST adds unit to draft', async () => {
    // liveBaseUnit() runs first for the base-change guard; null = no live base, guard skipped.
    mockQueryOne.mockResolvedValueOnce(null)
    mockQueryOne.mockResolvedValueOnce({ units: [] })
    mockQuery.mockResolvedValueOnce({})
    const res = await unitsPost(req('POST', { unit: 'pc', factor: 1, is_base: true }), { params: idParams })
    const data = await res.json()
    expect(data.unit).toBeDefined()
  })

  it('DELETE removes unit from draft', async () => {
    mockQueryOne.mockResolvedValueOnce({ units: [{ id: 'u-1' }] })
    mockQuery.mockResolvedValueOnce({})
    const res = await unitsDelete(req('DELETE', { unitId: 'u-1' }), { params: idParams })
    const data = await res.json()
    expect(data.success).toBe(true)
  })
})

describe('review-forms draft route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateAdmin).mockResolvedValue(admin as any)
  })

  it('GET returns null when no draft', async () => {
    mockQueryOne.mockResolvedValueOnce(null)
    const res = await rfGet(req('GET'), { params: idParams })
    const data = await res.json()
    expect(data.draft_fields).toBeNull()
  })

  it('GET returns draft fields', async () => {
    mockQueryOne.mockResolvedValueOnce({ form_id: 'f-1', fields: { title: 'Review' } })
    const res = await rfGet(req('GET'), { params: idParams })
    const data = await res.json()
    expect(data.draft_fields).toEqual({ title: 'Review' })
  })

  it('PATCH saves to draft', async () => {
    mockQuery.mockResolvedValueOnce({})
    const res = await rfPatch(req('PATCH', { title: 'New' }), { params: idParams })
    const data = await res.json()
    expect(data.success).toBe(true)
  })

  it('POST publishes draft', async () => {
    mockQueryOne.mockResolvedValueOnce({ form_id: 'f-1', fields: { title: 'Rev', slug: 'rev', template_type: 'google_review', google_review_url: 'http://g.co' } })
    mockQuery.mockResolvedValueOnce({})
    mockQuery.mockResolvedValueOnce({})
    const res = await rfPublish(req('POST'), { params: idParams })
    const data = await res.json()
    expect(data.success).toBe(true)
  })

  it('POST returns 404 when no draft', async () => {
    mockQueryOne.mockResolvedValueOnce(null)
    const res = await rfPublish(req('POST'), { params: idParams })
    expect(res.status).toBe(404)
  })

  it('DELETE discards draft', async () => {
    mockQuery.mockResolvedValueOnce({})
    const res = await rfDelete(req('DELETE'), { params: idParams })
    const data = await res.json()
    expect(data.success).toBe(true)
  })
})
