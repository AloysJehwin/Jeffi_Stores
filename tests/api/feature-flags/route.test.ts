import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/catalog/site-controls', () => ({ getFeatureFlags: vi.fn() }))
vi.mock('@/lib/loyalty/settings', () => ({ getLoyaltySettings: vi.fn() }))

import { GET } from '@/app/api/(public)/feature-flags/route'
import { getFeatureFlags } from '@/lib/catalog/site-controls'
import { getLoyaltySettings } from '@/lib/loyalty/settings'

const mockFlags = getFeatureFlags as ReturnType<typeof vi.fn>
const mockLoyalty = getLoyaltySettings as ReturnType<typeof vi.fn>

describe('GET /api/feature-flags', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFlags.mockResolvedValue({ smsEnabled: true, whatsappEnabled: false, razorpayEnabled: true })
    mockLoyalty.mockResolvedValue({ enabled: true, pointValue: 1 })
  })

  it('exposes only the browser-safe flags, including whether loyalty is on', async () => {
    expect(await (await GET()).json()).toEqual({ smsEnabled: true, whatsappEnabled: false, loyaltyEnabled: true })
  })

  it('reports loyalty as off when the program is disabled', async () => {
    mockLoyalty.mockResolvedValue({ enabled: false })
    expect((await (await GET()).json()).loyaltyEnabled).toBe(false)
  })
})
