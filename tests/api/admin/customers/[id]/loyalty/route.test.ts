import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/loyalty/queries', () => ({ getLoyaltyAccount: vi.fn(), listLoyaltyLedger: vi.fn() }))
vi.mock('@/lib/loyalty/redeem', () => ({ adjustPoints: vi.fn(), isLoyaltyEligible: vi.fn() }))
vi.mock('@/lib/loyalty/settings', () => ({ getLoyaltySettings: vi.fn() }))

import { GET, POST } from '@/app/api/(admin)/admin/customers/[id]/loyalty/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { getLoyaltyAccount, listLoyaltyLedger } from '@/lib/loyalty/queries'
import { adjustPoints, isLoyaltyEligible } from '@/lib/loyalty/redeem'
import { getLoyaltySettings } from '@/lib/loyalty/settings'

const mockAuth = authenticateAdmin as ReturnType<typeof vi.fn>
const mockHasScope = hasScope as ReturnType<typeof vi.fn>
const mockAccount = getLoyaltyAccount as ReturnType<typeof vi.fn>
const mockLedger = listLoyaltyLedger as ReturnType<typeof vi.fn>
const mockAdjust = adjustPoints as ReturnType<typeof vi.fn>
const mockEligible = isLoyaltyEligible as ReturnType<typeof vi.fn>
const mockSettings = getLoyaltySettings as ReturnType<typeof vi.fn>

const CUSTOMER = '3f2a1c9e-4b7d-4e2a-9c1f-5a6b7c8d9e0f'
const URL = `http://localhost/api/admin/customers/${CUSTOMER}/loyalty`
const params = (id = CUSTOMER) => ({ params: Promise.resolve({ id }) })

function post(body: unknown) {
  return new NextRequest(URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('/api/admin/customers/[id]/loyalty', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue({ adminId: 'a1', role: 'admin', scopes: [] })
    mockHasScope.mockReturnValue(true)
    mockSettings.mockResolvedValue({ enabled: true })
    mockEligible.mockResolvedValue(true)
    mockAccount.mockResolvedValue({ points: 150, lifetimePoints: 420, tier: 'silver', tierUpdatedAt: null })
    mockLedger.mockResolvedValue({
      items: [{ id: 'l1', delta: 42, reason: 'order_earn', note: null }],
      total: 1,
      page: 1,
      pageSize: 20,
    })
    mockAdjust.mockResolvedValue({ ok: true, points: 200, lifetimePoints: 470, tier: 'silver' })
  })

  describe('GET', () => {
    it('needs an admin who can read customers', async () => {
      mockAuth.mockResolvedValueOnce(null)
      expect((await GET(new NextRequest(URL), params())).status).toBe(401)
      mockHasScope.mockReturnValue(false)
      expect((await GET(new NextRequest(URL), params())).status).toBe(403)
      expect(mockHasScope).toHaveBeenCalledWith('admin', [], 'customers:read')
    })

    it('answers 404 for an id that is not a customer id', async () => {
      expect((await GET(new NextRequest(URL), params('not-a-uuid'))).status).toBe(404)
      expect(mockAccount).not.toHaveBeenCalled()
    })

    it('returns the account with its tier name and recent history', async () => {
      const body = await (await GET(new NextRequest(URL), params())).json()
      expect(body).toMatchObject({ enabled: true, eligible: true })
      expect(body.account).toMatchObject({ points: 150, lifetimePoints: 420, tier: 'silver', tierName: 'Silver' })
      expect(body.ledger).toHaveLength(1)
      expect(mockLedger).toHaveBeenCalledWith(CUSTOMER, 1, 20)
    })
  })

  describe('POST', () => {
    it('needs an admin who can write customers', async () => {
      mockAuth.mockResolvedValueOnce(null)
      expect((await POST(post({ delta: 50, note: 'x' }), params())).status).toBe(401)
      mockHasScope.mockReturnValue(false)
      expect((await POST(post({ delta: 50, note: 'x' }), params())).status).toBe(403)
      expect(mockHasScope).toHaveBeenCalledWith('admin', [], 'customers:write')
      expect(mockAdjust).not.toHaveBeenCalled()
    })

    it('rejects a missing note or a fractional amount before touching points', async () => {
      expect((await POST(post({ delta: 50 }), params())).status).toBe(400)
      expect((await POST(post({ delta: 50, note: '   ' }), params())).status).toBe(400)
      expect((await POST(post({ delta: 1.5, note: 'x' }), params())).status).toBe(400)
      expect(mockAdjust).not.toHaveBeenCalled()
    })

    it('adjusts as the signed-in admin and returns the refreshed view', async () => {
      const res = await POST(post({ delta: 50, note: ' Goodwill ', adminId: 'forged' }), params())
      expect(res.status).toBe(200)
      expect(mockAdjust).toHaveBeenCalledWith({ userId: CUSTOMER, delta: 50, note: 'Goodwill', adminId: 'a1' })
      expect((await res.json()).account.tierName).toBe('Silver')
    })

    it('explains each refusal', async () => {
      const cases = [
        { reason: 'disabled', status: 409 },
        { reason: 'not_eligible', status: 400 },
        { reason: 'invalid_delta', status: 400 },
      ]
      for (const { reason, status } of cases) {
        mockAdjust.mockResolvedValue({ ok: false, reason })
        const res = await POST(post({ delta: 50, note: 'x' }), params())
        expect(res.status).toBe(status)
        expect((await res.json()).reason).toBe(reason)
      }
    })

    it('answers 500 when the adjustment throws', async () => {
      mockAdjust.mockRejectedValue(new Error('db down'))
      expect((await POST(post({ delta: 50, note: 'x' }), params())).status).toBe(500)
    })
  })
})
