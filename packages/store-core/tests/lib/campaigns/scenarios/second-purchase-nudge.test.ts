import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/lib/shared/db', () => ({ queryMany: vi.fn(), query: vi.fn() }))
vi.mock('@/lib/shared/automation-emails', () => ({
  APP_URL: 'https://jeffistores.com',
  fetchUserContext: vi.fn(),
  resolveCoupon: vi.fn().mockResolvedValue({ couponCode: 'COMEBACK', discountPercent: '15' }),
  sendCampaignEmail: vi.fn().mockResolvedValue({ ok: true, sentId: 's1' }),
  renderItemRows: vi.fn().mockReturnValue('<items/>'),
}))
vi.mock('@/lib/campaigns/whatsapp-dispatch', () => ({
  sendCampaignWhatsApp: vi.fn().mockResolvedValue({ ok: true }),
}))

import { secondPurchaseNudge } from '@/lib/campaigns/scenarios/second-purchase-nudge'
import { queryMany } from '@/lib/shared/db'
import { fetchUserContext, sendCampaignEmail } from '@/lib/shared/automation-emails'
import { sendCampaignWhatsApp } from '@/lib/campaigns/whatsapp-dispatch'
import { days } from '@/lib/campaigns/duration'

const mockQueryMany = queryMany as ReturnType<typeof vi.fn>
const mockFetchUser = fetchUserContext as ReturnType<typeof vi.fn>
const mockSendEmail = sendCampaignEmail as ReturnType<typeof vi.fn>
const mockSendWa = sendCampaignWhatsApp as ReturnType<typeof vi.fn>

const campaign = {
  kind: 'second_purchase_nudge',
  enabled: true,
  name: 'Second Purchase Nudge',
  coupon_id: null,
  discount_percent: 0,
  delay_hours: 1,
  parameters: {},
} as any

const defaultParams = secondPurchaseNudge.defaultParams

describe('secondPurchaseNudge scenario', () => {
  beforeEach(() => vi.clearAllMocks())

  it('has kind second_purchase_nudge', () => {
    expect(secondPurchaseNudge.kind).toBe('second_purchase_nudge')
  })

  it('default sinceFirstOrder is canonical minutes (21 days)', () => {
    expect(defaultParams.sinceFirstOrder).toBe(days(21))
  })

  it('sinceFirstOrder is a duration param with recommended days', () => {
    expect(secondPurchaseNudge.paramSchema.sinceFirstOrder.type).toBe('duration')
    expect((secondPurchaseNudge.paramSchema.sinceFirstOrder as any).recommendedUnit).toBe('days')
  })

  describe('findEligible', () => {
    it('filters to exactly one paid order and passes minute strings', async () => {
      mockQueryMany.mockResolvedValue([{ user_id: 'u1' }])
      const rows = await secondPurchaseNudge.findEligible({ campaign, params: defaultParams })
      expect(rows).toHaveLength(1)
      const [sql, args] = mockQueryMany.mock.calls[0]
      expect(sql).toContain('= 1')
      expect(args[0]).toBe('second_purchase_nudge')
      expect(args[1]).toBe(String(days(21)))
      expect(args[3]).toBe(defaultParams.maxRecipientsPerSweep)
    })
  })

  describe('send', () => {
    beforeEach(() => {
      mockFetchUser.mockResolvedValue({ first_name: 'Sam', baseUrl: 'https://shop.test', unsubscribe_token: 't' })
      mockQueryMany.mockResolvedValue([{ name: 'Widget', product_slug: 'widget', image_url: 'img.jpg' }])
    })

    it('sends a cross-sell email from the first order', async () => {
      const res = await secondPurchaseNudge.send({ user_id: 'u1' }, { campaign, params: defaultParams })
      expect(res.ok).toBe(true)
      expect(mockSendEmail).toHaveBeenCalledOnce()
      const arg = mockSendEmail.mock.calls[0][0]
      expect(arg.vars.couponCode).toBe('COMEBACK')
    })

    it('does not send WhatsApp by default', async () => {
      await secondPurchaseNudge.send({ user_id: 'u1' }, { campaign, params: defaultParams })
      expect(mockSendWa).not.toHaveBeenCalled()
    })

    it('sends WhatsApp when enabled', async () => {
      await secondPurchaseNudge.send({ user_id: 'u1' }, { campaign, params: { ...defaultParams, whatsappEnabled: true } })
      expect(mockSendWa).toHaveBeenCalledOnce()
      expect(mockSendWa.mock.calls[0][0]).toBe('second_purchase_nudge')
    })

    it('returns no_user when the user is gone', async () => {
      mockFetchUser.mockResolvedValue(null)
      const res = await secondPurchaseNudge.send({ user_id: 'u1' }, { campaign, params: defaultParams })
      expect(res).toEqual({ ok: false, reason: 'no_user' })
    })
  })

  it('exposes findSuppressed', () => {
    expect(typeof secondPurchaseNudge.findSuppressed).toBe('function')
  })
})
