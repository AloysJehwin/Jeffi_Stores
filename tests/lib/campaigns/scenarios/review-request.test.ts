import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({ queryMany: vi.fn(), query: vi.fn() }))
vi.mock('@/lib/automation-emails', () => ({
  APP_URL: 'https://jeffistores.com',
  fetchUserContext: vi.fn(),
  resolveCoupon: vi.fn(),
  sendCampaignEmailRendered: vi.fn(),
  renderItemRows: vi.fn().mockReturnValue(''),
}))
vi.mock('@/lib/jwt', () => ({
  generateReviewToken: vi.fn(),
}))
vi.mock('@/lib/email-campaigns', () => ({
  renderCampaignEmail: vi.fn(),
}))

import { reviewRequest } from '@/lib/campaigns/scenarios/review-request'
import { queryMany } from '@/lib/db'
import { fetchUserContext, resolveCoupon, sendCampaignEmailRendered } from '@/lib/automation-emails'
import { generateReviewToken } from '@/lib/jwt'
import { renderCampaignEmail } from '@/lib/email-campaigns'

const mockQueryMany = queryMany as ReturnType<typeof vi.fn>
const mockFetchUser = fetchUserContext as ReturnType<typeof vi.fn>
const mockResolveCoupon = resolveCoupon as ReturnType<typeof vi.fn>
const mockSendEmail = sendCampaignEmailRendered as ReturnType<typeof vi.fn>
const mockGenerateToken = generateReviewToken as ReturnType<typeof vi.fn>
const mockRenderEmail = renderCampaignEmail as ReturnType<typeof vi.fn>

const campaign = {
  kind: 'review_request',
  enabled: true,
  name: 'Review Request',
  coupon_id: null,
  discount_percent: 0,
  delay_hours: 24,
  parameters: {},
} as any

const defaultParams = reviewRequest.defaultParams

const row = { id: 'order-1', user_id: 'user-1', order_number: 'ORD-001' }

