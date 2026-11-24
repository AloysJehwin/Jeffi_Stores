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

import { GET, POST } from '@admin/app/api/(admin)/admin/google-ads/campaign-drafts/route'
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

const url = 'http://localhost/api/admin/google-ads/campaign-drafts'
const get = () => GET(new NextRequest(url))
const post = (body: unknown) => POST(new NextRequest(url, { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) }))

describe('GET /api/admin/google-ads/campaign-drafts', () => {
  it('401 when not signed in', async () => {
    deny(401)
    expect((await get()).status).toBe(401)
    expect(query).not.toHaveBeenCalled()
  })

  it('403 without the google_ads:read scope', async () => {
    deny(403)
    expect((await get()).status).toBe(403)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'google_ads:read')
  })

  it('lists every draft from ads_campaign_drafts with its lock chip', async () => {
    vi.mocked(query).mockResolvedValue({ rows: [{ id: 'd1', title: 'Spring' }, { id: 'd2', title: null }] } as any)
    vi.mocked(draftLockChips).mockResolvedValue({ d1: { holder: 'Asha' } } as any)
    const res = await get()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      drafts: [{ id: 'd1', title: 'Spring', lock: { holder: 'Asha' } }, { id: 'd2', title: null, lock: null }],
    })
    expect(vi.mocked(query).mock.calls[0][0]).toContain('FROM ads_campaign_drafts')
    expect(draftLockChips).toHaveBeenCalledWith('google_ads_campaign', ['d1', 'd2'], 'a1')
  })

  it('lets a database failure surface', async () => {
    vi.mocked(query).mockRejectedValue(new Error('db down'))
    await expect(get()).rejects.toThrow('db down')
  })
})

describe('POST /api/admin/google-ads/campaign-drafts', () => {
  it('401 when not signed in', async () => {
    deny(401)
    expect((await post({})).status).toBe(401)
    expect(withDraftCreate).not.toHaveBeenCalled()
  })

  it('403 without the google_ads_campaigns:write scope', async () => {
    deny(403)
    expect((await post({})).status).toBe(403)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'google_ads_campaigns:write')
  })

  it('400 for a title or fields of the wrong type', async () => {
    expect((await post({ title: 5 })).status).toBe(400)
    expect((await post({ fields: [] })).status).toBe(400)
    expect((await post({ fields: null })).status).toBe(400)
    expect((await post({ fields: { blob: 'x'.repeat(200_001) } })).status).toBe(400)
    expect(withDraftCreate).not.toHaveBeenCalled()
  })

  it('409 once the admin already has 50 drafts', async () => {
    vi.mocked(queryOne).mockResolvedValue({ n: 50 } as any)
    const res = await post({ title: 'One more' })
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/50 campaign drafts/)
    expect(withDraftCreate).not.toHaveBeenCalled()
  })

  it('creates the draft and its lock for the admin and returns 201 with the new id', async () => {
    vi.mocked(queryOne).mockResolvedValue({ n: 2 } as any)
    const insert = vi.fn()
    vi.mocked(withDraftCreate).mockImplementation(async (_a: any, _t: any, _id: any, fn: any) => fn({ query: insert }))
    const res = await post({ title: '  Spring sale  ', fields: { step: 2 } })
    expect(res.status).toBe(201)
    const { id } = await res.json()
    expect(id).toMatch(/^[0-9a-f-]{36}$/)
    expect(withDraftCreate).toHaveBeenCalledWith(ACTOR, 'google_ads_campaign', id, expect.any(Function))
    expect(insert).toHaveBeenCalledTimes(1)
    expect(insert.mock.calls[0][0]).toContain('INSERT INTO ads_campaign_drafts')
    expect(insert.mock.calls[0][1]).toEqual([id, 'a1', 'Spring sale', '{"step":2}'])
  })

  it('creates an empty draft from an empty body', async () => {
    vi.mocked(queryOne).mockResolvedValue({ n: 0 } as any)
    const insert = vi.fn()
    vi.mocked(withDraftCreate).mockImplementation(async (_a: any, _t: any, _id: any, fn: any) => fn({ query: insert }))
    expect((await post('')).status).toBe(201)
    expect(insert.mock.calls[0][1].slice(2)).toEqual([null, '{}'])
  })
})
