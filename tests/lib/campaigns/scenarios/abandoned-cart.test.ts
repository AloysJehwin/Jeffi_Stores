import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/lib/shared/db', () => ({ queryMany: vi.fn(), query: vi.fn() }))
vi.mock('@/lib/shared/automation-emails', () => ({
  APP_URL: 'https://jeffistores.com',
  fetchUserContext: vi.fn(),
  resolveCoupon: vi.fn(),
  sendCampaignEmail: vi.fn(),
  renderItemRows: vi.fn().mockReturnValue('<items/>'),
}))
vi.mock('@/lib/campaigns/whatsapp-dispatch', () => ({
  sendCampaignWhatsApp: vi.fn().mockResolvedValue({ ok: true }),
}))

import { abandonedCart } from '@/lib/campaigns/scenarios/abandoned-cart'
import { queryMany } from '@/lib/shared/db'
import { fetchUserContext, resolveCoupon, sendCampaignEmail } from '@/lib/shared/automation-emails'
import { sendCampaignWhatsApp } from '@/lib/campaigns/whatsapp-dispatch'
import { days, hours } from '@/lib/campaigns/duration'

const mockQueryMany = queryMany as ReturnType<typeof vi.fn>
const mockFetchUser = fetchUserContext as ReturnType<typeof vi.fn>
const mockResolveCoupon = resolveCoupon as ReturnType<typeof vi.fn>
const mockSendEmail = sendCampaignEmail as ReturnType<typeof vi.fn>
const mockSendWhatsApp = sendCampaignWhatsApp as ReturnType<typeof vi.fn>

const campaign = {
  kind: 'abandoned_cart',
  enabled: true,
  name: 'Abandoned Cart',
  coupon_id: null,
  discount_percent: 0,
  delay_hours: 1,
  parameters: {},
} as any

const defaultParams = abandonedCart.defaultParams

describe('abandonedCart scenario', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('has correct kind', () => {
    expect(abandonedCart.kind).toBe('abandoned_cart')
  })

  it('stores duration defaults as canonical minutes', () => {
    expect(defaultParams.lookbackDays).toBe(days(30))
    expect(defaultParams.secondEmailDelayHours).toBe(hours(48))
    expect(defaultParams.maxRecipientsPerSweep).toBe(50)
    expect(defaultParams.maxItemsPerEmail).toBe(5)
  })

  it('does not declare the universal cooldown in its own defaults', () => {
    expect('sendCooldownDays' in defaultParams).toBe(false)
    expect('sendCooldown' in defaultParams).toBe(false)
  })

  it('types the duration fields as duration with a recommended unit', () => {
    expect(abandonedCart.paramSchema.lookbackDays.type).toBe('duration')
    expect((abandonedCart.paramSchema.lookbackDays as any).recommendedUnit).toBe('days')
    expect(abandonedCart.paramSchema.secondEmailDelayHours.type).toBe('duration')
    expect((abandonedCart.paramSchema.secondEmailDelayHours as any).recommendedUnit).toBe('hours')
  })

  it('does not re-declare the universal cooldown in its own schema', () => {
    expect((abandonedCart.paramSchema as any).sendCooldownDays).toBeUndefined()
  })

  describe('findEligible', () => {
    it('passes durations to the seq1 query as canonical-minute strings', async () => {
      mockQueryMany.mockResolvedValue([])
      await abandonedCart.findEligible({ campaign, params: defaultParams })
      // seq1 is the first queryMany call: [kind, delay_hours, lookbackMin, cooldownMin, maxRecipients]
      const [, args] = mockQueryMany.mock.calls[0]
      expect(args[0]).toBe('abandoned_cart')
      expect(args[2]).toBe(String(days(30))) // lookback in minutes, not 30
      expect(args[3]).toBe(String(days(1))) // universal cooldown default = 1 day -> minutes
      expect(args[4]).toBe(50)
    })

    it('passes durations to the seq2 query as canonical-minute strings', async () => {
      mockQueryMany.mockResolvedValue([])
      await abandonedCart.findEligible({ campaign, params: defaultParams })
      // seq2 is the second queryMany call: [kind, lookbackMin, cooldownMin, maxRecipients, secondEmailDelayMin]
      const [, args] = mockQueryMany.mock.calls[1]
      expect(args[1]).toBe(String(days(30)))
      expect(args[2]).toBe(String(days(1)))
      expect(args[4]).toBe(String(hours(48)))
    })

    it('reads a legacy sendCooldownDays integer as days -> minutes', async () => {
      mockQueryMany.mockResolvedValue([])
      await abandonedCart.findEligible({ campaign, params: { ...defaultParams, sendCooldownDays: 7 } as any })
      const [, args] = mockQueryMany.mock.calls[0]
      expect(args[3]).toBe(String(days(7)))
    })

    it('honours an overridden {value,unit} lookback', async () => {
      mockQueryMany.mockResolvedValue([])
      await abandonedCart.findEligible({
        campaign,
        params: { ...defaultParams, lookbackDays: { value: 2, unit: 'weeks' } } as any,
      })
      const [, args] = mockQueryMany.mock.calls[0]
      expect(args[2]).toBe(String(days(14)))
    })
  })

  describe('findSuppressed', () => {
    it('passes lookback and cooldown as minute strings', async () => {
      mockQueryMany.mockResolvedValue([])
      await abandonedCart.findSuppressed!({ campaign, params: defaultParams })
      const [, args] = mockQueryMany.mock.calls[0]
      // [kind, delay_hours, lookbackMin, cooldownMin]
      expect(args[2]).toBe(String(days(30)))
      expect(args[3]).toBe(String(days(1)))
    })
  })

  describe('send', () => {
    beforeEach(() => {
      mockFetchUser.mockResolvedValue({ first_name: 'Sam', baseUrl: 'https://shop.test' })
      mockResolveCoupon.mockResolvedValue({ couponCode: '', discountPercent: '' })
      mockSendEmail.mockResolvedValue({ ok: true })
    })

    it('returns no_items when the cart is empty', async () => {
      mockQueryMany.mockResolvedValue([])
      const res = await abandonedCart.send({ user_id: 'u1', sequence: 1 } as any, { campaign, params: defaultParams })
      expect(res).toEqual({ ok: false, reason: 'no_items' })
    })

    it('sends WhatsApp with a day-converted cooldown when enabled', async () => {
      mockQueryMany.mockResolvedValue([
        { product_id: 'p1', product_slug: 'widget', name: 'Widget', quantity: 1, price: 100, image_url: 'img.jpg' },
      ])
      await abandonedCart.send({ user_id: 'u1', sequence: 1 } as any, {
        campaign,
        params: { ...defaultParams, whatsappEnabled: true, sendCooldownDays: 7 } as any,
      })
      expect(mockSendWhatsApp).toHaveBeenCalledOnce()
      const [, , , cooldownMin] = mockSendWhatsApp.mock.calls[0]
      expect(cooldownMin).toBe(10080) // 7 days in minutes
    })
  })
})
