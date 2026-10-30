import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateUser: vi.fn() }))
vi.mock('@/lib/loyalty/settings', () => ({ getLoyaltySettings: vi.fn() }))
vi.mock('@/lib/loyalty/redeem', () => ({ isLoyaltyEligible: vi.fn() }))
vi.mock('@/lib/loyalty/reconcile', () => ({ reconcileLoyalty: vi.fn() }))
vi.mock('@/lib/loyalty/queries', () => ({ getLoyaltySummary: vi.fn() }))

import { GET } from '@controller/app/api/(public)/user/loyalty/route'
import { authenticateUser } from '@/lib/auth/jwt'
import { getLoyaltySettings } from '@/lib/loyalty/settings'
import { isLoyaltyEligible } from '@/lib/loyalty/redeem'
import { reconcileLoyalty } from '@/lib/loyalty/reconcile'
import { getLoyaltySummary } from '@/lib/loyalty/queries'

const mockAuth = authenticateUser as ReturnType<typeof vi.fn>
const mockSettings = getLoyaltySettings as ReturnType<typeof vi.fn>
const mockEligible = isLoyaltyEligible as ReturnType<typeof vi.fn>
const mockReconcile = reconcileLoyalty as ReturnType<typeof vi.fn>
const mockSummary = getLoyaltySummary as ReturnType<typeof vi.fn>

const settings = {
  enabled: true,
  rupeesPerPoint: 100,
  pointValue: 1,
  minRedeemPoints: 100,
  creditDelayDays: 7,
  tiers: [{ key: 'bronze', name: 'Bronze', minPoints: 0, multiplier: 1 }],
  countFrom: '2026-01-01',
  launchedAt: '2026-10-01T00:00:00.000Z',
}

const req = () => new NextRequest('http://localhost/api/user/loyalty')

describe('GET /api/user/loyalty', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue({ userId: 'u1', email: 'a@example.com' })
    mockSettings.mockResolvedValue(settings)
    mockEligible.mockResolvedValue(true)
    mockReconcile.mockResolvedValue({})
    mockSummary.mockResolvedValue({ points: 150, tier: { key: 'silver', name: 'Silver', multiplier: 1.25 } })
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('requires a signed-in customer', async () => {
    mockAuth.mockResolvedValue(null)
    expect((await GET(req())).status).toBe(401)
  })

  it('says the program is off without touching points', async () => {
    mockSettings.mockResolvedValue({ ...settings, enabled: false })
    const res = await GET(req())
    expect(await res.json()).toEqual({ enabled: false })
    expect(mockReconcile).not.toHaveBeenCalled()
    expect(mockSummary).not.toHaveBeenCalled()
  })

  it('tells business and guest accounts they are not eligible', async () => {
    mockEligible.mockResolvedValue(false)
    expect(await (await GET(req())).json()).toEqual({ enabled: true, eligible: false })
    expect(mockReconcile).not.toHaveBeenCalled()
  })

  it('settles the customer first, then returns the summary and the public program terms', async () => {
    const body = await (await GET(req())).json()
    expect(mockReconcile).toHaveBeenCalledWith({ userId: 'u1' })
    expect(mockReconcile.mock.invocationCallOrder[0]).toBeLessThan(mockSummary.mock.invocationCallOrder[0])
    expect(body).toMatchObject({ enabled: true, eligible: true, points: 150 })
    expect(body.program).toEqual({
      rupeesPerPoint: 100,
      pointValue: 1,
      minRedeemPoints: 100,
      creditDelayDays: 7,
      tiers: settings.tiers,
    })
    expect(body.program).not.toHaveProperty('countFrom')
  })

  it('still shows the page when settling fails', async () => {
    mockReconcile.mockRejectedValue(new Error('lock timeout'))
    const res = await GET(req())
    expect(res.status).toBe(200)
    expect((await res.json()).points).toBe(150)
  })

  it('answers 500 when the summary cannot be read', async () => {
    mockSummary.mockRejectedValue(new Error('db down'))
    expect((await GET(req())).status).toBe(500)
  })
})
