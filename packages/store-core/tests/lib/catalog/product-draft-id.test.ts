import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/shared/db', () => ({
  queryOne: vi.fn(),
  queryMany: vi.fn(),
}))
vi.mock('@/lib/admin/draft-locks', () => ({
  acquireDraftLock: vi.fn(),
  draftLockChips: vi.fn(),
  withDraftCreate: vi.fn(),
}))
vi.mock('@/lib/admin/entity-revisions', () => ({
  currentRevision: vi.fn(),
}))

import { productDraftIdFor, draftBehindFor, startProductDraft, draftsForProduct } from '@/lib/catalog/product-draft-id'
import { queryOne, queryMany } from '@/lib/shared/db'
import { acquireDraftLock, draftLockChips, withDraftCreate } from '@/lib/admin/draft-locks'
import { currentRevision } from '@/lib/admin/entity-revisions'

const mQueryOne = vi.mocked(queryOne)
const mQueryMany = vi.mocked(queryMany)
const mAcquire = vi.mocked(acquireDraftLock)
const mChips = vi.mocked(draftLockChips)
const mWithCreate = vi.mocked(withDraftCreate)
const mRev = vi.mocked(currentRevision)

function req(params: Record<string, string> = {}) {
  const sp = new URLSearchParams(params)
  return { nextUrl: { searchParams: sp } }
}

beforeEach(() => vi.clearAllMocks())

describe('productDraftIdFor', () => {
  it('returns the asked draft when it matches the product', async () => {
    mQueryOne.mockResolvedValueOnce({ id: 'd1' })
    const r = await productDraftIdFor(req({ draft: 'd1' }), 'p1', 'a1')
    expect(r).toBe('d1')
    const [sql, args] = mQueryOne.mock.calls[0]
    expect(sql).toContain('WHERE id = $1 AND product_id = $2')
    expect(args).toEqual(['d1', 'p1'])
  })

  it('returns null when the asked draft does not match', async () => {
    mQueryOne.mockResolvedValueOnce(null)
    expect(await productDraftIdFor(req({ draft: 'dX' }), 'p1', 'a1')).toBeNull()
  })

  it('returns null when nothing asked and no adminId', async () => {
    const r = await productDraftIdFor(req(), 'p1', null)
    expect(r).toBeNull()
    expect(mQueryOne).not.toHaveBeenCalled()
  })

  it('falls back to the caller own newest draft', async () => {
    mQueryOne.mockResolvedValueOnce({ id: 'own1' })
    const r = await productDraftIdFor(req(), 'p1', 'a1')
    expect(r).toBe('own1')
    const [sql, args] = mQueryOne.mock.calls[0]
    expect(sql).toContain('author_admin_id = $2')
    expect(sql).toContain('ORDER BY updated_at DESC LIMIT 1')
    expect(args).toEqual(['p1', 'a1'])
  })

  it('returns null when the caller has no own draft', async () => {
    mQueryOne.mockResolvedValueOnce(null)
    expect(await productDraftIdFor(req(), 'p1', 'a1')).toBeNull()
  })
})

describe('draftBehindFor', () => {
  it('returns [null, 0] when the draft row is missing', async () => {
    mQueryOne.mockResolvedValueOnce(null)
    const r = await draftBehindFor('d1')
    expect(r).toEqual([null, 0])
  })

  it('returns null info when not behind, with siblings count', async () => {
    mQueryOne.mockResolvedValueOnce({ behind: 0, siblings: 2, last_by: null, last_at: null, last_title: null })
    const [info, siblings] = await draftBehindFor('d1')
    expect(info).toBeNull()
    expect(siblings).toBe(2)
    expect(mQueryOne.mock.calls[0][1]).toEqual(['d1'])
  })

  it('builds the behind info when behind > 0', async () => {
    mQueryOne.mockResolvedValueOnce({ behind: 3, siblings: 1, last_by: 'Bob', last_at: 't', last_title: 'T' })
    const [info, siblings] = await draftBehindFor('d1')
    expect(siblings).toBe(1)
    expect(info).toEqual({ behind: 3, last: { by: 'Bob', at: 't', draftTitle: 'T', fields: 0 } })
  })
})

