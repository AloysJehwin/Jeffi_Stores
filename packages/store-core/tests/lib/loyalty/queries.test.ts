import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/lib/shared/db', () => ({ queryMany: vi.fn(), queryOne: vi.fn(), withTransaction: vi.fn() }))

import {
  getLoyaltyAccount,
  getLoyaltyStats,
  getLoyaltySummary,
  listLoyaltyLedger,
  listLoyaltyMembers,
  listRewardCoupons,
} from '@/lib/loyalty/queries'
import { queryMany, queryOne } from '@/lib/shared/db'
import { LOYALTY_DEFAULTS } from '@/lib/loyalty/settings'

const mockQueryMany = queryMany as ReturnType<typeof vi.fn>
const mockQueryOne = queryOne as ReturnType<typeof vi.fn>

const settings = { ...LOYALTY_DEFAULTS, enabled: true }

const ledgerRow = {
  id: 'l1',
  delta: 42,
  reason: 'order_earn',
  order_number: 'ORD-1',
  coupon_code: null,
  note: 'internal note',
  created_at: '2026-10-01T00:00:00.000Z',
}

describe('loyalty read models', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockQueryMany.mockResolvedValue([])
    mockQueryOne.mockResolvedValue(null)
  })

  it('shows a customer with no account as Bronze with no points', async () => {
    expect(await getLoyaltyAccount('u1')).toEqual({ points: 0, lifetimePoints: 0, tier: 'bronze', tierUpdatedAt: null })
  })

  it('lists history newest first and leaves out zero-point bookkeeping rows', async () => {
    mockQueryMany.mockResolvedValue([ledgerRow])
    mockQueryOne.mockResolvedValue({ total: 1 })
    const result = await listLoyaltyLedger('u1', 1, 10)
    const [sql, args] = mockQueryMany.mock.calls[0]
    expect(String(sql)).toContain('l.delta <> 0')
    expect(String(sql)).toContain('ORDER BY l.created_at DESC')
    expect(args).toEqual(['u1', 10, 0])
    expect(result.total).toBe(1)
    expect(result.page).toBe(1)
    expect(result.items[0]).toMatchObject({ id: 'l1', delta: 42, orderNumber: 'ORD-1', note: 'internal note' })
  })

  it('pages history with limit and offset', async () => {
    mockQueryMany.mockResolvedValue([])
    mockQueryOne.mockResolvedValue({ total: 45 })
    const result = await listLoyaltyLedger('u1', 3, 10)
    expect(mockQueryMany.mock.calls[0][1]).toEqual(['u1', 10, 20])
    expect(result.total).toBe(45)
  })

  it('lists only this customer unused reward coupons', async () => {
    mockQueryMany.mockResolvedValue([
      { code: 'RWD-AAAA2222', value: '200.00', min_purchase: '200.00', created_at: '2026-10-01' },
    ])
    mockQueryOne.mockResolvedValue({ total: 1 })
    const result = await listRewardCoupons('u1', 1, 6)
    const [sql, args] = mockQueryMany.mock.calls[0]
    expect(String(sql)).toContain('c.generated_for_user_id = $1')
    expect(String(sql)).toContain('c.times_used < COALESCE(c.usage_limit, 1)')
    expect(args).toEqual(['u1', 'loyalty_reward', 6, 0])
    expect(result.total).toBe(1)
    expect(result.items[0]).toMatchObject({ code: 'RWD-AAAA2222', value: 200, minPurchase: 200 })
  })

  describe('getLoyaltySummary', () => {
    function account(row: { points: number; lifetime_points: number; tier: string }) {
      mockQueryOne.mockImplementation(async (sql: string) => {
        const text = String(sql)
        if (text.includes('FROM states')) return { points: 30, next_credit_at: '2026-10-09T00:00:00.000Z' }
        if (text.includes('COUNT(*)')) return { total: 1 }
        return { ...row, tier_updated_at: null }
      })
      mockQueryMany.mockImplementation(async (sql: string) =>
        String(sql).includes('FROM loyalty_ledger') ? [ledgerRow] : []
      )
    }

    it('reports the tier, the next tier and how far away it is', async () => {
      account({ points: 150, lifetime_points: 420, tier: 'silver' })
      const summary = await getLoyaltySummary('u1', settings)
      expect(summary.tier).toEqual({ key: 'silver', name: 'Silver', multiplier: 1.25 })
      expect(summary.nextTier).toEqual({ key: 'gold', name: 'Gold', minPoints: 500, pointsToGo: 80 })
      expect(summary.points).toBe(150)
      expect(summary.pending).toEqual({ points: 30, nextCreditAt: '2026-10-09T00:00:00.000Z' })
    })

    it('never shows the store internal note to the customer', async () => {
      account({ points: 150, lifetime_points: 420, tier: 'silver' })
      const summary = await getLoyaltySummary('u1', settings)
      expect(summary.history.items).toHaveLength(1)
      expect(summary.history.items[0]).not.toHaveProperty('note')
    })

    it("never shows a referral reward's order number, which belongs to the friend", async () => {
      account({ points: 100, lifetime_points: 0, tier: 'bronze' })
      mockQueryMany.mockImplementation(async (sql: string) =>
        String(sql).includes('FROM loyalty_ledger')
          ? [{ ...ledgerRow, reason: 'referral', order_number: 'FRIEND-ORDER' }, ledgerRow]
          : []
      )
      const { items } = (await getLoyaltySummary('u1', settings)).history
      expect(items[0]).toMatchObject({ reason: 'referral', orderNumber: null })
      expect(items[1]).toMatchObject({ reason: 'order_earn', orderNumber: 'ORD-1' })
    })

    it('passes the requested page through to the history and coupon lists', async () => {
      account({ points: 150, lifetime_points: 420, tier: 'silver' })
      const summary = await getLoyaltySummary('u1', settings, { historyPage: 2, couponPage: 3 })
      expect(summary.history.page).toBe(2)
      expect(summary.coupons.page).toBe(3)
    })

    it('has no next tier at the top', async () => {
      account({ points: 10, lifetime_points: 9000, tier: 'platinum' })
      expect((await getLoyaltySummary('u1', settings)).nextTier).toBeNull()
    })

    it('measures the gap from zero when the lifetime balance went negative', async () => {
      account({ points: -20, lifetime_points: -20, tier: 'bronze' })
      expect((await getLoyaltySummary('u1', settings)).nextTier?.pointsToGo).toBe(100)
    })
  })

  describe('listLoyaltyMembers', () => {
    it('filters by a known tier and a search term, and pages', async () => {
      mockQueryMany.mockResolvedValue([
        {
          user_id: 'u1',
          first_name: 'Asha',
          last_name: null,
          email: 'asha@example.com',
          phone: null,
          tier: 'gold',
          points: 5,
          lifetime_points: 600,
          updated_at: '2026-10-01',
        },
      ])
      mockQueryOne.mockResolvedValue({ total: 31 })
      const result = await listLoyaltyMembers({ page: 2, pageSize: 25, tier: 'gold', search: ' asha ' })
      expect(mockQueryMany.mock.calls[0][1]).toEqual(['gold', '%asha%', 25, 25])
      expect(result.total).toBe(31)
      expect(result.members[0]).toMatchObject({ userId: 'u1', name: 'Asha', tier: 'gold', lifetimePoints: 600 })
    })

    it('ignores an unknown tier and falls back to the email for a nameless account', async () => {
      mockQueryMany.mockResolvedValue([
        {
          user_id: 'u2',
          first_name: null,
          last_name: null,
          email: 'x@example.com',
          phone: null,
          tier: 'bronze',
          points: 0,
          lifetime_points: 0,
          updated_at: '2026-10-01',
        },
      ])
      const result = await listLoyaltyMembers({ page: 1, pageSize: 25, tier: 'diamond', search: '' })
      expect(mockQueryMany.mock.calls[0][1]).toEqual([null, null, 25, 0])
      expect(result.members[0].name).toBe('x@example.com')
    })
  })

  it('counts members per tier, including tiers nobody has reached', async () => {
    mockQueryMany.mockResolvedValue([
      { tier: 'bronze', members: 21 },
      { tier: 'gold', members: 8 },
    ])
    mockQueryOne.mockResolvedValue({ outstanding: 9645, redeemed: 200 })
    expect(await getLoyaltyStats()).toEqual({
      members: 29,
      outstandingPoints: 9645,
      redeemedPoints: 200,
      byTier: { bronze: 21, silver: 0, gold: 8, platinum: 0 },
    })
  })
})
