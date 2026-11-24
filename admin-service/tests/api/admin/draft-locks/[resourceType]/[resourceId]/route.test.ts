import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@jeffi/draft-locks', () => ({
  DRAFT_RESOURCES: { product: { readScope: 'products:read' }, brand: { readScope: 'brands:read' } },
  isDraftResourceType: vi.fn((t: string) => t === 'product' || t === 'brand'),
  viewers: vi.fn(),
}))
vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn(), isPlatformOwner: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({ query: vi.fn() }))
vi.mock('@/lib/admin/draft-locks', () => ({
  acquireDraftLock: vi.fn(),
  canReceiveHandover: vi.fn(),
  draftLockResponse: vi.fn(),
  getDraftLockState: vi.fn(),
  handoverCandidates: vi.fn(),
  handoverDraftLock: vi.fn(),
  releaseDraftLock: vi.fn(),
  requestDraftAccess: vi.fn(),
  takeoverDraftLock: vi.fn(),
}))
vi.mock('@/lib/admin/draft-discard', () => ({ discardDraft: vi.fn() }))

import { GET, POST, DELETE } from '@admin/app/api/(admin)/admin/draft-locks/[resourceType]/[resourceId]/route'
import { viewers } from '@jeffi/draft-locks'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope, isPlatformOwner } from '@/lib/auth/scopes'
import * as locks from '@/lib/admin/draft-locks'
import { discardDraft } from '@/lib/admin/draft-discard'

const ID = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'
const ctx = (type = 'product', id = ID) => ({ params: Promise.resolve({ resourceType: type, resourceId: id }) })
const req = (method: string, body?: unknown, qs = '') =>
  new NextRequest(`http://localhost/api/admin/draft-locks/product/${ID}${qs}`, { method, body: body === undefined ? undefined : JSON.stringify(body) })

