import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/lib/shared/db', () => ({ queryMany: vi.fn(), query: vi.fn() }))
vi.mock('@/lib/shared/automation-emails', () => ({
  APP_URL: 'https://jeffistores.com',
  fetchUserContext: vi.fn(),
  resolveCoupon: vi.fn().mockResolvedValue({ couponCode: 'VIP10', discountPercent: '10' }),
  sendCampaignEmail: vi.fn().mockResolvedValue({ ok: true, sentId: 's1' }),
}))
vi.mock('@/lib/campaigns/whatsapp-dispatch', () => ({
  sendCampaignWhatsApp: vi.fn().mockResolvedValue({ ok: true }),
}))

import { loyaltyTierUpgrade } from '@/lib/campaigns/scenarios/loyalty-tier-upgrade'
import { queryMany } from '@/lib/shared/db'
import { fetchUserContext, sendCampaignEmail } from '@/lib/shared/automation-emails'
import { sendCampaignWhatsApp } from '@/lib/campaigns/whatsapp-dispatch'
import { days } from '@/lib/campaigns/duration'

const mockQueryMany = queryMany as ReturnType<typeof vi.fn>
const mockFetchUser = fetchUserContext as ReturnType<typeof vi.fn>
const mockSendEmail = sendCampaignEmail as ReturnType<typeof vi.fn>
const mockSendWa = sendCampaignWhatsApp as ReturnType<typeof vi.fn>

const campaign = { kind: 'loyalty_tier_upgrade', enabled: true, name: 'Loyalty', coupon_id: null, discount_percent: 0, delay_hours: 0, parameters: {} } as any
const defaultParams = loyaltyTierUpgrade.defaultParams

describe('loyaltyTierUpgrade scenario', () => {
  beforeEach(() => vi.clearAllMocks())

  it('has kind loyalty_tier_upgrade', () => {
    expect(loyaltyTierUpgrade.kind).toBe('loyalty_tier_upgrade')
  })

  it('recentWindow default is canonical minutes and typed as duration', () => {
    expect(defaultParams.recentWindow).toBe(days(7))
    expect(loyaltyTierUpgrade.paramSchema.recentWindow.type).toBe('duration')
    expect((loyaltyTierUpgrade.paramSchema.recentWindow as any).recommendedUnit).toBe('days')
  })

  describe('findEligible', () => {
    it('passes recent window and cooldown as minute strings', async () => {
      mockQueryMany.mockResolvedValue([{ user_id: 'u1', tier: 'gold', points: 500 }])
      const rows = await loyaltyTierUpgrade.findEligible({ campaign, params: defaultParams })
      expect(rows).toHaveLength(1)
      const [, args] = mockQueryMany.mock.calls[0]
      expect(args[0]).toBe('loyalty_tier_upgrade')
      expect(args[1]).toBe(String(days(7)))
      expect(args[2]).toBe(String(days(1))) // cooldown default
      expect(args[3]).toBe(defaultParams.maxRecipientsPerSweep)
    })
  })

  describe('send', () => {
    beforeEach(() => {
      mockFetchUser.mockResolvedValue({ first_name: 'Sam', baseUrl: 'https://shop.test', unsubscribe_token: 't' })
    })

    it('emails with the tier as the reference id', async () => {
      const res = await loyaltyTierUpgrade.send({ user_id: 'u1', tier: 'gold', points: 500 }, { campaign, params: defaultParams })
      expect(res.ok).toBe(true)
      const arg = mockSendEmail.mock.calls[0][0]
      expect(arg.referenceId).toBe('gold')
      expect(arg.vars.tier).toBe('gold')
      expect(arg.vars.points).toBe(500)
    })

    it('no WhatsApp when disabled', async () => {
      await loyaltyTierUpgrade.send({ user_id: 'u1', tier: 'gold', points: 500 }, { campaign, params: defaultParams })
      expect(mockSendWa).not.toHaveBeenCalled()
    })

    it('WhatsApp with day cooldown when enabled', async () => {
      await loyaltyTierUpgrade.send({ user_id: 'u1', tier: 'gold', points: 500 }, { campaign, params: { ...defaultParams, whatsappEnabled: true } })
      expect(mockSendWa).toHaveBeenCalledOnce()
      const [kind, userId, , cooldown] = mockSendWa.mock.calls[0]
      expect(kind).toBe('loyalty_tier_upgrade')
      expect(userId).toBe('u1')
      expect(cooldown).toBe(1)
    })

    it('returns no_user when the user is gone', async () => {
      mockFetchUser.mockResolvedValue(null)
      const res = await loyaltyTierUpgrade.send({ user_id: 'u1', tier: 'gold', points: 500 }, { campaign, params: defaultParams })
      expect(res).toEqual({ ok: false, reason: 'no_user' })
    })
  })
})
