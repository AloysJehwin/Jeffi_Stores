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
  epochFrom: vi.fn(),
  withDraftCreate: vi.fn(),
  withDraftWrite: vi.fn(),
}))

import { GET, POST } from '@admin/app/api/(admin)/admin/campaigns/scenarios/drafts/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { query, queryOne } from '@/lib/shared/db'
import { draftLockChips, withDraftCreate } from '@/lib/admin/draft-locks'

const get = () => new NextRequest('http://localhost/api/admin/campaigns/scenarios/drafts')
const post = (body: unknown) => new NextRequest('http://localhost/api/admin/campaigns/scenarios/drafts', { method: 'POST', body: JSON.stringify(body) })

describe('campaigns/scenarios/drafts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a1', role: 'manager', scopes: [] } as any)
    vi.mocked(draftLockChips).mockResolvedValue({})
  })

  it('GET and POST relay a scope rejection (read / write scope)', async () => {
    vi.mocked(requireAdminScope).mockResolvedValue(NextResponse.json({ error: 'no' }, { status: 403 }))
    expect((await GET(get())).status).toBe(403)
    expect(requireAdminScope).toHaveBeenLastCalledWith(expect.anything(), 'campaigns:read')
    expect((await POST(post({}))).status).toBe(403)
    expect(requireAdminScope).toHaveBeenLastCalledWith(expect.anything(), 'campaigns:write')
    expect(query).not.toHaveBeenCalled()
  })

  it('GET lists drafts with lock chips', async () => {
    vi.mocked(query).mockResolvedValue({ rows: [{ id: 'd1', name: 'N' }, { id: 'd2' }] } as any)
    vi.mocked(draftLockChips).mockResolvedValue({ d1: { holder: 'h' } } as any)
    const j = await (await GET(get())).json()
    expect(j.drafts).toEqual([{ id: 'd1', name: 'N', lock: { holder: 'h' } }, { id: 'd2', lock: null }])
    expect(vi.mocked(query).mock.calls[0][0]).toContain('scenario_drafts')
    expect(draftLockChips).toHaveBeenCalledWith('scenario', ['d1', 'd2'], 'a1')
  })

  it('POST 400s on a bad title or fields', async () => {
    expect((await POST(post({ title: 5 }))).status).toBe(400)
    expect((await POST(post({ fields: [] }))).status).toBe(400)
  })

  it('POST 409s at the per-admin cap', async () => {
    vi.mocked(queryOne).mockResolvedValue({ n: 50 })
    expect((await POST(post({}))).status).toBe(409)
    expect(withDraftCreate).not.toHaveBeenCalled()
  })

  it('POST creates the draft (201) and inserts the blob', async () => {
    vi.mocked(queryOne).mockResolvedValue({ n: 1 })
    const res = await POST(post({ title: ' My draft ', fields: { step: 'describe' } }))
    expect(res.status).toBe(201)
    const id = (await res.json()).id
    expect(withDraftCreate).toHaveBeenCalledWith({ adminId: 'a1' }, 'scenario', id, expect.any(Function))
    const db = { query: vi.fn() }
    await vi.mocked(withDraftCreate).mock.calls[0][3](db as any)
    expect(db.query.mock.calls[0][1]).toEqual([id, 'a1', 'My draft', JSON.stringify({ step: 'describe' })])
  })
})
