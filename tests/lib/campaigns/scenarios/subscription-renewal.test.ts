import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/lib/shared/db', () => ({ queryMany: vi.fn(), query: vi.fn() }))
vi.mock('@/lib/shared/automation-emails', () => ({
  APP_URL: 'https://jeffistores.com',
  fetchUserContext: vi.fn(),
  resolveCoupon: vi.fn().mockResolvedValue({ couponCode: '', discountPercent: '' }),
  sendCampaignEmail: vi.fn().mockResolvedValue({ ok: true, sentId: 's1' }),
  renderItemRows: vi.fn().mockReturnValue('<items/>'),
}))
vi.mock('@/lib/campaigns/whatsapp-dispatch', () => ({
  sendCampaignWhatsApp: vi.fn().mockResolvedValue({ ok: true }),
}))

import { subscriptionRenewal } from '@/lib/campaigns/scenarios/subscription-renewal'
import { queryMany } from '@/lib/shared/db'
import { fetchUserContext, sendCampaignEmail } from '@/lib/shared/automation-emails'
import { sendCampaignWhatsApp } from '@/lib/campaigns/whatsapp-dispatch'
import { days } from '@/lib/campaigns/duration'

const mockQueryMany = queryMany as ReturnType<typeof vi.fn>
const mockFetchUser = fetchUserContext as ReturnType<typeof vi.fn>
const mockSendEmail = sendCampaignEmail as ReturnType<typeof vi.fn>
const mockSendWa = sendCampaignWhatsApp as ReturnType<typeof vi.fn>

const campaign = {
  kind: 'subscription_renewal',
  enabled: true,
  name: 'Subscription Renewal Reminder',
  coupon_id: null,
  discount_percent: 0,
  delay_hours: 1,
  parameters: {},
} as any

const defaultParams = subscriptionRenewal.defaultParams

const subRow = {
  subscription_id: 'sub1',
  user_id: 'u1',
  product_id: 'p1',
  product_slug: 'box',
  product_name: 'Monthly Box',
  next_renewal_at: new Date(Date.now() + 2 * 86400000).toISOString(),
}

describe('subscriptionRenewal scenario', () => {
  beforeEach(() => vi.clearAllMocks())

  it('has kind subscription_renewal', () => {
    expect(subscriptionRenewal.kind).toBe('subscription_renewal')
  })

  it('windowBefore is a duration param defaulting to minutes', () => {
    expect(defaultParams.windowBefore).toBe(days(3))
    expect(subscriptionRenewal.paramSchema.windowBefore.type).toBe('duration')
  })

  describe('findEligible', () => {
    it('passes window and cooldown as minute strings', async () => {
      mockQueryMany.mockResolvedValue([subRow])
      const rows = await subscriptionRenewal.findEligible({ campaign, params: defaultParams })
      expect(rows).toHaveLength(1)
      const [, args] = mockQueryMany.mock.calls[0]
      // [kind, windowBefore, cooldown, maxRecipients]
      expect(args[0]).toBe('subscription_renewal')
      expect(args[1]).toBe(String(days(3)))
      expect(args[2]).toBe(String(days(14)))
      expect(args[3]).toBe(defaultParams.maxRecipientsPerSweep)
    })

    it('honors an overridden {value,unit} windowBefore', async () => {
      mockQueryMany.mockResolvedValue([])
      await subscriptionRenewal.findEligible({
        campaign,
        params: { ...defaultParams, windowBefore: { value: 7, unit: 'days' } } as any,
      })
      const [, args] = mockQueryMany.mock.calls[0]
      expect(args[1]).toBe(String(days(7)))
    })
  })

  describe('send', () => {
    beforeEach(() => {
      mockFetchUser.mockResolvedValue({ first_name: 'Sam', baseUrl: 'https://shop.test', unsubscribe_token: 't' })
      mockQueryMany.mockResolvedValue([{ image_url: 'img.jpg' }])
    })

    it('sends a renewal email referencing the subscription id', async () => {
      const res = await subscriptionRenewal.send(subRow, { campaign, params: defaultParams })
      expect(res.ok).toBe(true)
      const arg = mockSendEmail.mock.calls[0][0]
      expect(arg.referenceId).toBe('sub1')
      expect(arg.vars.productName).toBe('Monthly Box')
    })

    it('does not send WhatsApp when disabled', async () => {
      await subscriptionRenewal.send(subRow, { campaign, params: defaultParams })
      expect(mockSendWa).not.toHaveBeenCalled()
    })

    it('sends WhatsApp with a day-converted cooldown when enabled', async () => {
      await subscriptionRenewal.send(subRow, { campaign, params: { ...defaultParams, whatsappEnabled: true } })
      const [kind, userId, vars, cd] = mockSendWa.mock.calls[0]
      expect(kind).toBe('subscription_renewal')
      expect(userId).toBe('u1')
      expect(vars.items).toBe('Monthly Box')
      expect(cd).toBe(14)
    })

    it('returns no_user when the user is gone', async () => {
      mockFetchUser.mockResolvedValue(null)
      const res = await subscriptionRenewal.send(subRow, { campaign, params: defaultParams })
      expect(res).toEqual({ ok: false, reason: 'no_user' })
    })
  })
})