describe('startProductDraft', () => {
  it('reuses and locks the actor existing draft when not fresh', async () => {
    mQueryOne.mockResolvedValueOnce({ id: 'own1' })
    const actor = { adminId: 'a1' }
    const r = await startProductDraft(actor, 'p1')
    expect(r).toEqual({ draftId: 'own1', existing: true })
    expect(mAcquire).toHaveBeenCalledWith(actor, 'product', 'own1')
    expect(mWithCreate).not.toHaveBeenCalled()
  })

  it('creates a new draft when fresh even if one exists', async () => {
    // gen_random_uuid lookup
    mQueryOne.mockResolvedValueOnce({ id: 'new-uuid' })
    mRev.mockResolvedValueOnce(7)
    const dbQuery = vi.fn()
    mWithCreate.mockImplementationOnce(async (_a, _t, _id, fn) => fn({ query: dbQuery } as any))
    const actor = { adminId: 'a1' }
    const r = await startProductDraft(actor, 'p1', { fresh: true, title: '  My Title  ' })
    expect(r).toEqual({ draftId: 'new-uuid', existing: false })
    expect(mAcquire).not.toHaveBeenCalled()
    expect(mWithCreate).toHaveBeenCalledWith(actor, 'product', 'new-uuid', expect.any(Function))
    // The insert ran inside the create callback with trimmed title and rev
    const [sql, args] = dbQuery.mock.calls[0]
    expect(sql).toContain('INSERT INTO product_drafts')
    expect(args).toEqual(['p1', 'new-uuid', 'a1', 'My Title', 7])
  })

  it('creates a draft when the actor has no existing one', async () => {
    mQueryOne.mockResolvedValueOnce(null) // no own draft
    mQueryOne.mockResolvedValueOnce({ id: 'new-uuid' }) // uuid
    mRev.mockResolvedValueOnce(0)
    const dbQuery = vi.fn()
    mWithCreate.mockImplementationOnce(async (_a, _t, _id, fn) => fn({ query: dbQuery } as any))
    const r = await startProductDraft({ adminId: 'a1' }, 'p1')
    expect(r.existing).toBe(false)
    expect(dbQuery.mock.calls[0][1]).toEqual(['p1', 'new-uuid', 'a1', null, 0])
  })

  it('passes null adminId and null title when actor has none', async () => {
    mQueryOne.mockResolvedValueOnce({ id: 'new-uuid' }) // uuid (no own lookup since no adminId)
    mRev.mockResolvedValueOnce(2)
    const dbQuery = vi.fn()
    mWithCreate.mockImplementationOnce(async (_a, _t, _id, fn) => fn({ query: dbQuery } as any))
    await startProductDraft(null, 'p1', { title: '' })
    expect(dbQuery.mock.calls[0][1]).toEqual(['p1', 'new-uuid', null, null, 2])
  })
})

describe('draftsForProduct', () => {
  it('returns [] when there are no rows', async () => {
    mQueryMany.mockResolvedValueOnce([])
    const r = await draftsForProduct('p1')
    expect(r).toEqual([])
    expect(mChips).not.toHaveBeenCalled()
  })

  it('maps rows and attaches lock chips, computing behind only with a base', async () => {
    mQueryMany.mockResolvedValueOnce([
      { id: 'd1', title: 'A', author_admin_id: 'a1', author_name: 'Al', base_revision: 2, updated_at: 'u1', has_base: true, rev: '5' },
      { id: 'd2', title: null, author_admin_id: null, author_name: null, base_revision: null, updated_at: 'u2', has_base: false, rev: '9' },
    ])
    mChips.mockResolvedValueOnce({ d1: { by: 'x' } as any })
    const r = await draftsForProduct('p1', 'me1')
    expect(mChips).toHaveBeenCalledWith('product', ['d1', 'd2'], 'me1')
    expect(r[0]).toEqual({
      id: 'd1', entityId: 'p1', title: 'A', authorId: 'a1', authorName: 'Al',
      baseRevision: 2, updatedAt: 'u1', behind: 3, lock: { by: 'x' },
    })
    // no base -> behind 0; base_revision null -> 0; no lock -> null
    expect(r[1].behind).toBe(0)
    expect(r[1].baseRevision).toBe(0)
    expect(r[1].lock).toBeNull()
  })

  it('clamps behind at 0 when rev is below base_revision', async () => {
    mQueryMany.mockResolvedValueOnce([
      { id: 'd1', title: 'A', author_admin_id: 'a1', author_name: 'Al', base_revision: 10, updated_at: 'u1', has_base: true, rev: '5' },
    ])
    mChips.mockResolvedValueOnce({})
    const r = await draftsForProduct('p1')
    expect(r[0].behind).toBe(0)
  })
})
