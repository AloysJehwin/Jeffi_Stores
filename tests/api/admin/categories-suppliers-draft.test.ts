import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn().mockReturnValue(true) }))

const mockQuery = vi.fn()
const mockQueryOne = vi.fn()
vi.mock('@/lib/shared/db', () => ({
  query: (...a: any[]) => mockQuery(...a),
  queryOne: (...a: any[]) => mockQueryOne(...a),
  queryMany: vi.fn().mockResolvedValue([]),
  withTransaction: vi.fn(),
}))

const branches = vi.hoisted(() => ({
  draftsOf: vi.fn(),
  createDraft: vi.fn(),
  getDraftRow: vi.fn(),
  saveDraftContent: vi.fn(),
  discardDraftRow: vi.fn(),
}))
vi.mock('@/lib/admin/draft-branches', async orig => ({ ...(await orig<object>()), ...branches }))
const publishCategoryDraft = vi.hoisted(() => vi.fn())
vi.mock('@/lib/catalog/category-draft', async orig => ({ ...(await orig<object>()), publishCategoryDraft }))
const publishSupplierDraft = vi.hoisted(() => vi.fn())
vi.mock('@/lib/admin/supplier-drafts', async orig => ({ ...(await orig<object>()), publishSupplierDraft }))

import { authenticateAdmin } from '@/lib/auth/jwt'
import { DraftConflictError } from '@/lib/admin/draft-branches'
import { POST, PATCH, DELETE } from '@admin/app/api/(admin)/admin/categories/[id]/draft/route'
import { POST as catPublish } from '@admin/app/api/(admin)/admin/categories/[id]/publish/route'
import {
  GET as suppGet,
  PATCH as suppPatch,
  POST as suppPost,
  DELETE as suppDelete,
} from '@admin/app/api/(admin)/admin/suppliers/[id]/draft/route'
import { POST as suppPublish } from '@admin/app/api/(admin)/admin/suppliers/[id]/publish/route'

const admin = { id: 'a1', role: 'super_admin', scopes: [] }

function req(method: string, body?: unknown, id = 'cat-1', qs = '') {
  return new NextRequest(`http://localhost/${id}${qs}`, {
    method,
    body: body ? JSON.stringify(body) : undefined,
    headers: { 'Content-Type': 'application/json' },
  })
}

const catParams = Promise.resolve({ id: 'cat-1' })
const suppParams = Promise.resolve({ id: 'sup-1' })

describe('categories draft route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateAdmin).mockResolvedValue(admin as any)
  })

  it('POST starts a draft', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'cat-1' })
    branches.draftsOf.mockResolvedValueOnce([])
    branches.createDraft.mockResolvedValueOnce('d-1')
    const data = await (await POST(req('POST'), { params: catParams })).json()
    expect(data).toMatchObject({ success: true, draftId: 'd-1' })
  })

  it('POST returns the caller’s own draft instead of a second one', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue({ ...admin, adminId: 'a1' } as any)
    mockQueryOne.mockResolvedValueOnce({ id: 'cat-1' })
    branches.draftsOf.mockResolvedValueOnce([{ id: 'd-mine', authorId: 'a1' }])
    const data = await (await POST(req('POST'), { params: catParams })).json()
    expect(data).toMatchObject({ draftId: 'd-mine', existing: true })
    expect(branches.createDraft).not.toHaveBeenCalled()
  })

  it('POST { new: true } starts another draft alongside', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'cat-1' })
    branches.createDraft.mockResolvedValueOnce('d-2')
    const data = await (await POST(req('POST', { new: true }), { params: catParams })).json()
    expect(data.draftId).toBe('d-2')
  })

  it('PATCH saves the named draft', async () => {
    branches.getDraftRow.mockResolvedValueOnce({ id: 'd-1', category_id: 'cat-1' })
    const { withTransaction } = await import('@/lib/shared/db')
    vi.mocked(withTransaction).mockImplementation(async (fn: any) => fn({ query: mockQuery }))
    const data = await (await PATCH(req('PATCH', { draftId: 'd-1', fields: { name: 'New Name' } }), { params: catParams })).json()
    expect(data.success).toBe(true)
    expect(branches.saveDraftContent).toHaveBeenCalled()
  })

  it('PATCH without a draft id is a 400', async () => {
    const res = await PATCH(req('PATCH', { fields: { name: 'x' } }), { params: catParams })
    expect(res.status).toBe(400)
  })

  it('DELETE discards the named draft', async () => {
    branches.getDraftRow.mockResolvedValueOnce({ id: 'd-1', category_id: 'cat-1' })
    const data = await (await DELETE(req('DELETE', undefined, 'cat-1', '?draft=d-1'), { params: catParams })).json()
    expect(data.success).toBe(true)
    expect(branches.discardDraftRow).toHaveBeenCalledWith(expect.anything(), 'd-1')
  })

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    const res = await POST(req('POST'), { params: catParams })
    expect(res.status).toBe(401)
  })
})