describe('draft-locks/[resourceType]/[resourceId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateAdmin).mockResolvedValue({ adminId: 'a1', role: 'manager', scopes: [], email: 'a@x.in', first_name: 'Ann', last_name: 'Lee' } as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(isPlatformOwner).mockReturnValue(false)
    vi.mocked(locks.getDraftLockState).mockResolvedValue({ draftExists: true } as any)
    vi.mocked(locks.draftLockResponse).mockReturnValue(null as any)
    vi.mocked(viewers).mockResolvedValue([] as any)
    vi.mocked(discardDraft).mockResolvedValue({ ok: true } as any)
  })

  describe('auth and target', () => {
    const calls = { GET: () => GET(req('GET'), ctx()), POST: () => POST(req('POST', { action: 'claim' }), ctx()), DELETE: () => DELETE(req('DELETE'), ctx()) }
    for (const [name, call] of Object.entries(calls)) {
      it(`${name} 401s without a session`, async () => {
        vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
        expect((await call()).status).toBe(401)
      })
      it(`${name} 403s without the scope`, async () => {
        vi.mocked(hasScope).mockReturnValue(false)
        expect((await call()).status).toBe(403)
      })
    }
    it('rejects an invalid type or id (400 / 404 for DELETE)', async () => {
      expect((await GET(req('GET'), ctx('nope'))).status).toBe(400)
      expect((await POST(req('POST', { action: 'claim' }), ctx('product', 'bad'))).status).toBe(400)
      expect((await DELETE(req('DELETE'), ctx('nope'))).status).toBe(404)
    })
  })

  describe('GET', () => {
    it('returns state, me and viewers', async () => {
      vi.mocked(viewers).mockResolvedValue([{ adminId: 'a2' }] as any)
      expect(await (await GET(req('GET'), ctx())).json()).toEqual({ draftExists: true, me: 'a1', viewers: [{ adminId: 'a2' }] })
    })
    it('lists handover candidates only for writers', async () => {
      vi.mocked(locks.handoverCandidates).mockResolvedValue([{ id: 'a2' }] as any)
      expect(await (await GET(req('GET', undefined, '?candidates=1'), ctx())).json()).toEqual({ candidates: [{ id: 'a2' }] })
      vi.mocked(hasScope).mockImplementation(((_r: string, _s: string[], s: string) => s === 'products:read') as any)
      expect(await (await GET(req('GET', undefined, '?candidates=1'), ctx())).json()).toEqual({ candidates: [] })
    })
  })

  describe('POST', () => {
    it('400s on an invalid action', async () => {
      expect((await POST(req('POST', { action: 'explode' }), ctx())).status).toBe(400)
      expect((await POST(req('POST', { action: 'takeover', reason: 'x' }), ctx())).status).toBe(400)
    })
    it('claim 404s without a draft, else acquires', async () => {
      vi.mocked(locks.getDraftLockState).mockResolvedValueOnce({ draftExists: false } as any)
      expect((await POST(req('POST', { action: 'claim' }), ctx())).status).toBe(404)
      expect(locks.acquireDraftLock).not.toHaveBeenCalled()
      const res = await POST(req('POST', { action: 'claim' }), ctx())
      expect(res.status).toBe(200)
      expect(locks.acquireDraftLock).toHaveBeenCalledWith({ adminId: 'a1', role: 'manager', scopes: [] }, 'product', ID)
    })
    it('release releases', async () => {
      await POST(req('POST', { action: 'release' }), ctx())
      expect(locks.releaseDraftLock).toHaveBeenCalledWith(expect.objectContaining({ adminId: 'a1' }), 'product', ID, expect.anything())
    })
    it('handover rejects self and ineligible targets, else hands over', async () => {
      expect((await POST(req('POST', { action: 'handover', toAdminId: 'a1' }), ctx())).status).toBe(400)
      const self = '33333333-3333-4333-8333-333333333333'
      vi.mocked(authenticateAdmin).mockResolvedValue({ adminId: self, role: 'm', scopes: [] } as any)
      expect((await POST(req('POST', { action: 'handover', toAdminId: self }), ctx())).status).toBe(400)
      vi.mocked(locks.canReceiveHandover).mockResolvedValue(false as any)
      expect((await POST(req('POST', { action: 'handover', toAdminId: OTHER }), ctx())).status).toBe(400)
      expect(locks.handoverDraftLock).not.toHaveBeenCalled()
      vi.mocked(locks.canReceiveHandover).mockResolvedValue(true as any)
      expect((await POST(req('POST', { action: 'handover', toAdminId: OTHER }), ctx())).status).toBe(200)
      expect(locks.handoverDraftLock).toHaveBeenCalledWith(expect.anything(), 'product', ID, OTHER, expect.anything())
    })
    it('takeover is owner only', async () => {
      const body = { action: 'takeover', reason: 'urgent fix' }
      expect((await POST(req('POST', body), ctx())).status).toBe(403)
      expect(locks.takeoverDraftLock).not.toHaveBeenCalled()
      vi.mocked(isPlatformOwner).mockReturnValue(true)
      expect((await POST(req('POST', body), ctx())).status).toBe(200)
      expect(locks.takeoverDraftLock).toHaveBeenCalledWith(expect.anything(), 'product', ID, 'urgent fix', expect.anything())
    })
    it('request_access succeeds, is rate limited (429) or has no holder (409)', async () => {
      const body = { action: 'request_access', message: 'pls' }
      vi.mocked(locks.requestDraftAccess).mockResolvedValueOnce({ sent: true } as any)
      expect((await POST(req('POST', body), ctx())).status).toBe(200)
      expect(vi.mocked(locks.requestDraftAccess).mock.calls[0][0]).toMatchObject({ displayName: 'Ann Lee' })
      vi.mocked(locks.requestDraftAccess).mockResolvedValueOnce({ sent: false, reason: 'rate_limited' } as any)
      expect((await POST(req('POST', body), ctx())).status).toBe(429)
      vi.mocked(locks.requestDraftAccess).mockResolvedValueOnce({ sent: false, reason: 'no_holder' } as any)
      expect((await POST(req('POST', body), ctx())).status).toBe(409)
    })
    it('maps a lock error to its response and 500s on others', async () => {
      vi.mocked(locks.releaseDraftLock).mockRejectedValueOnce(new Error('locked'))
      vi.mocked(locks.draftLockResponse).mockReturnValueOnce(NextResponse.json({}, { status: 423 }) as any)
      expect((await POST(req('POST', { action: 'release' }), ctx())).status).toBe(423)
      vi.mocked(locks.releaseDraftLock).mockRejectedValueOnce(new Error('boom'))
      vi.spyOn(console, 'error').mockImplementation(() => {})
      expect((await POST(req('POST', { action: 'release' }), ctx())).status).toBe(500)
    })
  })

  describe('DELETE', () => {
    it('discards through the types own discard', async () => {
      const j = await (await DELETE(req('DELETE'), ctx())).json()
      expect(j).toEqual({ success: true, draftExists: true, me: 'a1' })
      expect(discardDraft).toHaveBeenCalledWith({ adminId: 'a1', role: 'manager', scopes: [] }, 'product', ID)
    })
    it('relays a refused discard', async () => {
      vi.mocked(discardDraft).mockResolvedValue({ ok: false, status: 423, body: { error: 'held' } } as any)
      const res = await DELETE(req('DELETE'), ctx())
      expect(res.status).toBe(423)
      expect(await res.json()).toEqual({ error: 'held' })
    })
    it('500s when the discard throws', async () => {
      vi.mocked(discardDraft).mockRejectedValue(new Error('boom'))
      vi.spyOn(console, 'error').mockImplementation(() => {})
      expect((await DELETE(req('DELETE'), ctx())).status).toBe(500)
    })
  })
})
