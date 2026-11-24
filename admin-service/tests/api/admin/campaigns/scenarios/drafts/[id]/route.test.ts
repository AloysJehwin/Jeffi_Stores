import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({ query: vi.fn(), queryOne: vi.fn(), withTransaction: vi.fn() }))
vi.mock('@/lib/admin/draft-locks', () => ({
  actorOf: vi.fn((a: any) => ({ adminId: a.adminId })),
  announceDraftClosed: vi.fn(),
  canDiscard: vi.fn(),
  closeDraftLockTx: vi.fn(),
  draftLockChips: vi.fn(),
  draftLockResponse: vi.fn(),
  epochFrom: vi.fn(() => 2),
  withDraftCreate: vi.fn(),
  withDraftWrite: vi.fn(),
}))

import { GET, PATCH, DELETE } from '@admin/app/api/(admin)/admin/campaigns/scenarios/drafts/[id]/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { queryOne, withTransaction } from '@/lib/shared/db'
import { announceDraftClosed, canDiscard, closeDraftLockTx, draftLockResponse, withDraftWrite } from '@/lib/admin/draft-locks'

const ID = '11111111-1111-4111-8111-111111111111'
const ctx = (id = ID) => ({ params: Promise.resolve({ id }) })
const req = (method: string, body?: unknown) => new NextRequest('http://localhost/x', { method, body: body === undefined ? undefined : JSON.stringify(body) })

describe('campaigns/scenarios/drafts/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a1', role: 'manager', scopes: [] } as any)
    vi.mocked(draftLockResponse).mockReturnValue(null as any)
  })

  it('relays scope rejections', async () => {
    vi.mocked(requireAdminScope).mockResolvedValue(NextResponse.json({ error: 'no' }, { status: 403 }))
    expect((await GET(req('GET'), ctx())).status).toBe(403)
    expect(requireAdminScope).toHaveBeenLastCalledWith(expect.anything(), 'campaigns:read')
    expect((await PATCH(req('PATCH', {}), ctx())).status).toBe(403)
    expect((await DELETE(req('DELETE'), ctx())).status).toBe(403)
    expect(requireAdminScope).toHaveBeenLastCalledWith(expect.anything(), 'campaigns:write')
  })

  it('GET returns the draft, 404 for unknown or non-uuid ids', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce({ id: ID, fields: {} })
    expect(await (await GET(req('GET'), ctx())).json()).toEqual({ draft: { id: ID, fields: {} } })
    vi.mocked(queryOne).mockResolvedValueOnce(null)
    expect((await GET(req('GET'), ctx())).status).toBe(404)
    expect((await GET(req('GET'), ctx('nope'))).status).toBe(404)
  })

  it('PATCH 404s on a bad id and 400s on invalid fields', async () => {
    expect((await PATCH(req('PATCH', {}), ctx('nope'))).status).toBe(404)
    expect((await PATCH(req('PATCH', { fields: [1] }), ctx())).status).toBe(400)
    expect((await PATCH(req('PATCH', { title: 3 }), ctx())).status).toBe(400)
  })

  it('PATCH saves under the write lock with the epoch', async () => {
    vi.mocked(withDraftWrite).mockResolvedValue({ rowCount: 1 } as any)
    expect(await (await PATCH(req('PATCH', { title: 'T', fields: { a: 1 } }), ctx())).json()).toEqual({ ok: true })
    expect(withDraftWrite).toHaveBeenCalledWith({ adminId: 'a1' }, 'scenario', ID, expect.any(Function), { epoch: 2 })
    const db = { query: vi.fn() }
    await vi.mocked(withDraftWrite).mock.calls[0][3](db as any)
    expect(db.query.mock.calls[0][1]).toEqual([ID, true, 'T', JSON.stringify({ a: 1 })])
  })

  it('PATCH 404s when the row is gone and 423s when locked', async () => {
    vi.mocked(withDraftWrite).mockResolvedValueOnce({ rowCount: 0 } as any)
    expect((await PATCH(req('PATCH', {}), ctx())).status).toBe(404)
    vi.mocked(withDraftWrite).mockRejectedValueOnce(new Error('locked'))
    vi.mocked(draftLockResponse).mockReturnValueOnce(NextResponse.json({}, { status: 423 }) as any)
    expect((await PATCH(req('PATCH', {}), ctx())).status).toBe(423)
  })

  it('DELETE ignores a non-uuid, refuses with 423, and otherwise deletes the row', async () => {
    expect((await DELETE(req('DELETE'), ctx('nope'))).status).toBe(200)
    vi.mocked(canDiscard).mockResolvedValueOnce({ ok: false, error: { body: () => ({ error: 'held' }) } } as any)
    const refused = await DELETE(req('DELETE'), ctx())
    expect(refused.status).toBe(423)
    expect(await refused.json()).toEqual({ error: 'held' })
    expect(withTransaction).not.toHaveBeenCalled()

    vi.mocked(canDiscard).mockResolvedValue({ ok: true } as any)
    const client = { query: vi.fn().mockResolvedValue({ rowCount: 1 }) }
    vi.mocked(withTransaction).mockImplementation((async (fn: any) => fn(client)) as any)
    vi.mocked(closeDraftLockTx).mockResolvedValue({ closed: true } as any)
    expect(await (await DELETE(req('DELETE'), ctx())).json()).toEqual({ ok: true })
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM scenario_drafts'), [ID])
    expect(announceDraftClosed).toHaveBeenCalledWith({ adminId: 'a1' }, 'scenario', ID, { closed: true }, 'discarded')
  })
})
