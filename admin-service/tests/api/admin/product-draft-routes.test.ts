import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn().mockReturnValue(true) }))

const mockQuery = vi.fn()
const mockQueryOne = vi.fn()
const mockQueryMany = vi.fn()
vi.mock('@/lib/shared/db', () => ({
  query: (...a: any[]) => mockQuery(...a),
  queryOne: (...a: any[]) => mockQueryOne(...a),
  queryMany: (...a: any[]) => mockQueryMany(...a),
  // Locked reads come from queryOne/queryMany mocks, writes from query — same as the pool helpers.
  withTransaction: vi.fn(async (fn: any) =>
    fn({
      query: async (sql: string, p?: unknown[]) =>
        /FOR UPDATE/.test(sql)
          ? { rows: [await mockQueryOne(sql, p)].filter(Boolean) }
          : /^SELECT/.test(sql.trim())
            ? { rows: (await mockQueryMany(sql, p)) ?? [] }
            : ((await mockQuery(sql, p)) ?? { rows: [] }),
    })
  ),
}))

// Review-form draft branches: spies that run the real code unless a test stubs them.
const branches = vi.hoisted(() => ({
  draftsOf: vi.fn(),
  createDraft: vi.fn(),
  getDraftRow: vi.fn(),
  saveDraftContent: vi.fn(),
  discardDraftRow: vi.fn(),
}))
vi.mock('@/lib/admin/draft-branches', async orig => {
  const real = await orig<Record<string, any>>()
  for (const [k, fn] of Object.entries(branches)) fn.mockImplementation(real[k])
  return { ...real, ...branches }
})
const publishReviewFormDraft = vi.hoisted(() => vi.fn())
vi.mock('@/lib/catalog/review-form-draft', async orig => ({ ...(await orig<object>()), publishReviewFormDraft }))

// Product draft routes address one draft of the product (?draft=); these tests use a fixed one.
const productDrafts = vi.hoisted(() => ({ productDraftIdFor: vi.fn(), startProductDraft: vi.fn() }))
vi.mock('@/lib/catalog/product-draft-id', async orig => {
  const real = await orig<Record<string, any>>()
  productDrafts.startProductDraft.mockImplementation(real.startProductDraft)
  return { ...real, ...productDrafts }
})
beforeEach(() => {
  // Drop queued *Once values a test left unconsumed so they can't leak into the next one.
  for (const m of [mockQuery, mockQueryOne, mockQueryMany]) m.mockReset()
  productDrafts.productDraftIdFor.mockResolvedValue('draft-1')
})
import { PRODUCT_SNAPSHOT_SELECT } from '@/lib/catalog/product-draft-merge'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { DraftConflictError } from '@/lib/admin/draft-branches'

// Products draft route
import {
  POST as prodDraftPost,
  PATCH as prodDraftPatch,
  DELETE as prodDraftDelete,
} from '@admin/app/api/(admin)/admin/products/[id]/draft/route'

// Products draft sub-variants
import {
  GET as svGet,
  POST as svPost,
  DELETE as svDelete,
  PATCH as svPatch,
} from '@admin/app/api/(admin)/admin/products/[id]/draft/sub-variants/route'

// Products draft units
import {
  GET as unitsGet,
  POST as unitsPost,
  DELETE as unitsDelete,
} from '@admin/app/api/(admin)/admin/products/[id]/draft/units/route'

