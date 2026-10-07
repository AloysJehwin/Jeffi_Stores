import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/lib/shared/db', () => ({ queryMany: vi.fn(), query: vi.fn() }))
vi.mock('@/lib/shared/automation-emails', () => ({
  APP_URL: 'https://jeffistores.com',
  fetchUserContext: vi.fn(),
  resolveCoupon: vi.fn().mockResolvedValue({ couponCode: 'WELCOME', discountPercent: '10' }),
  sendCampaignEmail: vi.fn().mockResolvedValue({ ok: true, sentId: 's1' }),
  renderItemRows: vi.fn().mockReturnValue('<items/>'),
}))
vi.mock('@/lib/campaigns/whatsapp-dispatch', () => ({
  sendCampaignWhatsApp: vi.fn().mockResolvedValue({ ok: true }),
}))

import { firstPurchaseNudge } from '@/lib/campaigns/scenarios/first-purchase-nudge'
import { queryMany } from '@/lib/shared/db'
import { fetchUserContext, sendCampaignEmail } from '@/lib/shared/automation-emails'
import { sendCampaignWhatsApp } from '@/lib/campaigns/whatsapp-dispatch'
import { days } from '@/lib/campaigns/duration'

const mockQueryMany = queryMany as ReturnType<typeof vi.fn>
const mockFetchUser = fetchUserContext as ReturnType<typeof vi.fn>
const mockSendEmail = sendCampaignEmail as ReturnType<typeof vi.fn>
const mockSendWa = sendCampaignWhatsApp as ReturnType<typeof vi.fn>

const campaign = {
  kind: 'first_purchase_nudge',
  enabled: true,
  name: 'First Purchase Nudge',
  coupon_id: null,
  discount_percent: 0,
  delay_hours: 1,
  parameters: {},
} as any

const defaultParams = firstPurchaseNudge.defaultParams

describe('firstPurchaseNudge scenario', () => {
  beforeEach(() => vi.clearAllMocks())

  it('has kind first_purchase_nudge', () => {
    expect(firstPurchaseNudge.kind).toBe('first_purchase_nudge')
  })

  it('default sinceSignup is canonical minutes (3 days)', () => {
    expect(defaultParams.sinceSignup).toBe(days(3))
  })

  it('sinceSignup is a duration param with recommended days', () => {
    expect(firstPurchaseNudge.paramSchema.sinceSignup.type).toBe('duration')
    expect((firstPurchaseNudge.paramSchema.sinceSignup as any).recommendedUnit).toBe('days')
  })

  describe('findEligible', () => {
    it('passes the signup window and cooldown as minute strings', async () => {
      mockQueryMany.mockResolvedValue([{ user_id: 'u1' }])
      const rows = await firstPurchaseNudge.findEligible({ campaign, params: defaultParams })
      expect(rows).toHaveLength(1)
      const [sql, args] = mockQueryMany.mock.calls[0]
      expect(sql).toContain("payment_status = 'paid'")
      expect(args[0]).toBe('first_purchase_nudge')
      expect(args[1]).toBe(String(days(3)))
      expect(args[3]).toBe(defaultParams.maxRecipientsPerSweep)
    })

    it('honors an overridden {value,unit} sinceSignup', async () => {
      mockQueryMany.mockResolvedValue([])
      await firstPurchaseNudge.findEligible({
        campaign,
        params: { ...defaultParams, sinceSignup: { value: 7, unit: 'days' } } as any,
      })
      const [, args] = mockQueryMany.mock.calls[0]
      expect(args[1]).toBe(String(days(7)))
    })
  })

  describe('send', () => {
    beforeEach(() => {
      mockFetchUser.mockResolvedValue({ first_name: 'Sam', baseUrl: 'https://shop.test', unsubscribe_token: 't' })
    })

    it('sends a welcome email with the coupon', async () => {
      const res = await firstPurchaseNudge.send({ user_id: 'u1' }, { campaign, params: defaultParams })
      expect(res.ok).toBe(true)
      expect(mockSendEmail).toHaveBeenCalledOnce()
      const arg = mockSendEmail.mock.calls[0][0]
      expect(arg.vars.couponCode).toBe('WELCOME')
      expect(arg.vars.ctaUrl).toBe('https://shop.test/products')
    })

    it('does not send WhatsApp by default', async () => {
      await firstPurchaseNudge.send({ user_id: 'u1' }, { campaign, params: defaultParams })
      expect(mockSendWa).not.toHaveBeenCalled()
    })

    it('sends WhatsApp with a day cooldown when enabled', async () => {
      await firstPurchaseNudge.send({ user_id: 'u1' }, { campaign, params: { ...defaultParams, whatsappEnabled: true } })
      expect(mockSendWa).toHaveBeenCalledOnce()
      const [kind, userId, , cd] = mockSendWa.mock.calls[0]
      expect(kind).toBe('first_purchase_nudge')
      expect(userId).toBe('u1')
      expect(cd).toBe(1) // universal default cooldown = 1 day
    })

    it('returns no_user when the user is gone', async () => {
      mockFetchUser.mockResolvedValue(null)
      const res = await firstPurchaseNudge.send({ user_id: 'u1' }, { campaign, params: defaultParams })
      expect(res).toEqual({ ok: false, reason: 'no_user' })
    })
  })

  it('exposes findSuppressed', () => {
    expect(typeof firstPurchaseNudge.findSuppressed).toBe('function')
  })
})
