import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({ query: vi.fn(), queryOne: vi.fn(), queryMany: vi.fn(), withTransaction: vi.fn() }))
vi.mock('@/lib/admin/draft-locks', () => ({
  actorOf: vi.fn(),
  announceDraftClosed: vi.fn(),
  canDiscard: vi.fn(),
  closeDraftLockTx: vi.fn(),
  draftLockChips: vi.fn(),
  draftLockResponse: vi.fn(),
  epochFrom: vi.fn(),
  withDraftCreate: vi.fn(),
  withDraftWrite: vi.fn(),
}))

import { GET, PATCH, DELETE } from '@admin/app/api/(admin)/admin/google-ads/campaign-drafts/[id]/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { query, queryOne, withTransaction } from '@/lib/shared/db'
import { announceDraftClosed, canDiscard, closeDraftLockTx, draftLockChips, draftLockResponse, withDraftCreate, withDraftWrite, actorOf } from '@/lib/admin/draft-locks'

const ADMIN = { adminId: 'a1', email: 'a@x.in', role: 'administrator', scopes: [] }
const ACTOR = { adminId: 'a1', role: 'administrator' }
const deny = (status: number) => vi.mocked(requireAdminScope).mockResolvedValueOnce(NextResponse.json({ error: 'denied' }, { status }) as any)
const ID = '11111111-2222-3333-4444-555555555555'

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(requireAdminScope).mockResolvedValue(ADMIN as any)
  vi.mocked(actorOf).mockReturnValue(ACTOR as any)
  vi.mocked(draftLockResponse).mockReturnValue(null as any)
})

const url = (id: string) => `http://localhost/api/admin/google-ads/campaign-drafts/${id}`
const ctx = (id: string) => ({ params: Promise.resolve({ id }) })
const get = (id = ID) => GET(new NextRequest(url(id)), ctx(id))
const patch = (body: unknown, id = ID) => PATCH(new NextRequest(url(id), { method: 'PATCH', body: typeof body === 'string' ? body : JSON.stringify(body) }), ctx(id))
const del = (id = ID) => DELETE(new NextRequest(url(id), { method: 'DELETE' }), ctx(id))

describe('GET /api/admin/google-ads/campaign-drafts/[id]', () => {
  it('401 when not signed in and 403 without google_ads:read', async () => {
    deny(401)
    expect((await get()).status).toBe(401)
    deny(403)
    expect((await get()).status).toBe(403)
    expect(requireAdminScope).toHaveBeenLastCalledWith(expect.anything(), 'google_ads:read')
    expect(queryOne).not.toHaveBeenCalled()
  })

  it('404 for a malformed id without touching the database, and for a draft that is gone', async () => {
    expect((await get('nope')).status).toBe(404)
    expect(queryOne).not.toHaveBeenCalled()
    vi.mocked(queryOne).mockResolvedValue(null)
    const res = await get()
    expect(res.status).toBe(404)
    expect((await res.json()).error).toMatch(/already finished or discarded/)
  })

  it('returns the draft', async () => {
    vi.mocked(queryOne).mockResolvedValue({ id: ID, title: 'Spring', fields: { step: 1 } } as any)
    const res = await get()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ draft: { id: ID, title: 'Spring', fields: { step: 1 } } })
    expect(vi.mocked(queryOne).mock.calls[0][1]).toEqual([ID])
  })
})

