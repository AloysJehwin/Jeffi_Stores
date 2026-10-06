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

import { wishlistReminder } from '@/lib/campaigns/scenarios/wishlist-reminder'
import { queryMany } from '@/lib/shared/db'
import { fetchUserContext, sendCampaignEmail } from '@/lib/shared/automation-emails'
import { sendCampaignWhatsApp } from '@/lib/campaigns/whatsapp-dispatch'
import { days } from '@/lib/campaigns/duration'

const mockQueryMany = queryMany as ReturnType<typeof vi.fn>
const mockFetchUser = fetchUserContext as ReturnType<typeof vi.fn>
const mockSendEmail = sendCampaignEmail as ReturnType<typeof vi.fn>
const mockSendWa = sendCampaignWhatsApp as ReturnType<typeof vi.fn>

const campaign = {
  kind: 'wishlist_reminder',
  enabled: true,
  name: 'Wishlist Reminder',
  coupon_id: null,
  discount_percent: 0,
  delay_hours: 1,
  parameters: {},
} as any

const defaultParams = wishlistReminder.defaultParams as any

describe('wishlistReminder scenario', () => {
  beforeEach(() => vi.clearAllMocks())

  it('has kind wishlist_reminder', () => {
    expect(wishlistReminder.kind).toBe('wishlist_reminder')
  })

  it('idleFor default is canonical minutes and typed as duration', () => {
    expect(wishlistReminder.defaultParams.idleFor).toBe(days(14))
    expect(wishlistReminder.paramSchema.idleFor.type).toBe('duration')
    expect((wishlistReminder.paramSchema.idleFor as any).recommendedUnit).toBe('days')
  })

  describe('findEligible', () => {
    it('passes idle + cooldown as minute strings', async () => {
      mockQueryMany.mockResolvedValue([{ user_id: 'u1' }])
      const rows = await wishlistReminder.findEligible({ campaign, params: defaultParams })
      expect(rows).toHaveLength(1)
      const [, args] = mockQueryMany.mock.calls[0]
      // [kind, idle, cooldown, maxRecipients]
      expect(args[1]).toBe(String(days(14)))
      expect(args[2]).toBe(String(days(1)))
      expect(args[3]).toBe(100)
    })

    it('ships a real per-sweep cap so the LIMIT is never NULL', () => {
      expect(wishlistReminder.defaultParams.maxRecipientsPerSweep).toBe(100)
      expect(wishlistReminder.paramSchema.maxRecipientsPerSweep.type).toBe('integer')
    })

    it('honors an overridden {value,unit} idleFor', async () => {
      mockQueryMany.mockResolvedValue([])
      await wishlistReminder.findEligible({
        campaign,
        params: { ...defaultParams, idleFor: { value: 30, unit: 'days' } },
      })
      const [, args] = mockQueryMany.mock.calls[0]
      expect(args[1]).toBe(String(days(30)))
    })
  })

  describe('send', () => {
    beforeEach(() => {
      mockFetchUser.mockResolvedValue({ first_name: 'Sam', baseUrl: 'https://shop.test', unsubscribe_token: 't' })
      mockQueryMany.mockResolvedValue([
        { product_id: 'p1', product_slug: 'widget', name: 'Widget', price: 100, image_url: 'img.jpg' },
      ])
    })

    it('emails the wishlist items', async () => {
      const res = await wishlistReminder.send({ user_id: 'u1' }, { campaign, params: defaultParams })
      expect(res.ok).toBe(true)
      expect(mockSendEmail).toHaveBeenCalledOnce()
      expect(mockSendEmail.mock.calls[0][0].vars.ctaUrl).toContain('/wishlist')
    })

    it('does not send WhatsApp when disabled', async () => {
      await wishlistReminder.send({ user_id: 'u1' }, { campaign, params: defaultParams })
      expect(mockSendWa).not.toHaveBeenCalled()
    })

    it('sends WhatsApp with cooldown days when enabled', async () => {
      await wishlistReminder.send({ user_id: 'u1' }, { campaign, params: { ...defaultParams, whatsappEnabled: true } })
      expect(mockSendWa).toHaveBeenCalledOnce()
      const [kind, userId, vars, cd] = mockSendWa.mock.calls[0]
      expect(kind).toBe('wishlist_reminder')
      expect(userId).toBe('u1')
      expect(vars.items).toContain('Widget')
      expect(cd).toBe(1)
    })

    it('returns no_items when the wishlist is empty', async () => {
      mockQueryMany.mockResolvedValue([])
      const res = await wishlistReminder.send({ user_id: 'u1' }, { campaign, params: defaultParams })
      expect(res).toEqual({ ok: false, reason: 'no_items' })
    })
  })
})
