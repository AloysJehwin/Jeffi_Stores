import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/lib/shared/db', () => ({ queryMany: vi.fn(), query: vi.fn() }))
vi.mock('@/lib/shared/automation-emails', () => ({
  APP_URL: 'https://jeffistores.com',
  fetchUserContext: vi.fn(),
  resolveCoupon: vi.fn().mockResolvedValue({ couponCode: 'SAVE', discountPercent: '10' }),
  sendCampaignEmail: vi.fn().mockResolvedValue({ ok: true, sentId: 's1' }),
  fetchProductImageUrl: vi.fn().mockResolvedValue('img.jpg'),
  renderHeroProduct: vi.fn().mockReturnValue('<hero/>'),
}))
vi.mock('@/lib/campaigns/whatsapp-dispatch', () => ({
  sendCampaignWhatsApp: vi.fn().mockResolvedValue({ ok: true }),
}))

import { reviewPhotoFollowup } from '@/lib/campaigns/scenarios/review-photo-followup'
import { queryMany } from '@/lib/shared/db'
import { fetchUserContext, sendCampaignEmail } from '@/lib/shared/automation-emails'
import { sendCampaignWhatsApp } from '@/lib/campaigns/whatsapp-dispatch'
import { days } from '@/lib/campaigns/duration'

const mockQueryMany = queryMany as ReturnType<typeof vi.fn>
const mockFetchUser = fetchUserContext as ReturnType<typeof vi.fn>
const mockSendEmail = sendCampaignEmail as ReturnType<typeof vi.fn>
const mockSendWa = sendCampaignWhatsApp as ReturnType<typeof vi.fn>

const campaign = {
  kind: 'review_photo_followup',
  enabled: true,
  name: 'Review Photo Follow-up',
  coupon_id: null,
  discount_percent: 0,
  delay_hours: 1,
  parameters: {},
} as any

const defaultParams = { ...reviewPhotoFollowup.defaultParams, maxRecipientsPerSweep: 50 } as any

const row = {
  review_id: 'rev1',
  user_id: 'u1',
  product_id: 'p1',
  product_name: 'Widget',
  product_slug: 'widget',
}

describe('reviewPhotoFollowup scenario', () => {
  beforeEach(() => vi.clearAllMocks())

  it('has kind review_photo_followup', () => {
    expect(reviewPhotoFollowup.kind).toBe('review_photo_followup')
  })

  it('sinceReview default is canonical minutes and typed as duration', () => {
    expect(reviewPhotoFollowup.defaultParams.sinceReview).toBe(days(3))
    expect(reviewPhotoFollowup.paramSchema.sinceReview.type).toBe('duration')
  })

  describe('findEligible', () => {
    it('passes sinceReview + cooldown as minute strings', async () => {
      mockQueryMany.mockResolvedValue([row])
      const rows = await reviewPhotoFollowup.findEligible({ campaign, params: defaultParams })
      expect(rows).toHaveLength(1)
      const [sql, args] = mockQueryMany.mock.calls[0]
      expect(sql).toContain('array_length(r.image_urls, 1) IS NULL')
      expect(args[1]).toBe(String(days(3)))
      expect(args[2]).toBe(String(days(1)))
      expect(args[3]).toBe(50)
    })
  })

  describe('send', () => {
    beforeEach(() => {
      mockFetchUser.mockResolvedValue({ first_name: 'Sam', baseUrl: 'https://shop.test', unsubscribe_token: 't' })
    })

    it('emails with the review id as referenceId (per-review dedup)', async () => {
      const res = await reviewPhotoFollowup.send(row, { campaign, params: defaultParams })
      expect(res.ok).toBe(true)
      expect(mockSendEmail.mock.calls[0][0].referenceId).toBe('rev1')
      expect(mockSendEmail.mock.calls[0][0].vars.productName).toBe('Widget')
    })

    it("links straight to the customer's own review, opened for adding a photo", async () => {
      await reviewPhotoFollowup.send(row, { campaign, params: defaultParams })
      expect(mockSendEmail.mock.calls[0][0].vars.ctaUrl).toBe('https://shop.test/products/widget?review=edit')
    })

    it('does not send WhatsApp when disabled', async () => {
      await reviewPhotoFollowup.send(row, { campaign, params: defaultParams })
      expect(mockSendWa).not.toHaveBeenCalled()
    })

    it('sends WhatsApp with cooldown days when enabled', async () => {
      await reviewPhotoFollowup.send(row, { campaign, params: { ...defaultParams, whatsappEnabled: true } })
      expect(mockSendWa).toHaveBeenCalledOnce()
      const [kind, userId, vars, cd] = mockSendWa.mock.calls[0]
      expect(kind).toBe('review_photo_followup')
      expect(userId).toBe('u1')
      expect(vars.product).toBe('Widget')
      expect(cd).toBe(days(1))
    })

    it('returns no_user when the user is gone', async () => {
      mockFetchUser.mockResolvedValue(null)
      const res = await reviewPhotoFollowup.send(row, { campaign, params: defaultParams })
      expect(res).toEqual({ ok: false, reason: 'no_user' })
    })
  })
})
