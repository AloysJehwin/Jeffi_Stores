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

import { loyaltyPointsReminder } from '@/lib/campaigns/scenarios/loyalty-points-reminder'
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
  kind: 'loyalty_points_reminder',
  enabled: true,
  name: 'Loyalty reminder',
  coupon_id: null,
  discount_percent: 0,
  delay_hours: 0,
  parameters: {},
} as any
const defaultParams = loyaltyPointsReminder.defaultParams
const settings = { enabled: true, minRedeemPoints: 100, pointValue: 1 }
const row = { user_id: 'u1', tier: 'silver', points: 320 }

describe('loyaltyPointsReminder scenario', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSettings.mockResolvedValue(settings)
    mockQueryMany.mockResolvedValue([])
  })

  it('has kind loyalty_points_reminder', () => {
    expect(loyaltyPointsReminder.kind).toBe('loyalty_points_reminder')
  })

  describe('findEligible', () => {
    it('finds nobody while the loyalty program is off', async () => {
      mockSettings.mockResolvedValue({ enabled: false })
      expect(await loyaltyPointsReminder.findEligible({ campaign, params: defaultParams })).toEqual([])
      expect(mockQueryMany).not.toHaveBeenCalled()
    })

    it('gates on the minimum redemption from settings and the sweep limit', async () => {
      mockQueryMany.mockResolvedValue([row])
      const rows = await loyaltyPointsReminder.findEligible({ campaign, params: defaultParams })
      expect(rows).toHaveLength(1)
      const [, args] = mockQueryMany.mock.calls[0]
      expect(args[0]).toBe('loyalty_points_reminder')
      expect(args[1]).toBe(100)
      expect(args[3]).toBe(defaultParams.maxRecipientsPerSweep)
      const sql = String(mockQueryMany.mock.calls[0][0])
      expect(sql).toContain('la.points >= $2::int')
      expect(sql).toContain('ORDER BY la.points DESC')
      expect(sql).toContain("bp.approval_status != 'approved'")
    })

    it('reminds at most once per cooldown window', async () => {
      await loyaltyPointsReminder.findEligible({
        campaign,
        params: { ...defaultParams, sendCooldown: { value: 14, unit: 'days' } },
      })
      const sql = String(mockQueryMany.mock.calls[0][0])
      const dedupe = sql.slice(sql.indexOf('NOT EXISTS'), sql.indexOf('ORDER BY'))
      expect(dedupe).toContain('ecs.sent_at >')
      expect(mockQueryMany.mock.calls[0][1][2]).toBe(String(days(14)))
    })
  })

  describe('findSuppressed', () => {
    it('reports nobody while the loyalty program is off', async () => {
      mockSettings.mockResolvedValue({ enabled: false })
      expect(await loyaltyPointsReminder.findSuppressed!({ campaign, params: defaultParams })).toEqual([])
      expect(mockQueryMany).not.toHaveBeenCalled()
    })

    it('lists customers reminded within the cooldown window', async () => {
      mockQueryMany.mockResolvedValue([
        {
          user_id: 'u1',
          reason: 'cooldown',
          reason_detail: 'Reminded within the cooldown window',
          blocked_until: null,
        },
      ])
      const rows = await loyaltyPointsReminder.findSuppressed!({ campaign, params: defaultParams })
      expect(rows[0]).toMatchObject({ user_id: 'u1', reason: 'cooldown' })
      expect(mockQueryMany.mock.calls[0][1][2]).toBe(100)
    })
  })

  describe('send', () => {
    beforeEach(() => {
      mockFetchUser.mockResolvedValue({ first_name: 'Sam', baseUrl: 'https://shop.test', unsubscribe_token: 't' })
    })

    it('emails the balance and what it is worth, pointing at the rewards page', async () => {
      const res = await loyaltyPointsReminder.send(row, { campaign, params: defaultParams })
      expect(res.ok).toBe(true)
      const arg = mockSendEmail.mock.calls[0][0]
      expect(arg.referenceId).toBeNull()
      expect(arg.vars.points).toBe(320)
      expect(arg.vars.pointsWorth).toBe(320)
      expect(arg.vars.ctaUrl).toBe('https://shop.test/account/rewards')
    })

    it('no WhatsApp when disabled', async () => {
      await loyaltyPointsReminder.send(row, { campaign, params: defaultParams })
      expect(mockSendWa).not.toHaveBeenCalled()
    })

    it('sends WhatsApp with a day cooldown when enabled', async () => {
      await loyaltyPointsReminder.send(row, { campaign, params: { ...defaultParams, whatsappEnabled: true } })
      expect(mockSendWa).toHaveBeenCalledOnce()
      const [kind, userId, , cooldown] = mockSendWa.mock.calls[0]
      expect(kind).toBe('loyalty_points_reminder')
      expect(userId).toBe('u1')
      expect(cooldown).toBe(days(1))
    })

    it('returns no_user when the user is gone', async () => {
      mockFetchUser.mockResolvedValue(null)
      const res = await loyaltyPointsReminder.send(row, { campaign, params: defaultParams })
      expect(res).toEqual({ ok: false, reason: 'no_user' })
    })
  })
})
