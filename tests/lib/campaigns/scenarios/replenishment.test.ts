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

import { replenishment } from '@/lib/campaigns/scenarios/replenishment'
import { queryMany } from '@/lib/shared/db'
import { fetchUserContext, sendCampaignEmail } from '@/lib/shared/automation-emails'
import { sendCampaignWhatsApp } from '@/lib/campaigns/whatsapp-dispatch'
import { days } from '@/lib/campaigns/duration'

const mockQueryMany = queryMany as ReturnType<typeof vi.fn>
const mockFetchUser = fetchUserContext as ReturnType<typeof vi.fn>
const mockSendEmail = sendCampaignEmail as ReturnType<typeof vi.fn>
const mockSendWa = sendCampaignWhatsApp as ReturnType<typeof vi.fn>

const campaign = {
  kind: 'replenishment',
  enabled: true,
  name: 'Replenishment Reminder',
  coupon_id: null,
  discount_percent: 0,
  delay_hours: 1,
  parameters: {},
} as any

const defaultParams = replenishment.defaultParams
const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString()

describe('replenishment scenario', () => {
  beforeEach(() => vi.clearAllMocks())

  it('has kind replenishment', () => {
    expect(replenishment.kind).toBe('replenishment')
  })

  it('default params: multiplier number + duration lookahead in minutes', () => {
    expect(defaultParams.intervalMultiplier).toBe(1.0)
    expect(defaultParams.lookahead).toBe(days(3))
    expect(replenishment.paramSchema.intervalMultiplier.type).toBe('number')
    expect(replenishment.paramSchema.lookahead.type).toBe('duration')
  })

  describe('findEligible', () => {
    it('passes cooldown as a minute string and includes a user due past their interval', async () => {
      // monthly interval (30d), bought 40 days ago -> elapsed(40d) >= 30d*1 - 3d -> eligible
      mockQueryMany.mockResolvedValue([
        {
          user_id: 'u1',
          product_id: 'p1',
          product_slug: 'coffee',
          product_name: 'Coffee',
          subscription_interval: 'monthly',
          last_purchase_at: daysAgo(40),
        },
      ])
      const rows = await replenishment.findEligible({ campaign, params: defaultParams })
      expect(rows).toEqual([{ user_id: 'u1', product_id: 'p1' }])
      const [, args] = mockQueryMany.mock.calls[0]
      // [kind, cooldownMinutes, maxRecipients]
      expect(args[0]).toBe('replenishment')
      expect(args[1]).toBe(String(days(14)))
      expect(args[2]).toBe(defaultParams.maxRecipientsPerSweep)
    })

    it("uses a consumable category's reorder interval (60 days, minus the 3-day lookahead)", async () => {
      const row = (id: string, ago: number) => ({
        user_id: id,
        product_id: 'p-' + id,
        product_slug: 'screws',
        product_name: 'Machine screws',
        is_subscription: false,
        subscription_interval: null,
        reorder_interval_days: 60,
        last_purchase_at: daysAgo(ago),
      })
      mockQueryMany.mockResolvedValue([row('early', 50), row('due', 58)])
      expect(await replenishment.findEligible({ campaign, params: defaultParams })).toEqual([
        { user_id: 'due', product_id: 'p-due' },
      ])
      const [sql] = mockQueryMany.mock.calls[0]
      expect(String(sql)).toContain('COALESCE(c.reorder_interval_days, pc.reorder_interval_days)')
      expect(String(sql)).toContain('p.is_subscription = TRUE OR')
      expect(String(sql)).toContain('p.is_active = TRUE')
    })

    it('keeps a subscription product on its own interval even inside a consumable category', async () => {
      mockQueryMany.mockResolvedValue([
        {
          user_id: 'u3',
          product_id: 'p3',
          product_slug: 'oil',
          product_name: 'Cutting oil',
          is_subscription: true,
          subscription_interval: 'weekly',
          reorder_interval_days: 90,
          last_purchase_at: daysAgo(6),
        },
      ])
      // weekly (7d) - 3d lookahead = 4d; bought 6 days ago -> due, though the category says 90 days
      expect(await replenishment.findEligible({ campaign, params: defaultParams })).toEqual([
        { user_id: 'u3', product_id: 'p3' },
      ])
    })

    it('excludes a user who bought too recently to be due', async () => {
      // monthly (30d), bought 5 days ago -> elapsed(5d) < 27d threshold -> not eligible
      mockQueryMany.mockResolvedValue([
        {
          user_id: 'u2',
          product_id: 'p2',
          product_slug: 'tea',
          product_name: 'Tea',
          subscription_interval: 'monthly',
          last_purchase_at: daysAgo(5),
        },
      ])
      const rows = await replenishment.findEligible({ campaign, params: defaultParams })
      expect(rows).toEqual([])
    })

    it('weekly interval becomes due much sooner than monthly', async () => {
      // weekly (7d), bought 10 days ago -> elapsed(10d) >= 4d threshold -> eligible
      mockQueryMany.mockResolvedValue([
        {
          user_id: 'u3',
          product_id: 'p3',
          product_slug: 'milk',
          product_name: 'Milk',
          subscription_interval: 'weekly',
          last_purchase_at: daysAgo(10),
        },
      ])
      const rows = await replenishment.findEligible({ campaign, params: defaultParams })
      expect(rows).toEqual([{ user_id: 'u3', product_id: 'p3' }])
    })
  })

  describe('send', () => {
    beforeEach(() => {
      mockFetchUser.mockResolvedValue({ first_name: 'Sam', baseUrl: 'https://shop.test', unsubscribe_token: 't' })
      mockQueryMany.mockResolvedValue([
        { product_id: 'p1', product_slug: 'coffee', name: 'Coffee', price: 500, image_url: 'img.jpg' },
      ])
    })

    it('sends a reorder email for the product', async () => {
      const res = await replenishment.send({ user_id: 'u1', product_id: 'p1' }, { campaign, params: defaultParams })
      expect(res.ok).toBe(true)
      const arg = mockSendEmail.mock.calls[0][0]
      expect(arg.referenceId).toBe('p1')
      expect(arg.vars.productName).toBe('Coffee')
    })

    it('sends WhatsApp with a day-converted cooldown when enabled', async () => {
      await replenishment.send(
        { user_id: 'u1', product_id: 'p1' },
        { campaign, params: { ...defaultParams, whatsappEnabled: true } }
      )
      const [kind, userId, vars, cd] = mockSendWa.mock.calls[0]
      expect(kind).toBe('replenishment')
      expect(userId).toBe('u1')
      expect(vars.items).toBe('Coffee')
      expect(cd).toBe(days(14))
    })

    it('returns no_items when the product is gone', async () => {
      mockQueryMany.mockResolvedValue([])
      const res = await replenishment.send({ user_id: 'u1', product_id: 'p1' }, { campaign, params: defaultParams })
      expect(res).toEqual({ ok: false, reason: 'no_items' })
    })
  })
})
