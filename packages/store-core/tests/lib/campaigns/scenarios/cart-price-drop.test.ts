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

import { cartPriceDrop } from '@/lib/campaigns/scenarios/cart-price-drop'
import { queryMany } from '@/lib/shared/db'
import { fetchUserContext, sendCampaignEmail } from '@/lib/shared/automation-emails'
import { sendCampaignWhatsApp } from '@/lib/campaigns/whatsapp-dispatch'
import { days } from '@/lib/campaigns/duration'

const mockQueryMany = queryMany as ReturnType<typeof vi.fn>
const mockFetchUser = fetchUserContext as ReturnType<typeof vi.fn>
const mockSendEmail = sendCampaignEmail as ReturnType<typeof vi.fn>
const mockSendWa = sendCampaignWhatsApp as ReturnType<typeof vi.fn>

const campaign = {
  kind: 'cart_price_drop',
  enabled: true,
  name: 'Cart Price Drop',
  coupon_id: null,
  discount_percent: 0,
  delay_hours: 1,
  parameters: {},
} as any

const defaultParams = cartPriceDrop.defaultParams

describe('cartPriceDrop scenario', () => {
  beforeEach(() => vi.clearAllMocks())

  it('has kind cart_price_drop', () => {
    expect(cartPriceDrop.kind).toBe('cart_price_drop')
  })

  it('default durations are canonical minutes and a threshold %', () => {
    expect(defaultParams.lookback).toBe(days(14))
    expect(defaultParams.sendCooldown).toBe(days(7))
    expect(defaultParams.priceDropThresholdPct).toBe(5)
  })

  it('duration params are typed as duration; threshold is an integer', () => {
    expect(cartPriceDrop.paramSchema.lookback.type).toBe('duration')
    expect((cartPriceDrop.paramSchema.lookback as any).recommendedUnit).toBe('days')
    expect(cartPriceDrop.paramSchema.priceDropThresholdPct.type).toBe('integer')
  })

  describe('findEligible', () => {
    it('passes the drop factor and durations as minute strings to the query', async () => {
      mockQueryMany.mockResolvedValue([{ user_id: 'u1' }])
      const rows = await cartPriceDrop.findEligible({ campaign, params: defaultParams })
      expect(rows).toHaveLength(1)
      const [, args] = mockQueryMany.mock.calls[0]
      // [kind, factor, lookback, cooldown, maxRecipients]
      expect(args[1]).toBeCloseTo(0.95) // (100 - 5) / 100
      expect(args[2]).toBe(String(days(14)))
      expect(args[3]).toBe(String(days(7)))
      expect(args[4]).toBe(defaultParams.maxRecipientsPerSweep)
    })

    it('computes the factor from an overridden threshold', async () => {
      mockQueryMany.mockResolvedValue([])
      await cartPriceDrop.findEligible({ campaign, params: { ...defaultParams, priceDropThresholdPct: 20 } })
      const [, args] = mockQueryMany.mock.calls[0]
      expect(args[1]).toBeCloseTo(0.8)
    })
  })

  describe('send', () => {
    beforeEach(() => {
      mockFetchUser.mockResolvedValue({ first_name: 'Sam', baseUrl: 'https://shop.test', unsubscribe_token: 't' })
      mockQueryMany.mockResolvedValue([
        { product_slug: 'tv', name: 'TV', old_price: 6000, new_price: 5000, image_url: 'img.jpg' },
      ])
    })

    it('sends an email with the discounted cart items', async () => {
      const res = await cartPriceDrop.send({ user_id: 'u1' }, { campaign, params: defaultParams })
      expect(res.ok).toBe(true)
      expect(mockSendEmail).toHaveBeenCalledOnce()
      const arg = mockSendEmail.mock.calls[0][0]
      expect(arg.vars.itemCount).toBe(1)
      expect(arg.vars.ctaUrl).toBe('https://shop.test/cart')
    })

    it('does not send WhatsApp when whatsappEnabled is false', async () => {
      await cartPriceDrop.send({ user_id: 'u1' }, { campaign, params: defaultParams })
      expect(mockSendWa).not.toHaveBeenCalled()
    })

    it('sends WhatsApp with a day-converted cooldown when enabled', async () => {
      await cartPriceDrop.send({ user_id: 'u1' }, { campaign, params: { ...defaultParams, whatsappEnabled: true } })
      expect(mockSendWa).toHaveBeenCalledOnce()
      const [kind, userId, vars, cooldownMin] = mockSendWa.mock.calls[0]
      expect(kind).toBe('cart_price_drop')
      expect(userId).toBe('u1')
      expect(vars.items).toBe('TV')
      expect(cooldownMin).toBe(10080) // 7 days in minutes
    })

    it('returns no_items when nothing dropped', async () => {
      mockQueryMany.mockResolvedValue([])
      const res = await cartPriceDrop.send({ user_id: 'u1' }, { campaign, params: defaultParams })
      expect(res).toEqual({ ok: false, reason: 'no_items' })
    })
  })
})