describe('reviewRequest scenario', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('has correct kind', () => {
    expect(reviewRequest.kind).toBe('review_request')
  })

  it('has defaultParams with expected values', () => {
    expect(defaultParams.lookbackDays).toBe(30)
    expect(defaultParams.maxRecipientsPerSweep).toBe(50)
  })

  it('has a paramSchema', () => {
    expect(reviewRequest.paramSchema).toBeDefined()
    expect(reviewRequest.paramSchema.lookbackDays).toBeDefined()
    expect(reviewRequest.paramSchema.maxRecipientsPerSweep).toBeDefined()
  })

  describe('findEligible', () => {
    it('calls queryMany and returns rows', async () => {
      mockQueryMany.mockResolvedValue([row])
      const rows = await reviewRequest.findEligible({ campaign, params: defaultParams })
      expect(rows).toHaveLength(1)
      expect(rows[0]).toEqual(row)
    })

    it('passes campaign kind and params to queryMany', async () => {
      mockQueryMany.mockResolvedValue([])
      await reviewRequest.findEligible({ campaign, params: defaultParams })
      const [, params] = mockQueryMany.mock.calls[0]
      expect(params[0]).toBe('review_request')
      expect(params[3]).toBe(defaultParams.maxRecipientsPerSweep)
    })
  })

  describe('send', () => {
    it('returns no_user when fetchUserContext returns null', async () => {
      mockFetchUser.mockResolvedValue(null)
      const result = await reviewRequest.send(row, { campaign, params: defaultParams })
      expect(result).toEqual({ ok: false, reason: 'no_user' })
    })

    it('sends email and returns ok=true with named user and slug', async () => {
      mockFetchUser.mockResolvedValue({
        id: 'user-1',
        first_name: 'Alice',
        email: 'alice@x.com',
        baseUrl: 'https://jeffistores.com',
      })
      mockQueryMany.mockResolvedValue([{ name: 'Bolt M6', product_id: 'p1', image_url: 'img.jpg', slug: 'bolt-m6' }])
      mockGenerateToken.mockResolvedValue('tok123')
      mockResolveCoupon.mockResolvedValue({ couponCode: 'SAVE10', discountPercent: 10 })
      mockRenderEmail.mockReturnValue({ subject: 'Review', html: '<html/>', ampHtml: null })
      mockSendEmail.mockResolvedValue({ ok: true })

      const result = await reviewRequest.send(row, { campaign, params: defaultParams })
      expect(result.ok).toBe(true)
      expect(mockSendEmail).toHaveBeenCalledOnce()
    })

    it('uses "there" when first_name is null', async () => {
      mockFetchUser.mockResolvedValue({
        id: 'user-1',
        first_name: null,
        email: 'u@x.com',
        baseUrl: 'https://jeffistores.com',
      })
      mockQueryMany.mockResolvedValue([])
      mockGenerateToken.mockResolvedValue('tok')
      mockResolveCoupon.mockResolvedValue({ couponCode: null, discountPercent: 0 })
      mockRenderEmail.mockReturnValue({ subject: 'S', html: '<h/>', ampHtml: null })
      mockSendEmail.mockResolvedValue({ ok: true })

      await reviewRequest.send(row, { campaign, params: defaultParams })
      const call = mockRenderEmail.mock.calls[0][1]
      expect(call.firstName).toBe('there')
    })

    it('passes empty couponCode when couponCode is null', async () => {
      mockFetchUser.mockResolvedValue({
        id: 'user-1',
        first_name: 'Bob',
        email: 'b@x.com',
        baseUrl: 'https://jeffistores.com',
      })
      mockQueryMany.mockResolvedValue([])
      mockGenerateToken.mockResolvedValue('tok')
      mockResolveCoupon.mockResolvedValue({ couponCode: null, discountPercent: null })
      mockRenderEmail.mockReturnValue({ subject: 'S', html: '<h/>', ampHtml: null })
      mockSendEmail.mockResolvedValue({ ok: true })

      await reviewRequest.send(row, { campaign, params: defaultParams })
      const call = mockRenderEmail.mock.calls[0][1]
      expect(call.couponCode).toBe('')
      expect(call.discountPercent).toBe('')
    })

    it('passes discountPercent as string when set', async () => {
      mockFetchUser.mockResolvedValue({
        id: 'user-1',
        first_name: 'Carol',
        email: 'c@x.com',
        baseUrl: 'https://jeffistores.com',
      })
      mockQueryMany.mockResolvedValue([])
      mockGenerateToken.mockResolvedValue('tok')
      mockResolveCoupon.mockResolvedValue({ couponCode: 'CODE', discountPercent: 15 })
      mockRenderEmail.mockReturnValue({ subject: 'S', html: '<h/>', ampHtml: null })
      mockSendEmail.mockResolvedValue({ ok: true })

      await reviewRequest.send(row, { campaign, params: defaultParams })
      const call = mockRenderEmail.mock.calls[0][1]
      expect(call.couponCode).toBe('CODE')
      expect(call.discountPercent).toBe('15')
    })

    it('sets productUrl to null when slug is null', async () => {
      mockFetchUser.mockResolvedValue({
        id: 'user-1',
        first_name: 'Dan',
        email: 'd@x.com',
        baseUrl: 'https://jeffistores.com',
      })
      mockQueryMany.mockResolvedValue([{ name: 'Widget', product_id: 'p2', image_url: null, slug: null }])
      mockGenerateToken.mockResolvedValue('tok')
      mockResolveCoupon.mockResolvedValue({ couponCode: null, discountPercent: 0 })
      mockRenderEmail.mockReturnValue({ subject: 'S', html: '<h/>', ampHtml: null })
      mockSendEmail.mockResolvedValue({ ok: true })

      await reviewRequest.send(row, { campaign, params: defaultParams })

      const call = mockRenderEmail.mock.calls[0][1]
      const items = JSON.parse(call.itemsJson)
      expect(items[0].productUrl).toBeNull()
    })

    it('builds productUrl from slug when slug is present', async () => {
      mockFetchUser.mockResolvedValue({
        id: 'user-1',
        first_name: 'Eve',
        email: 'e@x.com',
        baseUrl: 'https://jeffistores.com',
      })
      mockQueryMany.mockResolvedValue([{ name: 'Nut', product_id: 'p3', image_url: 'img.png', slug: 'nut-m8' }])
      mockGenerateToken.mockResolvedValue('tok')
      mockResolveCoupon.mockResolvedValue({ couponCode: null, discountPercent: 0 })
      mockRenderEmail.mockReturnValue({ subject: 'S', html: '<h/>', ampHtml: null })
      mockSendEmail.mockResolvedValue({ ok: true })

      await reviewRequest.send(row, { campaign, params: defaultParams })

      const call = mockRenderEmail.mock.calls[0][1]
      const items = JSON.parse(call.itemsJson)
      expect(items[0].productUrl).toBe('https://jeffistores.com/products/nut-m8')
    })

    it('generates 5 star links per item', async () => {
      mockFetchUser.mockResolvedValue({
        id: 'user-1',
        first_name: 'F',
        email: 'f@x.com',
        baseUrl: 'https://jeffistores.com',
      })
      mockQueryMany.mockResolvedValue([{ name: 'Screw', product_id: 'p4', image_url: null, slug: 'screw' }])
      mockGenerateToken.mockResolvedValue('mytoken')
      mockResolveCoupon.mockResolvedValue({ couponCode: null, discountPercent: 0 })
      mockRenderEmail.mockReturnValue({ subject: 'S', html: '<h/>', ampHtml: null })
      mockSendEmail.mockResolvedValue({ ok: true })

      await reviewRequest.send(row, { campaign, params: defaultParams })

      const call = mockRenderEmail.mock.calls[0][1]
      const items = JSON.parse(call.itemsJson)
      expect(items[0].starLinks).toHaveLength(5)
      expect(items[0].starLinks[0]).toContain('rating=1')
      expect(items[0].starLinks[4]).toContain('rating=5')
      expect(items[0].starLinks[0]).toContain('token=mytoken')
    })
  })
})
