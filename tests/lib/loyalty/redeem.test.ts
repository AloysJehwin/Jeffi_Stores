import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/lib/shared/db', () => ({ queryOne: vi.fn(), withTransaction: vi.fn() }))
vi.mock('@/lib/loyalty/settings', () => ({ getLoyaltySettings: vi.fn() }))
vi.mock('@/lib/loyalty/reconcile', () => ({
  eligibleCustomerSql: () => 'TRUE',
  ensureLoyaltyAccount: vi.fn(),
  lockLoyaltyUser: vi.fn(),
  refreshLoyaltyAccount: vi.fn(),
}))

import { adjustPoints, redeemPoints } from '@/lib/loyalty/redeem'
import { queryOne, withTransaction } from '@/lib/shared/db'
import { getLoyaltySettings } from '@/lib/loyalty/settings'
import { lockLoyaltyUser, refreshLoyaltyAccount } from '@/lib/loyalty/reconcile'

const mockQueryOne = queryOne as ReturnType<typeof vi.fn>
const mockWithTransaction = withTransaction as ReturnType<typeof vi.fn>
const mockSettings = getLoyaltySettings as ReturnType<typeof vi.fn>
const mockLock = lockLoyaltyUser as ReturnType<typeof vi.fn>
const mockRefresh = refreshLoyaltyAccount as ReturnType<typeof vi.fn>

const settings = { enabled: true, pointValue: 1, minRedeemPoints: 100, launchedAt: '2026-10-01T00:00:00.000Z' }

let statements: Array<{ sql: string; params: any[] }>

function useClient(opts: { balance?: number; collisions?: number } = {}) {
  let collisions = opts.collisions ?? 0
  const client = {
    query: vi.fn(async (sql: string, params: any[] = []) => {
      const text = String(sql)
      statements.push({ sql: text, params })
      if (text.includes('SUM(delta)')) return { rows: [{ points: opts.balance ?? 0 }] }
      if (text.includes('INSERT INTO coupons')) {
        if (collisions > 0) {
          collisions -= 1
          return { rows: [] }
        }
        return { rows: [{ id: 'c1', code: params[0] }] }
      }
      return { rows: [] }
    }),
  }
  mockWithTransaction.mockImplementation(async (fn: (c: typeof client) => unknown) => fn(client))
  return client
}

function inserts(table: string) {
  return statements.filter(statement => statement.sql.includes(`INSERT INTO ${table}`))
}

