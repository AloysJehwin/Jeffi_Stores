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

import { viewedCategory } from '@/lib/campaigns/scenarios/viewed-category'
import { queryMany } from '@/lib/shared/db'
import { fetchUserContext, sendCampaignEmail } from '@/lib/shared/automation-emails'
import { sendCampaignWhatsApp } from '@/lib/campaigns/whatsapp-dispatch'
import { days, hours } from '@/lib/campaigns/duration'

const mockQueryMany = queryMany as ReturnType<typeof vi.fn>
const mockFetchUser = fetchUserContext as ReturnType<typeof vi.fn>
const mockSendEmail = sendCampaignEmail as ReturnType<typeof vi.fn>
const mockSendWa = sendCampaignWhatsApp as ReturnType<typeof vi.fn>

const campaign = {
  kind: 'viewed_category',
  enabled: true,
  name: 'Viewed Category',
  coupon_id: null,
  discount_percent: 0,
  delay_hours: 1,
  parameters: {},
} as any

const defaultParams = viewedCategory.defaultParams

describe('viewedCategory scenario', () => {
  beforeEach(() => vi.clearAllMocks())

  it('has kind viewed_category', () => {
    expect(viewedCategory.kind).toBe('viewed_category')
  })

  it('default durations are canonical minutes', () => {
    expect(defaultParams.lookback).toBe(days(14))
    expect(defaultParams.viewSettle).toBe(hours(6))
    expect(defaultParams.sendCooldown).toBe(days(7))
    expect(defaultParams.minViews).toBe(2)
  })

  it('duration params are typed as duration with a recommended unit', () => {
    expect(viewedCategory.paramSchema.lookback.type).toBe('duration')
    expect((viewedCategory.paramSchema.lookback as any).recommendedUnit).toBe('days')
    expect((viewedCategory.paramSchema.viewSettle as any).recommendedUnit).toBe('hours')
    expect(viewedCategory.paramSchema.minViews.type).toBe('integer')
  })

  describe('findEligible', () => {
    it('passes the duration params as minute strings and minViews to the query', async () => {
      mockQueryMany.mockResolvedValue([{ user_id: 'u1', category_id: 'c1' }])
      const rows = await viewedCategory.findEligible({ campaign, params: defaultParams })
      expect(rows).toHaveLength(1)
      const [, args] = mockQueryMany.mock.calls[0]
      // [kind, settle, lookback, cooldown, minViews, maxRecipients]
      expect(args[1]).toBe(String(hours(6)))
      expect(args[2]).toBe(String(days(14)))
      expect(args[3]).toBe(String(days(7)))
      expect(args[4]).toBe(defaultParams.minViews)
      expect(args[5]).toBe(defaultParams.maxRecipientsPerSweep)
    })

    it('honors an overridden {value,unit} lookback', async () => {
      mockQueryMany.mockResolvedValue([])
      await viewedCategory.findEligible({
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
      // 1st call: category lookup, 2nd call: products in category
      mockQueryMany
        .mockResolvedValueOnce([{ name: 'Shoes', slug: 'shoes' }])
        .mockResolvedValueOnce([
          { product_id: 'p1', product_slug: 'runner', name: 'Runner', price: 100, image_url: 'img.jpg' },
        ])
    })

    it('sends an email featuring the category', async () => {
      const res = await viewedCategory.send({ user_id: 'u1', category_id: 'c1' }, { campaign, params: defaultParams })
      expect(res.ok).toBe(true)
      expect(mockSendEmail).toHaveBeenCalledOnce()
      const arg = mockSendEmail.mock.calls[0][0]
      expect(arg.referenceId).toBe('c1')
      expect(arg.vars.categoryName).toBe('Shoes')
    })

    it('does not send WhatsApp when whatsappEnabled is false', async () => {
      await viewedCategory.send({ user_id: 'u1', category_id: 'c1' }, { campaign, params: defaultParams })
      expect(mockSendWa).not.toHaveBeenCalled()
    })

    it('sends WhatsApp with a day-converted cooldown when enabled', async () => {
      await viewedCategory.send(
        { user_id: 'u1', category_id: 'c1' },
        { campaign, params: { ...defaultParams, whatsappEnabled: true } }
      )
      expect(mockSendWa).toHaveBeenCalledOnce()
      const [kind, userId, vars, cooldownMin] = mockSendWa.mock.calls[0]
      expect(kind).toBe('viewed_category')
      expect(userId).toBe('u1')
      expect(vars.items).toBe('Shoes')
      expect(cooldownMin).toBe(10080) // 7 days in minutes
    })

    it('returns no_items when the category has no products', async () => {
      // Reset the queued implementations from the describe-level beforeEach, then queue our own.
      mockQueryMany.mockReset()
      mockQueryMany.mockResolvedValueOnce([{ name: 'Shoes', slug: 'shoes' }]).mockResolvedValueOnce([])
      const res = await viewedCategory.send({ user_id: 'u1', category_id: 'c1' }, { campaign, params: defaultParams })
      expect(res).toEqual({ ok: false, reason: 'no_items' })
    })
  })
})