describe('categories publish route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateAdmin).mockResolvedValue(admin as any)
  })

  it('needs a draft id', async () => {
    const res = await catPublish(req('POST'), { params: catParams })
    expect(res.status).toBe(400)
  })

  it('returns 404 for a draft of another category', async () => {
    branches.getDraftRow.mockResolvedValueOnce({ id: 'd-1', category_id: 'cat-9' })
    const res = await catPublish(req('POST', undefined, 'cat-1', '?draft=d-1'), { params: catParams })
    expect(res.status).toBe(404)
  })

  it('publishes the draft', async () => {
    branches.getDraftRow.mockResolvedValueOnce({ id: 'd-1', category_id: 'cat-1' })
    publishCategoryDraft.mockResolvedValueOnce({ entityId: 'cat-1', revision: 4 })
    const data = await (await catPublish(req('POST', undefined, 'cat-1', '?draft=d-1'), { params: catParams })).json()
    expect(data).toMatchObject({ success: true, revision: 4 })
  })

  it('answers 409 with the overlapping fields', async () => {
    branches.getDraftRow.mockResolvedValueOnce({ id: 'd-1', category_id: 'cat-1' })
    publishCategoryDraft.mockRejectedValueOnce(new DraftConflictError([{ path: 'name', label: 'Name', base: 'a', theirs: 'b', mine: 'c' }], 3))
    const res = await catPublish(req('POST', { resolutions: {} }, 'cat-1', '?draft=d-1'), { params: catParams })
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'DRAFT_CONFLICT', conflicts: [{ path: 'name' }] })
  })
})