describe('loyalty redemption', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    statements = []
    mockSettings.mockResolvedValue(settings)
    mockQueryOne.mockResolvedValue({ '?column?': 1 })
    mockRefresh.mockResolvedValue({ points: 150, lifetimePoints: 400, tier: 'silver', upgraded: false })
  })

  describe('redeemPoints', () => {
    it('refuses while the program is off', async () => {
      mockSettings.mockResolvedValue({ ...settings, enabled: false })
      expect(await redeemPoints('u1', 200)).toEqual({ ok: false, reason: 'disabled' })
      expect(mockWithTransaction).not.toHaveBeenCalled()
    })

    it('refuses anything that is not a positive whole number of points', async () => {
      for (const points of [0, -5, 1.5, Number.NaN, 1_000_001]) {
        expect(await redeemPoints('u1', points)).toEqual({ ok: false, reason: 'invalid_points' })
      }
    })

    it('refuses below the minimum and says what the minimum is', async () => {
      expect(await redeemPoints('u1', 99)).toEqual({ ok: false, reason: 'below_minimum', minimum: 100 })
    })

    it('refuses guests, inactive and business accounts', async () => {
      mockQueryOne.mockResolvedValue(null)
      expect(await redeemPoints('u1', 200)).toEqual({ ok: false, reason: 'not_eligible' })
      expect(mockWithTransaction).not.toHaveBeenCalled()
    })

    it('refuses more points than the ledger holds and creates no coupon', async () => {
      useClient({ balance: 150 })
      expect(await redeemPoints('u1', 200)).toEqual({ ok: false, reason: 'insufficient_points' })
      expect(inserts('coupons')).toHaveLength(0)
      expect(inserts('loyalty_ledger')).toHaveLength(0)
    })

    it('creates a personal single-use fixed coupon and debits the points', async () => {
      useClient({ balance: 350 })
      const result = await redeemPoints('u1', 200)
      expect(result).toMatchObject({ ok: true, value: 200, points: 200, balance: 150 })

      const coupon = inserts('coupons')[0]
      expect(coupon.sql).toContain("'fixed', $2, $2, 1, 1")
      expect(coupon.params[0]).toMatch(/^RWD-[A-HJ-NP-Z2-9]{8}$/)
      expect(coupon.params.slice(1)).toEqual([200, 'u1', 'loyalty_reward'])
      expect(result.ok && result.code).toBe(coupon.params[0])

      expect(inserts('loyalty_ledger')[0].sql).toContain("'redeem'")
      expect(inserts('loyalty_ledger')[0].params).toEqual(['u1', -200, 'c1', 200])
    })

    it('prices the coupon with the store point value', async () => {
      mockSettings.mockResolvedValue({ ...settings, pointValue: 0.5 })
      useClient({ balance: 300 })
      const result = await redeemPoints('u1', 250)
      expect(result).toMatchObject({ ok: true, value: 125 })
      expect(inserts('coupons')[0].params[1]).toBe(125)
    })

    it('takes the customer lock before reading the balance', async () => {
      const client = useClient({ balance: 500 })
      await redeemPoints('u1', 100)
      expect(mockLock.mock.invocationCallOrder[0]).toBeLessThan(client.query.mock.invocationCallOrder[0])
    })

    it('tries a new code when one is already taken', async () => {
      useClient({ balance: 500, collisions: 2 })
      const result = await redeemPoints('u1', 100)
      expect(result.ok).toBe(true)
      expect(inserts('coupons')).toHaveLength(3)
      expect(new Set(inserts('coupons').map(statement => statement.params[0])).size).toBe(3)
    })

    it('gives up rather than debit points without a coupon', async () => {
      useClient({ balance: 500, collisions: 5 })
      await expect(redeemPoints('u1', 100)).rejects.toThrow('reward coupon code')
      expect(inserts('loyalty_ledger')).toHaveLength(0)
    })
  })

  describe('adjustPoints', () => {
    const input = { userId: 'u1', delta: 50, note: 'Goodwill', adminId: 'a1' }

    it('refuses while the program is off', async () => {
      mockSettings.mockResolvedValue({ ...settings, enabled: false })
      expect(await adjustPoints(input)).toEqual({ ok: false, reason: 'disabled' })
    })

    it('refuses zero, fractions and absurd amounts', async () => {
      for (const delta of [0, 2.5, 1_000_001, -1_000_001]) {
        expect(await adjustPoints({ ...input, delta })).toEqual({ ok: false, reason: 'invalid_delta' })
      }
    })

    it('needs a note', async () => {
      expect(await adjustPoints({ ...input, note: '   ' })).toEqual({ ok: false, reason: 'note_required' })
    })

    it('refuses accounts that cannot earn', async () => {
      mockQueryOne.mockResolvedValue(null)
      expect(await adjustPoints(input)).toEqual({ ok: false, reason: 'not_eligible' })
    })

    it('records the adjustment with its note and who made it', async () => {
      useClient()
      const result = await adjustPoints({ ...input, delta: -30, note: `  ${'x'.repeat(600)}  ` })
      expect(result).toEqual({ ok: true, points: 150, lifetimePoints: 400, tier: 'silver' })
      const [userId, delta, note, adminId] = inserts('loyalty_ledger')[0].params
      expect([userId, delta, adminId]).toEqual(['u1', -30, 'a1'])
      expect(note).toHaveLength(500)
      expect(inserts('loyalty_ledger')[0].sql).toContain("'adjustment'")
    })
  })
})
