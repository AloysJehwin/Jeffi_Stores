import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({ queryOne: vi.fn() }))
vi.mock('@/lib/admin/editor-sessions', () => ({ findOpenSession: vi.fn(), saveSession: vi.fn() }))
vi.mock('@/lib/admin/draft-locks', () => ({
  actorOf: vi.fn(() => 'actor'),
  draftLockResponse: vi.fn(),
  epochFrom: vi.fn(() => 7),
}))
vi.mock('@/lib/admin/draft-branches', () => ({ draftConflictResponse: vi.fn(), getDraftRow: vi.fn() }))
vi.mock('@/lib/admin/offer-drafts', () => ({ offerDrafts: { kind: 'offer' }, publishOfferDraft: vi.fn() }))

import { POST } from '@admin/app/api/(admin)/admin/product-offers/[id]/publish/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { queryOne } from '@/lib/shared/db'
import { findOpenSession, saveSession } from '@/lib/admin/editor-sessions'
import { draftLockResponse } from '@/lib/admin/draft-locks'
import { draftConflictResponse, getDraftRow } from '@/lib/admin/draft-branches'
import { publishOfferDraft } from '@/lib/admin/offer-drafts'

const admin = { adminId: 'a1', username: 'a', role: 'admin', scopes: [] }
const call = (qs = '?draft=d1', body: unknown = {}) =>
  POST(new NextRequest(`http://localhost/x${qs}`, { method: 'POST', body: JSON.stringify(body) }), {
    params: Promise.resolve({ id: 'of1' }),
  })

describe('POST /api/admin/product-offers/[id]/publish', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateAdmin).mockResolvedValue(admin)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(getDraftRow).mockResolvedValue({ id: 'd1', offer_id: 'of1' } as never)
    vi.mocked(publishOfferDraft).mockResolvedValue({ revision: 4 } as never)
  })

  it('returns 401 and 403', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null)
    expect((await call()).status).toBe(401)
    vi.mocked(authenticateAdmin).mockResolvedValue(admin)
    vi.mocked(hasScope).mockReturnValue(false)
    expect((await call()).status).toBe(403)
    expect(publishOfferDraft).not.toHaveBeenCalled()
  })

  it('returns 400 without a draft id', async () => {
    expect((await call('')).status).toBe(400)
  })

  it('returns 404 for a missing draft or one of another offer', async () => {
    vi.mocked(getDraftRow).mockResolvedValue(null as never)
    expect((await call()).status).toBe(404)
    vi.mocked(getDraftRow).mockResolvedValue({ id: 'd1', offer_id: 'other' } as never)
    expect((await call()).status).toBe(404)
  })

  it('publishes the draft, closes the editor session and returns the live row', async () => {
    vi.mocked(findOpenSession).mockResolvedValue({ id: 's1' } as never)
    vi.mocked(queryOne).mockResolvedValue({ id: 'of1', title: 'T' })
    const res = await call('', { draftId: 'd1', resolutions: { title: 'draft' } })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ offer: { id: 'of1', title: 'T' }, revision: 4 })
    expect(publishOfferDraft).toHaveBeenCalledWith('d1', { actor: 'actor', resolutions: { title: 'draft' }, epoch: 7 })
    expect(saveSession).toHaveBeenCalledWith('s1', 'a1')
  })

  it('skips closing a session when none is open', async () => {
    vi.mocked(findOpenSession).mockResolvedValue(null as never)
    await call()
    expect(saveSession).not.toHaveBeenCalled()
  })

  it('returns the lock or conflict response when publishing is blocked', async () => {
    vi.mocked(publishOfferDraft).mockRejectedValue(new Error('conflict'))
    vi.mocked(draftLockResponse).mockReturnValue(null as never)
    vi.mocked(draftConflictResponse).mockReturnValue(NextResponse.json({ conflicts: [] }, { status: 409 }) as never)
    expect((await call()).status).toBe(409)
    expect(saveSession).not.toHaveBeenCalled()
  })

  it('rethrows an unhandled publish failure', async () => {
    vi.mocked(publishOfferDraft).mockRejectedValue(new Error('boom'))
    vi.mocked(draftLockResponse).mockReturnValue(null as never)
    vi.mocked(draftConflictResponse).mockReturnValue(null as never)
    await expect(call()).rejects.toThrow('boom')
  })
})
