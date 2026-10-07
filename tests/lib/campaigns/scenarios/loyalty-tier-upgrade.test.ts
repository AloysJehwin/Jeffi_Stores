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
vi.mock('@/lib/loyalty/settings', () => ({ getLoyaltySettings: vi.fn() }))

import { loyaltyTierUpgrade } from '@/lib/campaigns/scenarios/loyalty-tier-upgrade'
import { queryMany } from '@/lib/shared/db'
import { fetchUserContext, sendCampaignEmail } from '@/lib/shared/automation-emails'
import { sendCampaignWhatsApp } from '@/lib/campaigns/whatsapp-dispatch'
import { getLoyaltySettings } from '@/lib/loyalty/settings'
import { days } from '@/lib/campaigns/duration'

const mockQueryMany = queryMany as ReturnType<typeof vi.fn>
const mockFetchUser = fetchUserContext as ReturnType<typeof vi.fn>
const mockSendEmail = sendCampaignEmail as ReturnType<typeof vi.fn>
const mockSendWa = sendCampaignWhatsApp as ReturnType<typeof vi.fn>
const mockSettings = getLoyaltySettings as ReturnType<typeof vi.fn>

const campaign = {
  kind: 'loyalty_tier_upgrade',
  enabled: true,
  name: 'Loyalty',
  coupon_id: null,
  discount_percent: 0,
  delay_hours: 0,
  parameters: {},
} as any
const defaultParams = loyaltyTierUpgrade.defaultParams
const goldRow = { user_id: 'u1', tier: 'gold', points: 500 }

describe('loyaltyTierUpgrade scenario', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSettings.mockResolvedValue({ enabled: true })
    mockQueryMany.mockResolvedValue([])
  })

  it('has kind loyalty_tier_upgrade', () => {
    expect(loyaltyTierUpgrade.kind).toBe('loyalty_tier_upgrade')
  })

  it('recentWindow default is canonical minutes and typed as duration', () => {
    expect(defaultParams.recentWindow).toBe(days(7))
    expect(loyaltyTierUpgrade.paramSchema.recentWindow.type).toBe('duration')
    expect((loyaltyTierUpgrade.paramSchema.recentWindow as any).recommendedUnit).toBe('days')
  })

  describe('findEligible', () => {
    it('finds nobody while the loyalty program is off', async () => {
      mockSettings.mockResolvedValue({ enabled: false })
      expect(await loyaltyTierUpgrade.findEligible({ campaign, params: defaultParams })).toEqual([])
      expect(mockQueryMany).not.toHaveBeenCalled()
    })

    it('passes the campaign, the recent window in minutes and the sweep limit', async () => {
      mockQueryMany.mockResolvedValue([goldRow])
      const rows = await loyaltyTierUpgrade.findEligible({ campaign, params: defaultParams })
      expect(rows).toHaveLength(1)
      expect(mockQueryMany.mock.calls[0][1]).toEqual([
        'loyalty_tier_upgrade',
        String(days(7)),
        defaultParams.maxRecipientsPerSweep,
      ])
    })

    it('congratulates a customer once per tier, with no window that lets it repeat', async () => {
      await loyaltyTierUpgrade.findEligible({ campaign, params: defaultParams })
      const sql = String(mockQueryMany.mock.calls[0][0])
      const dedupe = sql.slice(sql.indexOf('NOT EXISTS'), sql.indexOf('ORDER BY'))
      expect(dedupe).toContain('ecs.reference_id = la.tier')
      expect(dedupe).not.toContain('sent_at')
    })

    it('needs a stamped upgrade above Bronze and takes the oldest upgrades first', async () => {
      await loyaltyTierUpgrade.findEligible({ campaign, params: defaultParams })
      const sql = String(mockQueryMany.mock.calls[0][0])
      expect(sql).toContain('la.tier_updated_at IS NOT NULL')
      expect(sql).toContain("la.tier <> 'bronze'")
      expect(sql).toContain('ORDER BY la.tier_updated_at ASC')
      expect(sql).toContain("bp.approval_status != 'approved'")
    })
  })

  describe('findSuppressed', () => {
    it('reports nobody while the loyalty program is off', async () => {
      mockSettings.mockResolvedValue({ enabled: false })
      expect(await loyaltyTierUpgrade.findSuppressed!({ campaign, params: defaultParams })).toEqual([])
      expect(mockQueryMany).not.toHaveBeenCalled()
    })

    it('lists customers already congratulated for their tier', async () => {
      mockQueryMany.mockResolvedValue([
        { user_id: 'u1', reason: 'cooldown', reason_detail: 'Already congratulated for gold', blocked_until: null },
      ])
      const rows = await loyaltyTierUpgrade.findSuppressed!({ campaign, params: defaultParams })
      expect(rows).toEqual([
        { user_id: 'u1', reason: 'cooldown', reason_detail: 'Already congratulated for gold', blocked_until: null },
      ])
      expect(mockQueryMany.mock.calls[0][1]).toEqual(['loyalty_tier_upgrade', String(days(7))])
    })
  })

  describe('send', () => {
    beforeEach(() => {
      mockFetchUser.mockResolvedValue({ first_name: 'Sam', baseUrl: 'https://shop.test', unsubscribe_token: 't' })
    })

    it('emails the tier by its display name and keys the send on the tier', async () => {
      const res = await loyaltyTierUpgrade.send(goldRow, { campaign, params: defaultParams })
      expect(res.ok).toBe(true)
      const arg = mockSendEmail.mock.calls[0][0]
      expect(arg.referenceId).toBe('gold')
      expect(arg.vars.tier).toBe('Gold')
      expect(arg.vars.points).toBe(500)
      expect(arg.vars.ctaUrl).toBe('https://shop.test/account/rewards')
    })

    it('no WhatsApp when disabled', async () => {
      await loyaltyTierUpgrade.send(goldRow, { campaign, params: defaultParams })
      expect(mockSendWa).not.toHaveBeenCalled()
    })

    it('WhatsApp names the tier properly and uses a day cooldown when enabled', async () => {
      await loyaltyTierUpgrade.send(goldRow, { campaign, params: { ...defaultParams, whatsappEnabled: true } })
      expect(mockSendWa).toHaveBeenCalledOnce()
      const [kind, userId, vars, cooldown] = mockSendWa.mock.calls[0]
      expect(kind).toBe('loyalty_tier_upgrade')
      expect(userId).toBe('u1')
      expect(vars.headline).toBe('You reached Gold!')
      expect(cooldown).toBe(1)
    })

    it('returns no_user when the user is gone', async () => {
      mockFetchUser.mockResolvedValue(null)
      const res = await loyaltyTierUpgrade.send(goldRow, { campaign, params: defaultParams })
      expect(res).toEqual({ ok: false, reason: 'no_user' })
    })
  })
})