// Review forms draft + publish
import { POST as rfDraftPost, PATCH as rfPatch, DELETE as rfDelete } from '@admin/app/api/(admin)/admin/review-forms/[id]/draft/route'
import { POST as rfPublish } from '@admin/app/api/(admin)/admin/review-forms/[id]/publish/route'

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
    productDrafts.startProductDraft.mockResolvedValueOnce({ draftId: 'd-new', existing: false })
    const res = await prodDraftPost(req('POST'), { params: idParams })
    const data = await res.json()
    expect(data).toMatchObject({ success: true, productId: 'prod-1', draftId: 'd-new' })
    // The draft (and its merge base) is seeded from this live snapshot.
    expect(PRODUCT_SNAPSHOT_SELECT).toContain("jsonb_build_object('sub_variant_type_on'")
    expect(PRODUCT_SNAPSHOT_SELECT).toContain("- 'inventory_quantity'")
    expect(PRODUCT_SNAPSHOT_SELECT).not.toContain('_seeded')
  })

  it('POST returns the admin’s existing draft instead of a second one', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'prod-1' })
    productDrafts.startProductDraft.mockResolvedValueOnce({ draftId: 'd-mine', existing: true })
    const res = await prodDraftPost(req('POST'), { params: idParams })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ draftId: 'd-mine', existing: true })
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
    productDrafts.productDraftIdFor.mockResolvedValueOnce(null)
    const res = await prodDraftPatch(req('PATCH', { fields: {} }), { params: idParams })
    expect(res.status).toBe(404)
  })

  it('DELETE discards draft', async () => {
    mockQueryOne.mockResolvedValueOnce({ variant_images: [], images: [] })
    mockQueryMany.mockResolvedValueOnce([]) // no staged digital files
    mockQuery.mockResolvedValue({ rows: [] })
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
    mockQueryOne.mockResolvedValueOnce({ is_digital: false }) // digital guard
    mockQueryOne.mockResolvedValueOnce({ sub_variants: [] }) // locked draft read
    // Variant is untouched → ensureVariantSeeded reads the live sub-variant set
    // (complete-snapshot seeding). No live rows here, so nothing is seeded.
    mockQueryMany.mockResolvedValueOnce([])
    mockQuery.mockResolvedValueOnce({})
    const r = reqWithParams('POST', { variant_id: 'v-1' }, { sub_variant_name: 'Red', price: 100 })
    const res = await svPost(r, { params: idParams })
    const data = await res.json()
    expect(data.sub_variant).toBeDefined()
  })

  it('POST rejects a sub-variant without a name', async () => {
    mockQueryOne.mockResolvedValueOnce({ is_digital: false })
    const r = reqWithParams('POST', { variant_id: 'v-1' }, { price: 100 })
    const res = await svPost(r, { params: idParams })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/sub_variant_name/)
  })

  it('POST rejects a price above MRP', async () => {
    mockQueryOne.mockResolvedValueOnce({ is_digital: false })
    const r = reqWithParams('POST', { variant_id: 'v-1' }, { sub_variant_name: 'Red', price: 200, mrp: 100 })
    const res = await svPost(r, { params: idParams })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/cannot be higher than MRP/)
  })

  it('POST rejects a duplicate sub-variant name for the variant', async () => {
    mockQueryOne.mockResolvedValueOnce({ is_digital: false })
    mockQueryOne.mockResolvedValueOnce({ sub_variants: [{ id: 'sv-1', variant_id: 'v-1', sub_variant_name: 'Red' }] })
    const r = reqWithParams('POST', { variant_id: 'v-1' }, { sub_variant_name: ' red ' })
    const res = await svPost(r, { params: idParams })
    expect(res.status).toBe(409)
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('POST returns 404 when the draft row is missing', async () => {
    mockQueryOne.mockResolvedValueOnce({ is_digital: false })
    mockQueryOne.mockResolvedValueOnce(null)
    mockQueryMany.mockResolvedValueOnce([])
    const r = reqWithParams('POST', { variant_id: 'v-1' }, { sub_variant_name: 'Red' })
    const res = await svPost(r, { params: idParams })
    expect(res.status).toBe(404)
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
    mockQueryOne.mockResolvedValueOnce({ is_digital: false }) // digital guard
    // liveBaseUnit() runs first for the base-change guard; null = no live base, guard skipped.
    mockQueryOne.mockResolvedValueOnce(null)
    mockQueryOne.mockResolvedValueOnce({ units: [] })
    mockQuery.mockResolvedValueOnce({})
    const res = await unitsPost(req('POST', { unit: 'pc', factor: 1, is_base: true }), { params: idParams })
    const data = await res.json()
    expect(data.unit).toBeDefined()
  })

  it('POST rejects units for a digital product (live or staged)', async () => {
    mockQueryOne.mockResolvedValueOnce({ is_digital: true })
    const res = await unitsPost(req('POST', { unit: 'box', factor: 10 }), { params: idParams })
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('Digital products sell as 1 pc')
    expect(mockQuery).not.toHaveBeenCalled()
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
  const rfParams = Promise.resolve({ id: 'f-1' })
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateAdmin).mockResolvedValue(admin as any)
  })

  it('POST starts a draft', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'f-1' })
    branches.draftsOf.mockResolvedValueOnce([])
    branches.createDraft.mockResolvedValueOnce('d-1')
    const data = await (await rfDraftPost(req('POST'), { params: rfParams })).json()
    expect(data).toMatchObject({ success: true, draftId: 'd-1' })
  })

  it('POST returns the caller’s own draft instead of a second one', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue({ ...admin, adminId: 'a1' } as any)
    mockQueryOne.mockResolvedValueOnce({ id: 'f-1' })
    branches.draftsOf.mockResolvedValueOnce([{ id: 'd-mine', authorId: 'a1' }])
    const data = await (await rfDraftPost(req('POST'), { params: rfParams })).json()
    expect(data).toMatchObject({ draftId: 'd-mine', existing: true })
    expect(branches.createDraft).not.toHaveBeenCalled()
  })

  it('PATCH saves the named draft', async () => {
    branches.getDraftRow.mockResolvedValueOnce({ id: 'd-1', form_id: 'f-1' })
    branches.saveDraftContent.mockResolvedValueOnce(true)
    const res = await rfPatch(req('PATCH', { draftId: 'd-1', fields: { title: 'New' } }), { params: rfParams })
    expect((await res.json()).success).toBe(true)
    expect(branches.saveDraftContent).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'd-1', { title: 'New' }, undefined)
  })

  it('PATCH without a draft id is a 400', async () => {
    const res = await rfPatch(req('PATCH', { fields: { title: 'New' } }), { params: rfParams })
    expect(res.status).toBe(400)
  })

  it('PATCH of another form’s draft is a 404', async () => {
    branches.getDraftRow.mockResolvedValueOnce({ id: 'd-1', form_id: 'f-9' })
    const res = await rfPatch(req('PATCH', { draftId: 'd-1', fields: {} }), { params: rfParams })
    expect(res.status).toBe(404)
  })

  it('publish merges the named draft', async () => {
    branches.getDraftRow.mockResolvedValueOnce({ id: 'd-1', form_id: 'f-1' })
    publishReviewFormDraft.mockResolvedValueOnce({ entityId: 'f-1', revision: 2 })
    const res = await rfPublish(reqWithParams('POST', { draft: 'd-1' }), { params: rfParams })
    expect(await res.json()).toMatchObject({ success: true, revision: 2 })
    expect(publishReviewFormDraft).toHaveBeenCalledWith('d-1', expect.anything())
  })

  it('publish answers 409 with the overlapping fields', async () => {
    branches.getDraftRow.mockResolvedValueOnce({ id: 'd-1', form_id: 'f-1' })
    publishReviewFormDraft.mockRejectedValueOnce(new DraftConflictError([{ path: 'title', label: 'Title', base: 'a', theirs: 'b', mine: 'c' }], 3))
    const res = await rfPublish(reqWithParams('POST', { draft: 'd-1' }, { resolutions: {} }), { params: rfParams })
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'DRAFT_CONFLICT', conflicts: [{ path: 'title' }] })
  })

  it('publish returns 404 when the draft is gone', async () => {
    branches.getDraftRow.mockResolvedValueOnce(null)
    const res = await rfPublish(reqWithParams('POST', { draft: 'd-1' }), { params: rfParams })
    expect(res.status).toBe(404)
  })

  it('DELETE discards the named draft', async () => {
    branches.getDraftRow.mockResolvedValueOnce({ id: 'd-1', form_id: 'f-1' })
    branches.discardDraftRow.mockResolvedValueOnce('f-1')
    const res = await rfDelete(reqWithParams('DELETE', { draft: 'd-1' }), { params: rfParams })
    expect((await res.json()).success).toBe(true)
    expect(branches.discardDraftRow).toHaveBeenCalledWith(expect.anything(), 'd-1')
  })
})