describe('PATCH /api/admin/google-ads/campaign-drafts/[id]', () => {
  it('401 when not signed in and 403 without google_ads_campaigns:write', async () => {
    deny(401)
    expect((await patch({})).status).toBe(401)
    deny(403)
    expect((await patch({})).status).toBe(403)
    expect(requireAdminScope).toHaveBeenLastCalledWith(expect.anything(), 'google_ads_campaigns:write')
    expect(withDraftWrite).not.toHaveBeenCalled()
  })

  it('404 for a malformed id and 400 for bad fields', async () => {
    expect((await patch({}, 'nope')).status).toBe(404)
    expect((await patch({ fields: 'x' })).status).toBe(400)
    expect((await patch({ title: 3 })).status).toBe(400)
    expect(withDraftWrite).not.toHaveBeenCalled()
  })

  it('autosaves the title and fields as the lock holder', async () => {
    const update = vi.fn()
    vi.mocked(withDraftWrite).mockImplementation(async (_a: any, _t: any, _id: any, fn: any) => {
      await fn({ query: update })
      return { rowCount: 1 }
    })
    const res = await patch({ title: 'Renamed', fields: { step: 3 } })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(withDraftWrite).toHaveBeenCalledWith(ACTOR, 'google_ads_campaign', ID, expect.any(Function), expect.any(Object))
    expect(update.mock.calls[0][0]).toContain('UPDATE ads_campaign_drafts')
    expect(update.mock.calls[0][1]).toEqual([ID, true, 'Renamed', '{"step":3}'])
  })

  it('404 when the draft vanished under the write', async () => {
    vi.mocked(withDraftWrite).mockResolvedValue({ rowCount: 0 } as any)
    expect((await patch({ title: 'x' })).status).toBe(404)
  })

  it('423 when another admin holds the lock', async () => {
    vi.mocked(withDraftWrite).mockRejectedValue(new Error('locked'))
    vi.mocked(draftLockResponse).mockReturnValue(NextResponse.json({ error: 'Locked by Asha' }, { status: 423 }) as any)
    const res = await patch({ title: 'x' })
    expect(res.status).toBe(423)
    expect(await res.json()).toEqual({ error: 'Locked by Asha' })
  })

  it('rethrows an error that is not a lock refusal', async () => {
    vi.mocked(withDraftWrite).mockRejectedValue(new Error('db down'))
    await expect(patch({ title: 'x' })).rejects.toThrow('db down')
  })
})

describe('DELETE /api/admin/google-ads/campaign-drafts/[id]', () => {
  it('401 when not signed in and 403 without google_ads_campaigns:write', async () => {
    deny(401)
    expect((await del()).status).toBe(401)
    deny(403)
    expect((await del()).status).toBe(403)
    expect(canDiscard).not.toHaveBeenCalled()
  })

  it('is a no-op success for a malformed id', async () => {
    const res = await del('nope')
    expect(await res.json()).toEqual({ ok: true })
    expect(canDiscard).not.toHaveBeenCalled()
  })

  it('423 with the lock refusal when the admin may not discard', async () => {
    vi.mocked(canDiscard).mockResolvedValue({ ok: false, error: { body: () => ({ error: 'Held by Asha' }) } } as any)
    const res = await del()
    expect(res.status).toBe(423)
    expect(await res.json()).toEqual({ error: 'Held by Asha' })
    expect(withTransaction).not.toHaveBeenCalled()
  })

  it('deletes the draft row, closes its lock and announces it', async () => {
    vi.mocked(canDiscard).mockResolvedValue({ ok: true } as any)
    const client = { query: vi.fn().mockResolvedValue({ rowCount: 1 }) }
    vi.mocked(withTransaction).mockImplementation(async (fn: any) => fn(client))
    vi.mocked(closeDraftLockTx).mockResolvedValue({ closed: true } as any)
    const res = await del()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(client.query).toHaveBeenCalledWith('DELETE FROM ads_campaign_drafts WHERE id = $1', [ID])
    expect(closeDraftLockTx).toHaveBeenCalledWith(client, ACTOR, 'google_ads_campaign', ID, 'discarded')
    expect(announceDraftClosed).toHaveBeenCalledWith(ACTOR, 'google_ads_campaign', ID, { closed: true }, 'discarded')
  })

  it('does not close a lock when no row was deleted', async () => {
    vi.mocked(canDiscard).mockResolvedValue({ ok: true } as any)
    const client = { query: vi.fn().mockResolvedValue({ rowCount: 0 }) }
    vi.mocked(withTransaction).mockImplementation(async (fn: any) => fn(client))
    expect((await del()).status).toBe(200)
    expect(closeDraftLockTx).not.toHaveBeenCalled()
  })
})
