import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/lib/shared/db', () => ({ query: vi.fn(), queryMany: vi.fn(), queryOne: vi.fn() }))
vi.mock('@/lib/loyalty/settings', () => ({
  getLoyaltySettings: vi.fn(),
  // Referral `enabled` now also requires the plan to sell customer programs. Default allowed in tests.
  customerProgramsAllowed: vi.fn().mockResolvedValue(true),
}))

import {
  getReferralSettings,
  saveReferralSettings,
  isReferralLive,
  REFERRAL_DEFAULTS,
  ReferralSettingsInputSchema,
} from '@/lib/referrals/settings'
import { query, queryMany } from '@/lib/shared/db'
import { getLoyaltySettings, customerProgramsAllowed } from '@/lib/loyalty/settings'

const mockQuery = query as ReturnType<typeof vi.fn>
const mockQueryMany = queryMany as ReturnType<typeof vi.fn>
const mockLoyalty = getLoyaltySettings as ReturnType<typeof vi.fn>
const mockProgramsAllowed = customerProgramsAllowed as ReturnType<typeof vi.fn>

describe('referral settings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockProgramsAllowed.mockResolvedValue(true)
  })

  it('defaults to off, 100 points, 10 a year, 90 days', async () => {
    mockQueryMany.mockResolvedValue([])
    expect(await getReferralSettings()).toEqual({ enabled: false, rewardPoints: 100, yearlyCap: 10, qualifyDays: 90 })
  })

  it('reads stored values and falls back on anything out of range', async () => {
    mockQueryMany.mockResolvedValue([
      { key: 'referral_enabled', value: 'TRUE' },
      { key: 'referral_reward_points', value: '250' },
      { key: 'referral_yearly_cap', value: '-3' },
      { key: 'referral_qualify_days', value: '12.5' },
    ])
    expect(await getReferralSettings()).toEqual({ enabled: true, rewardPoints: 250, yearlyCap: 10, qualifyDays: 90 })
  })

  it('falls back to defaults when the read fails', async () => {
    mockQueryMany.mockRejectedValue(new Error('down'))
    expect(await getReferralSettings()).toEqual(REFERRAL_DEFAULTS)
  })

  it('saves every key in one upsert', async () => {
    await saveReferralSettings({ enabled: true, rewardPoints: 100, yearlyCap: 5, qualifyDays: 60 })
    const [sql, [keys, values]] = mockQuery.mock.calls[0]
    expect(String(sql)).toContain('ON CONFLICT (key) DO UPDATE')
    expect(keys).toEqual(['referral_enabled', 'referral_reward_points', 'referral_yearly_cap', 'referral_qualify_days'])
    expect(values).toEqual(['true', '100', '5', '60'])
  })

  it('rejects out-of-range input', () => {
    expect(ReferralSettingsInputSchema.safeParse({ enabled: true, rewardPoints: 0, yearlyCap: 10, qualifyDays: 90 }).success).toBe(false)
    expect(ReferralSettingsInputSchema.safeParse({ enabled: true, rewardPoints: 100, yearlyCap: 10, qualifyDays: 400 }).success).toBe(false)
  })

  it('forces enabled off when the plan does not include customer programs', async () => {
    mockQueryMany.mockResolvedValue([{ key: 'referral_enabled', value: 'true' }])
    mockProgramsAllowed.mockResolvedValue(false)
    expect((await getReferralSettings()).enabled).toBe(false)
  })

  it('is live only while both referrals and loyalty are on', async () => {
    mockQueryMany.mockResolvedValue([{ key: 'referral_enabled', value: 'true' }])
    mockLoyalty.mockResolvedValue({ enabled: false })
    expect(await isReferralLive()).toBe(false)
    mockLoyalty.mockResolvedValue({ enabled: true })
    expect(await isReferralLive()).toBe(true)
  })
})
