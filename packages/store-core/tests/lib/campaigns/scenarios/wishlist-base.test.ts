import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/lib/shared/db', () => ({ query: vi.fn() }))

import {
  isRetryable,
  syncWishlistSnapshots,
  refreshWishlistSnapshot,
  settleWishlistEvent,
  NOT_RECENTLY_EMAILED_SQL,
} from '@/lib/campaigns/scenarios/_wishlist-base'
import { query } from '@/lib/shared/db'

const mockQuery = query as ReturnType<typeof vi.fn>

describe('wishlist campaign bookkeeping', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 })
  })

  describe('isRetryable', () => {
    it('treats caps and delivery failures as retryable', () => {
      expect(isRetryable('frequency_cap')).toBe(true)
      expect(isRetryable('send_failed')).toBe(true)
      expect(isRetryable('record_failed')).toBe(true)
    })

    it('treats everything else as final', () => {
      expect(isRetryable('already_sent')).toBe(false)
      expect(isRetryable('opted_out')).toBe(false)
      expect(isRetryable('no_email')).toBe(false)
      expect(isRetryable(undefined)).toBe(false)
    })
  })

  describe('syncWishlistSnapshots', () => {
    const calls = () => mockQuery.mock.calls.map(c => String(c[0]))

    it('stamps unsnapshotted wishlist rows and saved cart rows with the current price and status-based stock', async () => {
      await syncWishlistSnapshots()
      const stamps = calls().filter(sql => sql.includes('wi.snapshot_taken_at IS NULL'))
      expect(stamps).toHaveLength(2)
      expect(stamps[0]).toContain('UPDATE wishlist_items wi')
      expect(stamps[1]).toContain('UPDATE cart_items wi')
      expect(stamps[1]).toContain('wi.saved_for_later = TRUE')
      for (const sql of stamps) {
        expect(sql).toContain('snapshot_price = p.base_price')
        expect(sql).toContain("stock_status IS DISTINCT FROM 'Out of Stock'")
        expect(sql).not.toContain('inventory_quantity')
      }
    })

    it('marks saved products that have gone out of stock, without touching the saved price', async () => {
      await syncWishlistSnapshots()
      const marks = calls().filter(sql => sql.includes('SET snapshot_in_stock = FALSE'))
      expect(marks).toHaveLength(2)
      for (const sql of marks) {
        expect(sql).toContain('wi.snapshot_in_stock = TRUE')
        expect(sql).toMatch(/AND NOT\s+\(CASE/)
        expect(sql).not.toContain('snapshot_price')
      }
    })

    it('clears the baseline of a cart item moved back into the cart, so saving it again starts fresh', async () => {
      await syncWishlistSnapshots()
      const sql = calls()[0]
      expect(sql).toContain('UPDATE cart_items')
      expect(sql).toContain('snapshot_price = NULL')
      expect(sql).toContain('saved_for_later = FALSE')
    })

    it('counts a variant product as in stock when any active variant is purchasable', async () => {
      await syncWishlistSnapshots()
      const sql = calls().find(q => q.includes('wi.snapshot_taken_at IS NULL'))
      expect(sql).toContain('WHEN p.has_variants = true THEN')
      expect(sql).toContain('FROM product_variants pv')
    })

    it('propagates a database error so the sweep records the failure', async () => {
      mockQuery.mockRejectedValueOnce(new Error('relation missing'))
      await expect(syncWishlistSnapshots()).rejects.toThrow('relation missing')
    })
  })

  describe('refreshWishlistSnapshot', () => {
    it('resets the row in both the wishlist and the saved-for-later cart', async () => {
      await refreshWishlistSnapshot('u1', 'p1')
      expect(mockQuery).toHaveBeenCalledTimes(2)
      const [wishSql, args] = mockQuery.mock.calls[0]
      expect(String(wishSql)).toContain('UPDATE wishlist_items wi')
      expect(String(wishSql)).toContain('snapshot_price = p.base_price')
      expect(String(wishSql)).toContain('wi.user_id = $1')
      expect(args).toEqual(['u1', 'p1'])
      expect(String(mockQuery.mock.calls[1][0])).toContain('UPDATE cart_items wi')
    })
  })

  describe('settleWishlistEvent', () => {
    it('refreshes the snapshot once the email went out', async () => {
      await settleWishlistEvent({ ok: true }, 'u1', 'p1')
      expect(mockQuery).toHaveBeenCalledTimes(2)
    })

    it('refreshes the snapshot when the failure is final', async () => {
      await settleWishlistEvent({ ok: false, reason: 'already_sent' }, 'u1', 'p1')
      expect(mockQuery).toHaveBeenCalledTimes(2)
    })

    it('leaves the row pending when the failure can be retried', async () => {
      await settleWishlistEvent({ ok: false, reason: 'frequency_cap' }, 'u1', 'p1')
      await settleWishlistEvent({ ok: false, reason: 'send_failed' }, 'u1', 'p1')
      expect(mockQuery).not.toHaveBeenCalled()
    })

    it('never throws when the refresh fails', async () => {
      mockQuery.mockRejectedValueOnce(new Error('db down'))
      await expect(settleWishlistEvent({ ok: true }, 'u1', 'p1')).resolves.toBeUndefined()
    })
  })

  describe('NOT_RECENTLY_EMAILED_SQL', () => {
    it('excludes users this campaign emailed within the 72 hour cap', () => {
      expect(NOT_RECENTLY_EMAILED_SQL).toContain('ecs.campaign_kind = $1')
      expect(NOT_RECENTLY_EMAILED_SQL).toContain('ecs.user_id = wi.user_id')
      expect(NOT_RECENTLY_EMAILED_SQL).toContain("INTERVAL '72 hours'")
    })
  })
})
