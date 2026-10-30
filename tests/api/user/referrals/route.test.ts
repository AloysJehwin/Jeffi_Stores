import { vi, describe, it, expect, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateUser: vi.fn() }))
vi.mock('@/lib/loyalty/redeem', () => ({ isLoyaltyEligible: vi.fn() }))
vi.mock('@/lib/referrals/codes', () => ({ getOrCreateReferralCode: vi.fn() }))
vi.mock('@/lib/referrals/queries', () => ({ getReferralSummary: vi.fn() }))
vi.mock('@/lib/referrals/settings', () => ({ getReferralSettings: vi.fn(), isReferralLive: vi.fn() }))

import { GET } from '@controller/app/api/(public)/user/referrals/route'
import { authenticateUser } from '@/lib/auth/jwt'
import { isLoyaltyEligible } from '@/lib/loyalty/redeem'
import { getOrCreateReferralCode } from '@/lib/referrals/codes'
import { getReferralSummary } from '@/lib/referrals/queries'
import { getReferralSettings, isReferralLive } from '@/lib/referrals/settings'

const settings = { enabled: true, rewardPoints: 100, yearlyCap: 10, qualifyDays: 90 }
const req = (q = '') => new NextRequest(`https://shop.test/api/user/referrals${q}`)

describe('GET /api/user/referrals', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateUser).mockResolvedValue({ userId: 'u1' } as any)
    vi.mocked(isReferralLive).mockResolvedValue(true)
    vi.mocked(isLoyaltyEligible).mockResolvedValue(true)
    vi.mocked(getReferralSettings).mockResolvedValue(settings)
    vi.mocked(getOrCreateReferralCode).mockResolvedValue('ASHA7K2Q')
    vi.mocked(getReferralSummary).mockResolvedValue({ counts: {}, pointsEarned: 0 } as any)
  })

  it('needs a signed-in customer', async () => {
    vi.mocked(authenticateUser).mockResolvedValue(null)
    expect((await GET(req())).status).toBe(401)
  })

  it('reports off and ineligible without creating a code', async () => {
    vi.mocked(isReferralLive).mockResolvedValue(false)
    expect(await (await GET(req())).json()).toEqual({ enabled: false })
    vi.mocked(isReferralLive).mockResolvedValue(true)
    vi.mocked(isLoyaltyEligible).mockResolvedValue(false)
    expect(await (await GET(req())).json()).toEqual({ enabled: true, eligible: false })
    expect(getOrCreateReferralCode).not.toHaveBeenCalled()
  })

  it('returns the code, the live rules and the requested page', async () => {
    const body = await (await GET(req('?page=3'))).json()
    expect(body).toMatchObject({
      enabled: true,
      eligible: true,
      code: 'ASHA7K2Q',
      program: { rewardPoints: 100, yearlyCap: 10, qualifyDays: 90 },
    })
    expect(getReferralSummary).toHaveBeenCalledWith('u1', settings, 3)
  })
})
