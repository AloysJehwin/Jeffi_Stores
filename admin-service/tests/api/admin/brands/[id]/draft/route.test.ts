import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({ queryOne: vi.fn() }))
vi.mock('@/lib/admin/draft-locks', () => ({
  actorOf: vi.fn((a: any) => ({ adminId: a.adminId })),
  closeAfter: vi.fn(),
  discardGuard: vi.fn(),
  draftLockChips: vi.fn(),
  draftLockResponse: vi.fn(),
  epochFrom: vi.fn(() => 7),
  withDraftWrite: vi.fn(),
}))
vi.mock('@/lib/admin/draft-branches', () => ({
  createDraft: vi.fn(),
  discardDraftRow: vi.fn(),
  draftConflictResponse: vi.fn(),
  draftsOf: vi.fn(),
  getDraftRow: vi.fn(),
  saveDraftContent: vi.fn(),
}))
vi.mock('@/lib/catalog/brand-draft', () => ({ brandDrafts: { name: 'brandDrafts' } }))

import { GET, POST, PATCH, DELETE } from '@admin/app/api/(admin)/admin/brands/[id]/draft/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { queryOne } from '@/lib/shared/db'
import { closeAfter, discardGuard, draftLockChips, draftLockResponse, withDraftWrite } from '@/lib/admin/draft-locks'
import { createDraft, discardDraftRow, draftConflictResponse, draftsOf, getDraftRow } from '@/lib/admin/draft-branches'

const ctx = { params: Promise.resolve({ id: 'b1' }) }
const url = 'http://localhost/api/admin/brands/b1/draft'
const jreq = (method: string, body?: unknown, qs = '') => new NextRequest(url + qs, { method, body: body === undefined ? undefined : JSON.stringify(body) })

