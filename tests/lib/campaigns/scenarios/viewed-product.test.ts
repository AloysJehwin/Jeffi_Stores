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

import { viewedProduct } from '@/lib/campaigns/scenarios/viewed-product'
import { queryMany } from '@/lib/shared/db'
import { fetchUserContext, sendCampaignEmail } from '@/lib/shared/automation-emails'
import { sendCampaignWhatsApp } from '@/lib/campaigns/whatsapp-dispatch'
import { days, hours } from '@/lib/campaigns/duration'

const mockQueryMany = queryMany as ReturnType<typeof vi.fn>
const mockFetchUser = fetchUserContext as ReturnType<typeof vi.fn>
const mockSendEmail = sendCampaignEmail as ReturnType<typeof vi.fn>
const mockSendWa = sendCampaignWhatsApp as ReturnType<typeof vi.fn>

const campaign = {
  kind: 'viewed_product',
  enabled: true,
  name: 'Viewed Product',
  coupon_id: null,
  discount_percent: 0,
  delay_hours: 1,
  parameters: {},
} as any

const defaultParams = viewedProduct.defaultParams

describe('viewedProduct scenario', () => {
  beforeEach(() => vi.clearAllMocks())

  it('has kind viewed_product', () => {
    expect(viewedProduct.kind).toBe('viewed_product')
  })

  it('default durations are canonical minutes', () => {
    expect(defaultParams.lookback).toBe(days(14))
    expect(defaultParams.viewSettle).toBe(hours(6))
    expect(defaultParams.sendCooldown).toBe(days(7))
  })

  it('duration params are typed as duration with a recommended unit', () => {
    expect(viewedProduct.paramSchema.lookback.type).toBe('duration')
    expect((viewedProduct.paramSchema.lookback as any).recommendedUnit).toBe('days')
    expect((viewedProduct.paramSchema.viewSettle as any).recommendedUnit).toBe('hours')
  })

  describe('findEligible', () => {
    it('passes the duration params as minute strings to the query', async () => {
      mockQueryMany.mockResolvedValue([{ user_id: 'u1', product_id: 'p1' }])
      const rows = await viewedProduct.findEligible({ campaign, params: defaultParams })
      expect(rows).toHaveLength(1)
      const [, args] = mockQueryMany.mock.calls[0]
      // [campaign.kind, settle, lookback, cooldown, maxRecipients]
      expect(args[1]).toBe(String(hours(6)))
      expect(args[2]).toBe(String(days(14)))
      expect(args[3]).toBe(String(days(7)))
      expect(args[4]).toBe(defaultParams.maxRecipientsPerSweep)
    })

    it('honors an overridden {value,unit} lookback', async () => {
      mockQueryMany.mockResolvedValue([])
      await viewedProduct.findEligible({
        campaign,
        params: { ...defaultParams, lookback: { value: 30, unit: 'days' } } as any,
      })
      const [, args] = mockQueryMany.mock.calls[0]
      expect(args[2]).toBe(String(days(30)))
    })
  })

  describe('send', () => {
    beforeEach(() => {
      mockFetchUser.mockResolvedValue({ first_name: 'Sam', baseUrl: 'https://shop.test', unsubscribe_token: 't' })
      mockQueryMany.mockResolvedValue([
        { product_id: 'p1', product_slug: 'widget', name: 'Widget', price: 100, image_url: 'img.jpg' },
      ])
    })

    it('sends an email featuring the viewed product', async () => {
      const res = await viewedProduct.send({ user_id: 'u1', product_id: 'p1' }, { campaign, params: defaultParams })
      expect(res.ok).toBe(true)
      expect(mockSendEmail).toHaveBeenCalledOnce()
      const arg = mockSendEmail.mock.calls[0][0]
      expect(arg.referenceId).toBe('p1')
      expect(arg.vars.productName).toBe('Widget')
    })

    it('does not send WhatsApp when whatsappEnabled is false', async () => {
      await viewedProduct.send({ user_id: 'u1', product_id: 'p1' }, { campaign, params: defaultParams })
      expect(mockSendWa).not.toHaveBeenCalled()
    })

    it('sends WhatsApp with a day-converted cooldown when enabled', async () => {
      await viewedProduct.send(
        { user_id: 'u1', product_id: 'p1' },
        { campaign, params: { ...defaultParams, whatsappEnabled: true } }
      )
      expect(mockSendWa).toHaveBeenCalledOnce()
      const [kind, userId, vars, cooldownMin] = mockSendWa.mock.calls[0]
      expect(kind).toBe('viewed_product')
      expect(userId).toBe('u1')
      expect(vars.items).toBe('Widget')
      // sendCooldown default = 7 days -> cooldownMin === days(7) = 10080 min
      expect(cooldownMin).toBe(10080) // 7 days in minutes
    })

    it('returns no_items when the product is gone', async () => {
      mockQueryMany.mockResolvedValue([])
      const res = await viewedProduct.send({ user_id: 'u1', product_id: 'p1' }, { campaign, params: defaultParams })
      expect(res).toEqual({ ok: false, reason: 'no_items' })
    })
  })
})
