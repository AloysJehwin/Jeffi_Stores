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

import { highValueCart } from '@/lib/campaigns/scenarios/high-value-cart'
import { queryMany } from '@/lib/shared/db'
import { fetchUserContext, sendCampaignEmail } from '@/lib/shared/automation-emails'
import { sendCampaignWhatsApp } from '@/lib/campaigns/whatsapp-dispatch'
import { days } from '@/lib/campaigns/duration'

const mockQueryMany = queryMany as ReturnType<typeof vi.fn>
const mockFetchUser = fetchUserContext as ReturnType<typeof vi.fn>
const mockSendEmail = sendCampaignEmail as ReturnType<typeof vi.fn>
const mockSendWa = sendCampaignWhatsApp as ReturnType<typeof vi.fn>

const campaign = {
  kind: 'high_value_cart',
  enabled: true,
  name: 'High-Value Cart',
  coupon_id: null,
  discount_percent: 0,
  delay_hours: 2,
  parameters: {},
} as any

const defaultParams = highValueCart.defaultParams

describe('highValueCart scenario', () => {
  beforeEach(() => vi.clearAllMocks())

  it('has kind high_value_cart', () => {
    expect(highValueCart.kind).toBe('high_value_cart')
  })

  it('default durations are canonical minutes and a value floor', () => {
    expect(defaultParams.lookback).toBe(days(7))
    expect(defaultParams.sendCooldown).toBe(days(7))
    expect(defaultParams.minCartValue).toBe(5000)
  })

  it('duration params are typed as duration; minCartValue is an integer', () => {
    expect(highValueCart.paramSchema.lookback.type).toBe('duration')
    expect((highValueCart.paramSchema.lookback as any).recommendedUnit).toBe('days')
    expect(highValueCart.paramSchema.minCartValue.type).toBe('integer')
  })

  describe('findEligible', () => {
    it('passes delay_hours raw, durations as minute strings, and minCartValue to the query', async () => {
      mockQueryMany.mockResolvedValue([{ user_id: 'u1' }])
      const rows = await highValueCart.findEligible({ campaign, params: defaultParams })
      expect(rows).toHaveLength(1)
      const [, args] = mockQueryMany.mock.calls[0]
      // [kind, delay_hours, lookback, cooldown, minCartValue, maxRecipients]
      expect(args[1]).toBe(2)
      expect(args[2]).toBe(String(days(7)))
      expect(args[3]).toBe(String(days(7)))
      expect(args[4]).toBe(defaultParams.minCartValue)
      expect(args[5]).toBe(defaultParams.maxRecipientsPerSweep)
    })

    it('honors an overridden {value,unit} lookback', async () => {
      mockQueryMany.mockResolvedValue([])
      await highValueCart.findEligible({
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
        { product_slug: 'tv', name: 'TV', quantity: 1, price: 6000, image_url: 'img.jpg' },
      ])
    })

    it('sends an email with the cart items', async () => {
      const res = await highValueCart.send({ user_id: 'u1' }, { campaign, params: defaultParams })
      expect(res.ok).toBe(true)
      expect(mockSendEmail).toHaveBeenCalledOnce()
      const arg = mockSendEmail.mock.calls[0][0]
      expect(arg.vars.itemCount).toBe(1)
      expect(arg.vars.ctaUrl).toBe('https://shop.test/cart')
    })

    it('does not send WhatsApp when whatsappEnabled is false', async () => {
      await highValueCart.send({ user_id: 'u1' }, { campaign, params: defaultParams })
      expect(mockSendWa).not.toHaveBeenCalled()
    })

    it('sends WhatsApp with a day-converted cooldown when enabled', async () => {
      await highValueCart.send({ user_id: 'u1' }, { campaign, params: { ...defaultParams, whatsappEnabled: true } })
      expect(mockSendWa).toHaveBeenCalledOnce()
      const [kind, userId, vars, cooldownDays] = mockSendWa.mock.calls[0]
      expect(kind).toBe('high_value_cart')
      expect(userId).toBe('u1')
      expect(vars.items).toBe('TV')
      expect(cooldownDays).toBe(7)
    })

    it('returns no_items when the cart is empty', async () => {
      mockQueryMany.mockResolvedValue([])
      const res = await highValueCart.send({ user_id: 'u1' }, { campaign, params: defaultParams })
      expect(res).toEqual({ ok: false, reason: 'no_items' })
    })
  })
})
