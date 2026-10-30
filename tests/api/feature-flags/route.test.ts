import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/catalog/site-controls', () => ({ getFeatureFlags: vi.fn() }))
vi.mock('@/lib/loyalty/settings', () => ({ getLoyaltySettings: vi.fn() }))
vi.mock('@/lib/referrals/settings', () => ({ getReferralSettings: vi.fn() }))

import { GET } from '@controller/app/api/(public)/feature-flags/route'
import { getFeatureFlags } from '@/lib/catalog/site-controls'
import { getLoyaltySettings } from '@/lib/loyalty/settings'
import { getReferralSettings } from '@/lib/referrals/settings'

const mockFlags = getFeatureFlags as ReturnType<typeof vi.fn>
const mockLoyalty = getLoyaltySettings as ReturnType<typeof vi.fn>
const mockReferral = getReferralSettings as ReturnType<typeof vi.fn>

describe('GET /api/feature-flags', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFlags.mockResolvedValue({ smsEnabled: true, whatsappEnabled: false, razorpayEnabled: true, birthdayEnabled: true })
    mockLoyalty.mockResolvedValue({ enabled: true, pointValue: 1 })
    mockReferral.mockResolvedValue({ enabled: false })
  })

  it('exposes only the browser-safe flags, including whether loyalty is on', async () => {
    expect(await (await GET()).json()).toEqual({
      smsEnabled: true,
      whatsappEnabled: false,
      loyaltyEnabled: true,
      birthdayEnabled: true,
      referralEnabled: false,
    })
  })

  it('reports loyalty as off when the program is disabled', async () => {
    mockLoyalty.mockResolvedValue({ enabled: false })
    expect((await (await GET()).json()).loyaltyEnabled).toBe(false)
  })

  it('shows referrals only while both referrals and loyalty are on', async () => {
    mockReferral.mockResolvedValue({ enabled: true })
    expect((await (await GET()).json()).referralEnabled).toBe(true)
    mockLoyalty.mockResolvedValue({ enabled: false })
    expect((await (await GET()).json()).referralEnabled).toBe(false)
  })
})
