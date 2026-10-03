import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/lib/shared/db', () => ({ queryMany: vi.fn(), query: vi.fn().mockResolvedValue({ rows: [] }) }))
vi.mock('@/lib/shared/automation-emails', () => ({
  APP_URL: 'https://jeffistores.com',
  fetchUserContext: vi.fn(),
  resolveCoupon: vi.fn().mockResolvedValue({ couponCode: '', discountPercent: '' }),
  sendCampaignEmail: vi.fn().mockResolvedValue({ ok: true, sentId: 's1' }),
  fetchProductImageUrl: vi.fn().mockResolvedValue('img.jpg'),
  renderHeroProduct: vi.fn().mockReturnValue('<hero/>'),
}))
vi.mock('@/lib/campaigns/whatsapp-dispatch', () => ({
  sendCampaignWhatsApp: vi.fn().mockResolvedValue({ ok: true }),
}))

import { backInStockWishlist } from '@/lib/campaigns/scenarios/back-in-stock-wishlist'
import { queryMany, query } from '@/lib/shared/db'
import { fetchUserContext, sendCampaignEmail } from '@/lib/shared/automation-emails'
import { sendCampaignWhatsApp } from '@/lib/campaigns/whatsapp-dispatch'
import { days } from '@/lib/campaigns/duration'

const mockQueryMany = queryMany as ReturnType<typeof vi.fn>
const mockQuery = query as ReturnType<typeof vi.fn>
const mockFetchUser = fetchUserContext as ReturnType<typeof vi.fn>
const mockSendEmail = sendCampaignEmail as ReturnType<typeof vi.fn>
const mockSendWa = sendCampaignWhatsApp as ReturnType<typeof vi.fn>

const campaign = {
  kind: 'back_in_stock_wishlist',
  enabled: true,
  name: 'Back in Stock (Wishlist)',
  coupon_id: null,
  discount_percent: 0,
  delay_hours: 1,
  parameters: {},
} as any

const defaultParams = backInStockWishlist.defaultParams as any
const row = { user_id: 'u1', product_id: 'p1', product_name: 'Widget', product_slug: 'widget' }

describe('backInStockWishlist scenario', () => {
  beforeEach(() => vi.clearAllMocks())

  it('has kind back_in_stock_wishlist', () => {
    expect(backInStockWishlist.kind).toBe('back_in_stock_wishlist')
  })

  describe('findEligible', () => {
    it('scans snapshot_in_stock=FALSE now in stock, cooldown as minutes', async () => {
      mockQueryMany.mockResolvedValue([row])
      const rows = await backInStockWishlist.findEligible({ campaign, params: defaultParams })
      expect(rows).toHaveLength(1)
      const [sql, args] = mockQueryMany.mock.calls[0]
      expect(sql).toContain('wi.snapshot_in_stock = FALSE')
      expect(sql).toContain('p.inventory_quantity > 0')
      // [kind, cooldown, maxWatches]
      expect(args[1]).toBe(String(days(1)))
      expect(args[2]).toBe(defaultParams.maxWatchesPerSweep)
    })
  })

  describe('send', () => {
    beforeEach(() => {
      mockFetchUser.mockResolvedValue({ first_name: 'Sam', baseUrl: 'https://shop.test', unsubscribe_token: 't' })
    })

    it('emails with product_id reference and flips the snapshot to in-stock', async () => {
      const res = await backInStockWishlist.send(row, { campaign, params: defaultParams })
      expect(res.ok).toBe(true)
      expect(mockSendEmail.mock.calls[0][0].referenceId).toBe('p1')
      // UPDATE wishlist snapshot ran
      const updateCall = mockQuery.mock.calls.find(c => String(c[0]).includes('UPDATE wishlist_items'))
      expect(updateCall).toBeTruthy()
      expect(updateCall![1]).toEqual(['u1', 'p1'])
    })

    it('sends WhatsApp with cooldown days when enabled', async () => {
      await backInStockWishlist.send(row, { campaign, params: { ...defaultParams, whatsappEnabled: true } })
      expect(mockSendWa).toHaveBeenCalledOnce()
      const [kind, userId, vars, cd] = mockSendWa.mock.calls[0]
      expect(kind).toBe('back_in_stock_wishlist')
      expect(userId).toBe('u1')
      expect(vars.product).toBe('Widget')
      expect(cd).toBe(1)
    })

    it('returns no_user when the user is gone', async () => {
      mockFetchUser.mockResolvedValue(null)
      const res = await backInStockWishlist.send(row, { campaign, params: defaultParams })
      expect(res).toEqual({ ok: false, reason: 'no_user' })
    })
  })
})
