import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({ queryOne: vi.fn(), withTransaction: vi.fn() }))
vi.mock('@/lib/admin/draft-locks', () => ({
  actorOf: vi.fn((a: any) => ({ adminId: a.adminId })),
  draftLockResponse: vi.fn(),
  withDraftCreate: vi.fn(),
  withDraftWrite: vi.fn(),
}))
vi.mock('@/lib/admin/rfq-reply-drafts', () => ({ clearReplyDraft: vi.fn() }))

import { GET, PUT, DELETE } from '@admin/app/api/(admin)/admin/business/rfqs/[id]/reply-draft/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { queryOne, withTransaction } from '@/lib/shared/db'
import { draftLockResponse, withDraftCreate, withDraftWrite } from '@/lib/admin/draft-locks'
import { clearReplyDraft } from '@/lib/admin/rfq-reply-drafts'

const ID = '11111111-1111-4111-8111-111111111111'
const PID = '22222222-2222-4222-8222-222222222222'
const ctx = (id = ID) => ({ params: Promise.resolve({ id }) })
const req = (method: string, body?: unknown) => new NextRequest('http://localhost/x', { method, body: body === undefined ? undefined : JSON.stringify(body) })
const denied = () => NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

describe('business/rfqs/[id]/reply-draft', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a1', role: 'manager', scopes: [] } as any)
    vi.mocked(draftLockResponse).mockReturnValue(null as any)
  })

  it('every method relays a scope rejection with the right scope', async () => {
    vi.mocked(requireAdminScope).mockResolvedValue(denied())
    expect((await GET(req('GET'), ctx())).status).toBe(403)
    expect(requireAdminScope).toHaveBeenLastCalledWith(expect.anything(), 'business_rfqs:read')
    expect((await PUT(req('PUT', {}), ctx())).status).toBe(403)
    expect(requireAdminScope).toHaveBeenLastCalledWith(expect.anything(), 'business_rfqs:write')
    expect((await DELETE(req('DELETE'), ctx())).status).toBe(403)
    expect(queryOne).not.toHaveBeenCalled()
  })

  it('GET returns null for a non-uuid and the draft row otherwise', async () => {
    expect(await (await GET(req('GET'), ctx('nope'))).json()).toEqual({ draft: null })
    vi.mocked(queryOne).mockResolvedValue({ id: 'd1', message: 'hi' })
    expect(await (await GET(req('GET'), ctx())).json()).toEqual({ draft: { id: 'd1', message: 'hi' } })
    expect(vi.mocked(queryOne).mock.calls[0][1]).toEqual([ID, 'a1'])
  })

  it('PUT 404s for a non-uuid or unknown rfq', async () => {
    expect((await PUT(req('PUT', {}), ctx('nope'))).status).toBe(404)
    vi.mocked(queryOne).mockResolvedValueOnce(null)
    expect((await PUT(req('PUT', {}), ctx())).status).toBe(404)
  })

  it('PUT creates a draft with sanitised prices (201)', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce({ one: 1 } as any).mockResolvedValueOnce(null)
    const res = await PUT(req('PUT', { message: 'hello', counter_prices: { [PID]: 12, bad: '3', [ID]: {} }, show_counter: true }), ctx())
    expect(res.status).toBe(201)
    const draftId = (await res.json()).id
    expect(withDraftCreate).toHaveBeenCalledWith({ adminId: 'a1' }, 'rfq_reply', draftId, expect.any(Function))
    const db = { query: vi.fn() }
    await vi.mocked(withDraftCreate).mock.calls[0][3](db as any)
    expect(db.query.mock.calls[0][1]).toEqual([draftId, ID, 'a1', 'hello', JSON.stringify({ [PID]: '12' }), true])
  })

  it('PUT updates the existing draft under the write lock', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce({ one: 1 } as any).mockResolvedValueOnce({ id: 'd1' })
    const res = await PUT(req('PUT', { message: 'm' }), ctx())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ id: 'd1' })
    expect(withDraftWrite).toHaveBeenCalledWith({ adminId: 'a1' }, 'rfq_reply', 'd1', expect.any(Function))
    expect(withDraftCreate).not.toHaveBeenCalled()
  })

  it('PUT returns the lock response, or rethrows', async () => {
    vi.mocked(queryOne).mockResolvedValue({ id: 'd1' } as any)
    vi.mocked(withDraftWrite).mockRejectedValueOnce(new Error('locked'))
    vi.mocked(draftLockResponse).mockReturnValueOnce(NextResponse.json({}, { status: 423 }) as any)
    expect((await PUT(req('PUT', {}), ctx())).status).toBe(423)
    vi.mocked(withDraftWrite).mockRejectedValueOnce(new Error('boom'))
    await expect(PUT(req('PUT', {}), ctx())).rejects.toThrow('boom')
  })

  it('DELETE clears the draft in a transaction, and ignores a non-uuid', async () => {
    expect(await (await DELETE(req('DELETE'), ctx('nope'))).json()).toEqual({ ok: true })
    expect(withTransaction).not.toHaveBeenCalled()
    vi.mocked(withTransaction).mockImplementation((async (fn: any) => fn({ tx: 1 })) as any)
    expect(await (await DELETE(req('DELETE'), ctx())).json()).toEqual({ ok: true })
    expect(clearReplyDraft).toHaveBeenCalledWith({ tx: 1 }, expect.objectContaining({ adminId: 'a1' }), ID, 'discarded')
  })
})
