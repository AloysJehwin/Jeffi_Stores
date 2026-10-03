import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/lib/shared/db', () => ({ queryMany: vi.fn(), query: vi.fn() }))
vi.mock('@/lib/shared/automation-emails', () => ({
  APP_URL: 'https://jeffistores.com',
  fetchUserContext: vi.fn(),
  resolveCoupon: vi.fn().mockResolvedValue({ couponCode: 'REF5', discountPercent: '5' }),
  sendCampaignEmail: vi.fn().mockResolvedValue({ ok: true, sentId: 's1' }),
}))
vi.mock('@/lib/campaigns/whatsapp-dispatch', () => ({
  sendCampaignWhatsApp: vi.fn().mockResolvedValue({ ok: true }),
}))

import { referralInvite } from '@/lib/campaigns/scenarios/referral-invite'
import { queryMany } from '@/lib/shared/db'
import { fetchUserContext, sendCampaignEmail } from '@/lib/shared/automation-emails'
import { sendCampaignWhatsApp } from '@/lib/campaigns/whatsapp-dispatch'
import { days } from '@/lib/campaigns/duration'

const mockQueryMany = queryMany as ReturnType<typeof vi.fn>
const mockFetchUser = fetchUserContext as ReturnType<typeof vi.fn>
const mockSendEmail = sendCampaignEmail as ReturnType<typeof vi.fn>
const mockSendWa = sendCampaignWhatsApp as ReturnType<typeof vi.fn>

const campaign = { kind: 'referral_invite', enabled: true, name: 'Referral', coupon_id: null, discount_percent: 0, delay_hours: 0, parameters: {} } as any
const defaultParams = referralInvite.defaultParams

describe('referralInvite scenario', () => {
  beforeEach(() => vi.clearAllMocks())

  it('has kind referral_invite', () => {
    expect(referralInvite.kind).toBe('referral_invite')
  })

  it('sinceDelivered default is canonical minutes and typed as duration', () => {
    expect(defaultParams.sinceDelivered).toBe(days(3))
    expect(referralInvite.paramSchema.sinceDelivered.type).toBe('duration')
    expect((referralInvite.paramSchema.sinceDelivered as any).recommendedUnit).toBe('days')
  })

  describe('findEligible', () => {
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
  })

  describe('send', () => {
    beforeEach(() => {
      mockFetchUser.mockResolvedValue({ first_name: 'Sam', baseUrl: 'https://shop.test', unsubscribe_token: 't' })
    })

    it('sends the invite email', async () => {
      const res = await referralInvite.send({ user_id: 'u1' }, { campaign, params: defaultParams })
      expect(res.ok).toBe(true)
      const arg = mockSendEmail.mock.calls[0][0]
      expect(arg.referenceId).toBe(null)
      expect(arg.vars.ctaUrl).toContain('/account/referrals')
    })

    it('no WhatsApp when disabled', async () => {
      await referralInvite.send({ user_id: 'u1' }, { campaign, params: defaultParams })
      expect(mockSendWa).not.toHaveBeenCalled()
    })

    it('WhatsApp with day cooldown when enabled', async () => {
      await referralInvite.send({ user_id: 'u1' }, { campaign, params: { ...defaultParams, whatsappEnabled: true } })
      expect(mockSendWa).toHaveBeenCalledOnce()
      const [kind, userId, , cooldown] = mockSendWa.mock.calls[0]
      expect(kind).toBe('referral_invite')
      expect(userId).toBe('u1')
      expect(cooldown).toBe(1)
    })
  })
})