describe('suppliers draft route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateAdmin).mockResolvedValue(admin as any)
  })

  it('GET ?draft returns that draft’s fields', async () => {
    branches.getDraftRow.mockResolvedValueOnce({ id: 'd-1', supplier_id: 'sup-1', fields: { name: 'ACME' } })
    const data = await (await suppGet(req('GET', undefined, 'sup-1', '?draft=d-1'), { params: suppParams })).json()
    expect(data.draft_fields).toEqual({ name: 'ACME' })
  })

  it('GET ?draft of another supplier returns null', async () => {
    branches.getDraftRow.mockResolvedValueOnce({ id: 'd-1', supplier_id: 'sup-9', fields: { name: 'ACME' } })
    const data = await (await suppGet(req('GET', undefined, 'sup-1', '?draft=d-1'), { params: suppParams })).json()
    expect(data.draft_fields).toBeNull()
  })

  it('GET lists the open drafts', async () => {
    branches.draftsOf.mockResolvedValueOnce([{ id: 'd-1', authorId: 'a2' }])
    const data = await (await suppGet(req('GET', undefined, 'sup-1'), { params: suppParams })).json()
    expect(data.drafts).toMatchObject([{ id: 'd-1' }])
  })

  it('POST starts a draft, or returns the caller’s own', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue({ ...admin, adminId: 'a1' } as any)
    mockQueryOne.mockResolvedValueOnce({ '?column?': 1 }).mockResolvedValueOnce({ '?column?': 1 })
    branches.draftsOf.mockResolvedValueOnce([])
    branches.createDraft.mockResolvedValueOnce('d-1')
    expect(await (await suppPost(req('POST'), { params: suppParams })).json()).toMatchObject({ success: true, draftId: 'd-1' })
    branches.draftsOf.mockResolvedValueOnce([{ id: 'd-mine', authorId: 'a1' }])
    expect(await (await suppPost(req('POST'), { params: suppParams })).json()).toMatchObject({ draftId: 'd-mine', existing: true })
  })

  it('POST returns 404 for a missing supplier', async () => {
    mockQueryOne.mockResolvedValueOnce(null)
    const res = await suppPost(req('POST'), { params: suppParams })
    expect(res.status).toBe(404)
  })

  it('PATCH saves the named draft', async () => {
    branches.getDraftRow.mockResolvedValueOnce({ id: 'd-1', supplier_id: 'sup-1' })
    const { withTransaction } = await import('@/lib/shared/db')
    vi.mocked(withTransaction).mockImplementation(async (fn: any) => fn({ query: mockQuery }))
    const data = await (await suppPatch(req('PATCH', { draftId: 'd-1', fields: { name: 'ACME' } }), { params: suppParams })).json()
    expect(data.success).toBe(true)
    expect(branches.saveDraftContent).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'd-1', { name: 'ACME' }, undefined)
  })

  it('PATCH without a draft id is a 400', async () => {
    const res = await suppPatch(req('PATCH', { name: 'ACME' }), { params: suppParams })
    expect(res.status).toBe(400)
  })

  it('DELETE discards the named draft', async () => {
    branches.getDraftRow.mockResolvedValueOnce({ id: 'd-1', supplier_id: 'sup-1' })
    const data = await (await suppDelete(req('DELETE', undefined, 'sup-1', '?draft=d-1'), { params: suppParams })).json()
    expect(data.success).toBe(true)
    expect(branches.discardDraftRow).toHaveBeenCalledWith(expect.anything(), 'd-1')
  })
})

describe('suppliers publish route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateAdmin).mockResolvedValue(admin as any)
  })

  it('needs a draft id', async () => {
    const res = await suppPublish(req('POST', undefined, 'sup-1'), { params: suppParams })
    expect(res.status).toBe(400)
  })

  it('returns 404 when the draft is gone', async () => {
    branches.getDraftRow.mockResolvedValueOnce(null)
    const res = await suppPublish(req('POST', undefined, 'sup-1', '?draft=d-1'), { params: suppParams })
    expect(res.status).toBe(404)
  })

  it('publishes the draft', async () => {
    branches.getDraftRow.mockResolvedValueOnce({ id: 'd-1', supplier_id: 'sup-1' })
    publishSupplierDraft.mockResolvedValueOnce({ entityId: 'sup-1', revision: 2 })
    const data = await (await suppPublish(req('POST', undefined, 'sup-1', '?draft=d-1'), { params: suppParams })).json()
    expect(data).toMatchObject({ success: true, revision: 2 })
  })

  it('answers 409 with the overlapping fields', async () => {
    branches.getDraftRow.mockResolvedValueOnce({ id: 'd-1', supplier_id: 'sup-1' })
    publishSupplierDraft.mockRejectedValueOnce(new DraftConflictError([{ path: 'phone', label: 'Phone', base: '1', theirs: '2', mine: '3' }], 1))
    const res = await suppPublish(req('POST', { resolutions: {} }, 'sup-1', '?draft=d-1'), { params: suppParams })
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'DRAFT_CONFLICT', conflicts: [{ path: 'phone' }] })
  })
})