describe('brands/[id]/draft', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateAdmin).mockResolvedValue({ adminId: 'a1', role: 'manager', scopes: [] } as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(draftsOf).mockResolvedValue([])
    vi.mocked(draftLockChips).mockResolvedValue({})
    vi.mocked(queryOne).mockResolvedValue({ '?column?': 1 } as any)
    vi.mocked(getDraftRow).mockResolvedValue({ brand_id: 'b1' } as any)
    vi.mocked(createDraft).mockResolvedValue('d-new' as any)
    vi.mocked(draftLockResponse).mockReturnValue(null as any)
    vi.mocked(draftConflictResponse).mockReturnValue(null as any)
    vi.mocked(discardGuard).mockResolvedValue(null as any)
  })

  const calls = {
    GET: () => GET(jreq('GET'), ctx),
    POST: () => POST(jreq('POST', {}), ctx),
    PATCH: () => PATCH(jreq('PATCH', { draftId: 'd1', fields: {} }), ctx),
    DELETE: () => DELETE(jreq('DELETE', undefined, '?draft=d1'), ctx),
  }
  for (const [name, call] of Object.entries(calls)) {
    it(`${name} 401s without a session`, async () => {
      vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
      expect((await call()).status).toBe(401)
    })
    it(`${name} 403s without brands:write`, async () => {
      vi.mocked(hasScope).mockReturnValue(false)
      expect((await call()).status).toBe(403)
      expect(hasScope).toHaveBeenCalledWith('manager', [], 'brands:write')
    })
  }

  it('GET lists drafts with their lock chip', async () => {
    vi.mocked(draftsOf).mockResolvedValue([{ id: 'd1' }, { id: 'd2' }] as any)
    vi.mocked(draftLockChips).mockResolvedValue({ d1: { holder: 'x' } } as any)
    const j = await (await GET(jreq('GET'), ctx)).json()
    expect(j.drafts).toEqual([{ id: 'd1', lock: { holder: 'x' } }, { id: 'd2', lock: null }])
    expect(draftLockChips).toHaveBeenCalledWith('brand', ['d1', 'd2'], 'a1')
  })

  it('POST 404s for an unknown brand', async () => {
    vi.mocked(queryOne).mockResolvedValue(null)
    expect((await POST(jreq('POST', {}), ctx)).status).toBe(404)
    expect(createDraft).not.toHaveBeenCalled()
  })

  it('POST reuses the callers own draft unless new is set', async () => {
    vi.mocked(draftsOf).mockResolvedValue([{ id: 'mine', authorId: 'a1' }] as any)
    expect(await (await POST(jreq('POST', {}), ctx)).json()).toMatchObject({ draftId: 'mine', existing: true })
    expect(createDraft).not.toHaveBeenCalled()
    const j = await (await POST(jreq('POST', { new: true, title: 'T' }), ctx)).json()
    expect(j).toEqual({ success: true, brandId: 'b1', draftId: 'd-new' })
    expect(createDraft).toHaveBeenCalledWith({ name: 'brandDrafts' }, { adminId: 'a1' }, 'b1', { title: 'T' })
  })

  it('POST maps a lock error to its response and rethrows others', async () => {
    vi.mocked(createDraft).mockRejectedValueOnce(new Error('locked'))
    vi.mocked(draftLockResponse).mockReturnValueOnce(NextResponse.json({ error: 'locked' }, { status: 423 }) as any)
    expect((await POST(jreq('POST', {}), ctx)).status).toBe(423)
    vi.mocked(createDraft).mockRejectedValueOnce(new Error('boom'))
    await expect(POST(jreq('POST', {}), ctx)).rejects.toThrow('boom')
  })

  it('PATCH 400s without draftId or fields', async () => {
    expect((await PATCH(jreq('PATCH', { draftId: 'd1' }), ctx)).status).toBe(400)
    expect((await PATCH(jreq('PATCH', { fields: {} }), ctx)).status).toBe(400)
  })

  it('PATCH 404s for a draft of another brand', async () => {
    vi.mocked(getDraftRow).mockResolvedValue({ brand_id: 'other' } as any)
    expect((await PATCH(jreq('PATCH', { draftId: 'd1', fields: {} }), ctx)).status).toBe(404)
    expect(withDraftWrite).not.toHaveBeenCalled()
  })

  it('PATCH autosaves under the draft write lock with the epoch', async () => {
    const res = await PATCH(jreq('PATCH', { draftId: 'd1', fields: { name: 'x' } }), ctx)
    expect(await res.json()).toEqual({ success: true })
    expect(withDraftWrite).toHaveBeenCalledWith({ adminId: 'a1' }, 'brand', 'd1', expect.any(Function), { epoch: 7 })
  })

  it('PATCH returns the lock response when the write is refused', async () => {
    vi.mocked(withDraftWrite).mockRejectedValue(new Error('locked'))
    vi.mocked(draftLockResponse).mockReturnValue(NextResponse.json({ error: 'locked' }, { status: 423 }) as any)
    expect((await PATCH(jreq('PATCH', { draftId: 'd1', fields: {} }), ctx)).status).toBe(423)
  })

  it('DELETE needs a draft id and a matching brand', async () => {
    expect((await DELETE(jreq('DELETE'), ctx)).status).toBe(400)
    vi.mocked(getDraftRow).mockResolvedValue(null as any)
    expect((await DELETE(jreq('DELETE', undefined, '?draft=d1'), ctx)).status).toBe(404)
  })

  it('DELETE is refused by the discard guard', async () => {
    vi.mocked(discardGuard).mockResolvedValue(NextResponse.json({ error: 'held' }, { status: 423 }) as any)
    expect((await DELETE(jreq('DELETE', undefined, '?draft=d1'), ctx)).status).toBe(423)
    expect(discardDraftRow).not.toHaveBeenCalled()
  })

  it('DELETE discards the row and closes the lock', async () => {
    const res = await DELETE(jreq('DELETE', undefined, '?draft=d1'), ctx)
    expect(await res.json()).toEqual({ success: true })
    expect(discardDraftRow).toHaveBeenCalledWith({ name: 'brandDrafts' }, 'd1')
    expect(closeAfter).toHaveBeenCalledWith({ adminId: 'a1' }, 'brand', 'd1', 'discarded')
  })
})
