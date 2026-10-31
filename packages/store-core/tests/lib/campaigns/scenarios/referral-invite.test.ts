import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/lib/shared/db', () => ({ queryMany: vi.fn(), query: vi.fn() }))
vi.mock('@/lib/shared/automation-emails', () => ({
  APP_URL: 'https://jeffistores.com',
  fetchUserContext: vi.fn(),
  sendCampaignEmail: vi.fn().mockResolvedValue({ ok: true, sentId: 's1' }),
}))
vi.mock('@/lib/campaigns/whatsapp-dispatch', () => ({
  sendCampaignWhatsApp: vi.fn().mockResolvedValue({ ok: true }),
}))
vi.mock('@/lib/referrals/codes', () => ({ getOrCreateReferralCode: vi.fn() }))
vi.mock('@/lib/referrals/settings', () => ({ getReferralSettings: vi.fn(), isReferralLive: vi.fn() }))

import { referralInvite } from '@/lib/campaigns/scenarios/referral-invite'
import { queryMany } from '@/lib/shared/db'
import { fetchUserContext, sendCampaignEmail } from '@/lib/shared/automation-emails'
import { sendCampaignWhatsApp } from '@/lib/campaigns/whatsapp-dispatch'
import { getOrCreateReferralCode } from '@/lib/referrals/codes'
import { getReferralSettings, isReferralLive } from '@/lib/referrals/settings'
import { days } from '@/lib/campaigns/duration'

const mockQueryMany = queryMany as ReturnType<typeof vi.fn>
const mockFetchUser = fetchUserContext as ReturnType<typeof vi.fn>
const mockSendEmail = sendCampaignEmail as ReturnType<typeof vi.fn>
const mockSendWa = sendCampaignWhatsApp as ReturnType<typeof vi.fn>
const mockCode = getOrCreateReferralCode as ReturnType<typeof vi.fn>
const mockLive = isReferralLive as ReturnType<typeof vi.fn>

const campaign = {
  kind: 'referral_invite',
  enabled: true,
  name: 'Referral',
  coupon_id: null,
  discount_percent: 0,
  delay_hours: 0,
  parameters: {},
} as any
const defaultParams = referralInvite.defaultParams

describe('referralInvite scenario', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockLive.mockResolvedValue(true)
    mockQueryMany.mockResolvedValue([])
    mockCode.mockResolvedValue('SAM7K2QX')
    vi.mocked(getReferralSettings).mockResolvedValue({
      enabled: true,
      rewardPoints: 100,
      yearlyCap: 10,
      qualifyDays: 90,
    })
  })

  it('has kind referral_invite', () => {
    expect(referralInvite.kind).toBe('referral_invite')
  })

  it('sinceDelivered default is canonical minutes and typed as duration', () => {
    expect(defaultParams.sinceDelivered).toBe(days(3))
    expect(referralInvite.paramSchema.sinceDelivered.type).toBe('duration')
    expect((referralInvite.paramSchema.sinceDelivered as any).recommendedUnit).toBe('days')
  })

  describe('findEligible', () => {
    it('finds nobody, and reports no one suppressed, while referrals are off', async () => {
      mockLive.mockResolvedValue(false)
      expect(await referralInvite.findEligible({ campaign, params: defaultParams })).toEqual([])
      expect(await referralInvite.findSuppressed!({ campaign, params: defaultParams })).toEqual([])
      expect(mockQueryMany).not.toHaveBeenCalled()
    })

    it('passes delivery delay and cooldown as minute strings', async () => {
      mockQueryMany.mockResolvedValue([{ user_id: 'u1' }])
      const rows = await referralInvite.findEligible({ campaign, params: defaultParams })
      expect(rows).toHaveLength(1)
      const [, args] = mockQueryMany.mock.calls[0]
      expect(args[0]).toBe('referral_invite')
      expect(args[1]).toBe(String(days(3)))
      expect(args[2]).toBe(String(days(1)))
      expect(args[3]).toBe(defaultParams.maxRecipientsPerSweep)
    })

    it('skips only customers who already earned a referral reward, not ones who merely have a code', async () => {
      await referralInvite.findEligible({ campaign, params: defaultParams })
      const sql = String(mockQueryMany.mock.calls[0][0])
      expect(sql).toContain("rs.referrer_user_id = u.id AND rs.status = 'rewarded'")
      expect(sql).not.toContain('FROM referrals r')
    })
  })

  describe('send', () => {
    beforeEach(() => {
      mockFetchUser.mockResolvedValue({ first_name: 'Sam', baseUrl: 'https://shop.test', unsubscribe_token: 't' })
    })

    it('emails the personal share link and the reward points, with no coupon', async () => {
      const res = await referralInvite.send({ user_id: 'u1' }, { campaign, params: defaultParams })
      expect(res.ok).toBe(true)
      const arg = mockSendEmail.mock.calls[0][0]
      expect(arg.referenceId).toBe(null)
      expect(arg.vars).toEqual({
        firstName: 'Sam',
        rewardPoints: 100,
        referralCode: 'SAM7K2QX',
        shareUrl: 'https://shop.test/r/SAM7K2QX',
        ctaUrl: 'https://shop.test/account/referrals',
      })
    })

    it('does not send when the customer cannot get a code', async () => {
      mockCode.mockResolvedValue(null)
      expect(await referralInvite.send({ user_id: 'u1' }, { campaign, params: defaultParams })).toEqual({
        ok: false,
        reason: 'no_referral_code',
      })
      expect(mockSendEmail).not.toHaveBeenCalled()
    })

    it('no WhatsApp when disabled', async () => {
      await referralInvite.send({ user_id: 'u1' }, { campaign, params: defaultParams })
      expect(mockSendWa).not.toHaveBeenCalled()
    })

    it('WhatsApp carries the link in the headline, no coupon, with a day cooldown', async () => {
      await referralInvite.send({ user_id: 'u1' }, { campaign, params: { ...defaultParams, whatsappEnabled: true } })
      expect(mockSendWa).toHaveBeenCalledOnce()
      const [kind, userId, vars, cooldown] = mockSendWa.mock.calls[0]
      expect(kind).toBe('referral_invite')
      expect(userId).toBe('u1')
      expect(vars).toEqual({
        headline: 'Refer a friend and earn 100 points: https://shop.test/r/SAM7K2QX',
        code: '',
        discount: '',
      })
      expect(cooldown).toBe(days(1))
    })
  })
})
