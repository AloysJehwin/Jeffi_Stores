import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({ query: vi.fn() }))
vi.mock('@/lib/payments/razorpay-offers', () => ({ getOffersWithSettings: vi.fn() }))
vi.mock('@/lib/shared/admin-audit', () => ({ logAdminAudit: vi.fn(() => Promise.resolve()) }))

import { GET, PATCH } from '@admin/app/api/(admin)/admin/offers/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { query } from '@/lib/shared/db'
import { getOffersWithSettings } from '@/lib/payments/razorpay-offers'
import { logAdminAudit } from '@/lib/shared/admin-audit'

const admin = { adminId: 'a1', username: 'admin', role: 'admin', scopes: [] }
const offer = { id: 'offer_1', title: 'Save 10', isVisible: true, displayOrder: 3 }
const get = () => GET(new NextRequest('http://localhost/api/admin/offers'))
const patch = (body: unknown) =>
  PATCH(new NextRequest('http://localhost/api/admin/offers', { method: 'PATCH', body: JSON.stringify(body) }))

describe('/api/admin/offers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateAdmin).mockResolvedValue(admin)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(getOffersWithSettings).mockResolvedValue({ offers: [offer], fetch: { ok: true } } as never)
  })

  describe('GET', () => {
    it('returns 401 and 403', async () => {
      vi.mocked(authenticateAdmin).mockResolvedValue(null)
      expect((await get()).status).toBe(401)
      vi.mocked(authenticateAdmin).mockResolvedValue(admin)
      vi.mocked(hasScope).mockReturnValue(false)
      expect((await get()).status).toBe(403)
      expect(hasScope).toHaveBeenLastCalledWith('admin', [], 'coupons:read')
    })

    it('lists offers with no problem when the fetch succeeded', async () => {
      const body = await (await get()).json()
      expect(body).toEqual({ offers: [offer], ok: true, problem: null })
    })

    it('reports the Razorpay fetch problem', async () => {
      vi.mocked(getOffersWithSettings).mockResolvedValue({ offers: [], fetch: { ok: false, reason: 'auth', detail: 'bad key' } } as never)
      const body = await (await get()).json()
      expect(body).toMatchObject({ ok: false, problem: { reason: 'auth', detail: 'bad key' } })
    })
  })

  describe('PATCH', () => {
    it('returns 401 and 403 (needs coupons:write)', async () => {
      vi.mocked(authenticateAdmin).mockResolvedValue(null)
      expect((await patch({ offerId: 'offer_1' })).status).toBe(401)
      vi.mocked(authenticateAdmin).mockResolvedValue(admin)
      vi.mocked(hasScope).mockReturnValue(false)
      expect((await patch({ offerId: 'offer_1' })).status).toBe(403)
      expect(hasScope).toHaveBeenLastCalledWith('admin', [], 'coupons:write')
      expect(query).not.toHaveBeenCalled()
    })

    it('returns 400 for a bad body', async () => {
      expect((await patch({})).status).toBe(400)
      expect((await patch({ offerId: 'offer_1', displayOrder: 5000 })).status).toBe(400)
    })

    it('returns 404 for an offer unknown to the account', async () => {
      expect((await patch({ offerId: 'offer_x' })).status).toBe(404)
      expect(query).not.toHaveBeenCalled()
    })

    it('upserts the display settings and audits the change', async () => {
      const res = await patch({ offerId: 'offer_1', isVisible: false, titleOverride: '  Big sale ', displayOrder: 1 })
      expect(res.status).toBe(200)
      expect(vi.mocked(query).mock.calls[0][1]).toEqual(['offer_1', false, 'Big sale', 1, 'a1'])
      expect(logAdminAudit).toHaveBeenCalledWith(expect.objectContaining({ entityId: 'offer_1', action: 'update' }))
    })

    it('falls back to the current values and clears a blank override', async () => {
      await patch({ offerId: 'offer_1', titleOverride: '  ' })
      expect(vi.mocked(query).mock.calls[0][1]).toEqual(['offer_1', true, null, 3, 'a1'])
    })

    it('propagates a database failure', async () => {
      vi.mocked(query).mockRejectedValue(new Error('db'))
      await expect(patch({ offerId: 'offer_1' })).rejects.toThrow('db')
    })
  })
})
