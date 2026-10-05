import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/lib/shared/db', () => ({ queryMany: vi.fn(), queryOne: vi.fn(), withTransaction: vi.fn() }))
vi.mock('@/lib/loyalty/settings', () => ({ getLoyaltySettings: vi.fn(), markLoyaltyLaunched: vi.fn() }))

import {
  orderStateParams,
  orderStatesCte,
  reconcileLoyalty,
  reconcileLoyaltyUntilDone,
} from '@/lib/loyalty/reconcile'
import { queryMany, queryOne, withTransaction } from '@/lib/shared/db'
import { getLoyaltySettings, markLoyaltyLaunched, type LoyaltySettings } from '@/lib/loyalty/settings'
import { BASE_TIER } from '@/lib/loyalty/tiers'

const mockQueryMany = queryMany as ReturnType<typeof vi.fn>
const mockQueryOne = queryOne as ReturnType<typeof vi.fn>
const mockWithTransaction = withTransaction as ReturnType<typeof vi.fn>
const mockSettings = getLoyaltySettings as ReturnType<typeof vi.fn>
const mockMarkLaunched = markLoyaltyLaunched as ReturnType<typeof vi.fn>

const launched: LoyaltySettings = {
  enabled: true,
  rupeesPerPoint: 100,
  pointValue: 1,
  creditDelayDays: 7,
  minRedeemPoints: 100,
  tiers: [
    BASE_TIER,
    { key: 'silver', name: 'Silver', minPoints: 100, multiplier: 1.25 },
    { key: 'gold', name: 'Gold', minPoints: 500, multiplier: 1.5 },
    { key: 'platinum', name: 'Platinum', minPoints: 1500, multiplier: 2 },
  ],
  countFrom: null,
  launchedAt: '2026-10-01T00:00:00.000Z',
}

interface Fixture {
  actions?: Array<{ order_id: string; net: number; base: number; points_due: number; state: 'earn' | 'reverse' }>
  refunds?: Array<{ coupon_id: string; points: number }>
  account?: { points: number; lifetime_points: number; tier: string } | null
  sums?: { points: number; lifetime: number }
  fail?: boolean
}

let statements: Array<{ sql: string; params: any[] }>

function useFixtures(fixtures: Record<string, Fixture>) {
  const client = {
    query: vi.fn(async (sql: string, params: any[] = []) => {
      const text = String(sql)
      statements.push({ sql: text, params })
      const fixture = fixtures[params.find(p => typeof p === 'string' && p in fixtures)] ?? {}
      if (text.includes('pg_advisory_xact_lock')) {
        if (fixture.fail) throw new Error('lock failed')
        return { rows: [] }
      }
      if (text.includes('FROM states')) return { rows: fixture.actions ?? [] }
      if (text.includes("r.reason = 'redeem'")) return { rows: fixture.refunds ?? [] }
      if (text.includes('SELECT 1 FROM loyalty_accounts')) return { rows: fixture.account === null ? [] : [{}] }
      if (text.includes('AS lifetime')) return { rows: [fixture.sums ?? { points: 0, lifetime: 0 }] }
      if (text.includes('FOR UPDATE')) {
        return { rows: [fixture.account ?? { points: 0, lifetime_points: 0, tier: 'bronze' }] }
      }
      return { rows: [] }
    }),
  }
  mockWithTransaction.mockImplementation(async (fn: (c: typeof client) => unknown) => fn(client))
}

function pendingUsers(...ids: string[]) {
  mockQueryMany.mockResolvedValue(ids.map(user_id => ({ user_id })))
}

function find(fragment: string) {
  return statements.filter(statement => statement.sql.includes(fragment))
}

function ledgerInsert(reason: string) {
  return find('INSERT INTO loyalty_ledger').filter(statement => statement.sql.includes(`'${reason}'`))
}

describe('loyalty reconcile', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    statements = []
    mockSettings.mockResolvedValue(launched)
    mockQueryMany.mockResolvedValue([])
    mockQueryOne.mockResolvedValue({ pending: false })
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('does nothing while the program is off', async () => {
    mockSettings.mockResolvedValue({ ...launched, enabled: false })
    const result = await reconcileLoyalty()
    expect(result).toMatchObject({ enabled: false, users: 0, earned: 0 })
    expect(mockQueryMany).not.toHaveBeenCalled()
    expect(mockWithTransaction).not.toHaveBeenCalled()
  })

  it('credits a matured order with its points and the amount they were worked out from', async () => {
    pendingUsers('u1')
    useFixtures({
      u1: {
        actions: [{ order_id: 'o1', net: 0, base: 4200, points_due: 42, state: 'earn' }],
        sums: { points: 42, lifetime: 42 },
      },
    })
    const result = await reconcileLoyalty()
    expect(result).toMatchObject({ users: 1, earned: 42, reversed: 0, upgrades: 0, failures: 0 })
    expect(ledgerInsert('order_earn')[0].params).toEqual(['u1', 42, 'o1', 4200])
    expect(find('UPDATE loyalty_accounts')[0].params).toEqual(['u1', 42, 42, 'bronze', false])
  })

  it('settles a zero-point order too, so it is never looked at again', async () => {
    pendingUsers('u1')
    useFixtures({ u1: { actions: [{ order_id: 'o1', net: 0, base: 60, points_due: 0, state: 'earn' }] } })
    const result = await reconcileLoyalty()
    expect(result.earned).toBe(0)
    expect(ledgerInsert('order_earn')[0].params).toEqual(['u1', 0, 'o1', 60])
  })

  it('takes back exactly what the order still holds when it is returned or cancelled', async () => {
    pendingUsers('u1')
    useFixtures({
      u1: {
        actions: [{ order_id: 'o1', net: 42, base: 4200, points_due: 42, state: 'reverse' }],
        account: { points: 42, lifetime_points: 42, tier: 'bronze' },
        sums: { points: 0, lifetime: 0 },
      },
    })
    const result = await reconcileLoyalty()
    expect(result).toMatchObject({ earned: 0, reversed: 42 })
    expect(ledgerInsert('order_reversal')[0].params).toEqual(['u1', -42, 'o1'])
  })

  it('gives points back when a reward coupon was used on a cancelled or returned order', async () => {
    pendingUsers('u1')
    useFixtures({ u1: { refunds: [{ coupon_id: 'c1', points: 150 }], sums: { points: 150, lifetime: 300 } } })
    const result = await reconcileLoyalty()
    expect(result.refunded).toBe(150)
    expect(ledgerInsert('redeem_refund')[0].params).toEqual(['u1', 150, 'c1'])
  })

  it('stamps the upgrade time when a customer reaches a higher tier', async () => {
    pendingUsers('u1')
    useFixtures({
      u1: {
        actions: [{ order_id: 'o1', net: 0, base: 12000, points_due: 120, state: 'earn' }],
        sums: { points: 120, lifetime: 120 },
      },
    })
    const result = await reconcileLoyalty()
    expect(result.upgrades).toBe(1)
    expect(find('UPDATE loyalty_accounts')[0].params).toEqual(['u1', 120, 120, 'silver', true])
    expect(mockMarkLaunched).not.toHaveBeenCalled()
  })

  it('upgrades silently on the first pass and then marks the program launched', async () => {
    mockSettings.mockResolvedValue({ ...launched, launchedAt: null })
    pendingUsers('u1')
    useFixtures({
      u1: {
        actions: [{ order_id: 'o1', net: 0, base: 60000, points_due: 600, state: 'earn' }],
        sums: { points: 600, lifetime: 600 },
      },
    })
    const result = await reconcileLoyalty()
    expect(result).toMatchObject({ silent: true, upgrades: 1 })
    expect(find('UPDATE loyalty_accounts')[0].params).toEqual(['u1', 600, 600, 'gold', false])
    expect(mockMarkLaunched).toHaveBeenCalledTimes(1)
  })

  it('never moves a customer down a tier', async () => {
    pendingUsers('u1')
    useFixtures({
      u1: {
        actions: [{ order_id: 'o1', net: 600, base: 60000, points_due: 600, state: 'reverse' }],
        account: { points: 600, lifetime_points: 600, tier: 'gold' },
        sums: { points: 0, lifetime: 0 },
      },
    })
    const result = await reconcileLoyalty()
    expect(result.upgrades).toBe(0)
    expect(find('UPDATE loyalty_accounts')[0].params).toEqual(['u1', 0, 0, 'gold', false])
  })

  it('leaves the account row alone when nothing changed', async () => {
    pendingUsers('u1')
    useFixtures({
      u1: { account: { points: 10, lifetime_points: 10, tier: 'bronze' }, sums: { points: 10, lifetime: 10 } },
    })
    await reconcileLoyalty()
    expect(find('UPDATE loyalty_accounts')).toHaveLength(0)
  })

  it('does not open an account for a customer with nothing to record', async () => {
    pendingUsers('u1')
    useFixtures({ u1: { account: null } })
    await reconcileLoyalty()
    expect(find('INSERT INTO loyalty_accounts')).toHaveLength(0)
    expect(find('INSERT INTO loyalty_ledger')).toHaveLength(0)
  })

  it('works on at most the batch size and keeps the first pass silent until everyone is done', async () => {
    mockSettings.mockResolvedValue({ ...launched, launchedAt: null })
    pendingUsers('u1', 'u2', 'u3')
    useFixtures({})
    const result = await reconcileLoyalty({ maxUsers: 2 })
    expect(result).toMatchObject({ users: 2, more: true })
    expect(mockWithTransaction).toHaveBeenCalledTimes(2)
    expect(mockQueryMany.mock.calls[0][1].at(-1)).toBe(3)
    expect(mockMarkLaunched).not.toHaveBeenCalled()
  })

  it('carries on when one customer fails', async () => {
    pendingUsers('u1', 'u2')
    useFixtures({
      u1: { fail: true },
      u2: {
        actions: [{ order_id: 'o2', net: 0, base: 500, points_due: 5, state: 'earn' }],
        sums: { points: 5, lifetime: 5 },
      },
    })
    const result = await reconcileLoyalty()
    expect(result).toMatchObject({ users: 1, earned: 5, failures: 1 })
  })

  it('locks the customer before reading what is due', async () => {
    pendingUsers('u1')
    useFixtures({ u1: {} })
    await reconcileLoyalty()
    expect(statements[0].sql).toContain('pg_advisory_xact_lock')
    expect(statements[0].params[1]).toBe('u1')
  })

  describe('for one customer', () => {
    it('skips the transaction when that customer has nothing due', async () => {
      useFixtures({})
      const result = await reconcileLoyalty({ userId: 'u1' })
      expect(result.users).toBe(0)
      expect(mockWithTransaction).not.toHaveBeenCalled()
      expect(mockQueryMany).not.toHaveBeenCalled()
    })

    it('settles that customer and never marks the program launched', async () => {
      mockSettings.mockResolvedValue({ ...launched, launchedAt: null })
      mockQueryOne.mockResolvedValue({ pending: true })
      useFixtures({
        u1: {
          actions: [{ order_id: 'o1', net: 0, base: 900, points_due: 9, state: 'earn' }],
          sums: { points: 9, lifetime: 9 },
        },
      })
      const result = await reconcileLoyalty({ userId: 'u1' })
      expect(result).toMatchObject({ users: 1, earned: 9 })
      expect(mockMarkLaunched).not.toHaveBeenCalled()
      expect(mockQueryOne.mock.calls[0][1]).toEqual([7, null, 100, expect.any(String), 'u1', 100, 500, 1500])
    })
  })

  describe('reconcileLoyaltyUntilDone', () => {
    it('keeps going while there is more to do', async () => {
      useFixtures({})
      mockQueryMany
        .mockResolvedValueOnce(Array.from({ length: 501 }, (_, i) => ({ user_id: `a${i}` })))
        .mockResolvedValueOnce([{ user_id: 'last' }])
      const result = await reconcileLoyaltyUntilDone()
      expect(result).toMatchObject({ users: 501, more: false })
      expect(mockQueryMany).toHaveBeenCalledTimes(2)
    })
  })

  describe('order rules in SQL', () => {
    const sql = orderStatesCte(false)

    it('counts only online orders the customer kept and paid for, never offline or business orders', () => {
      expect(sql).toContain("o.source = 'online' AND o.status IN ('delivered', 'return_rejected')")
      expect(sql).toContain("o.payment_status IN ('paid', 'cod_collected')")
    })

    it('keeps an order with a ledger row visible so a now-ineligible order can be reversed', () => {
      expect(sql).toContain('l.order_id IS NOT NULL')
      expect(sql).not.toMatch(/WHERE o\.source = 'online'\s+AND/)
    })

    it('works points out from goods value after discounts', () => {
      expect(sql).toContain('GREATEST(COALESCE(o.subtotal, 0) - COALESCE(o.discount_amount, 0), 0)')
    })

    it('dates an order by delivery, else by creation, never by a timestamp that moves', () => {
      expect(sql).toContain('COALESCE(o.delivered_at, o.created_at)')
      expect(sql).not.toContain('updated_at')
    })

    it('owns an order by account, or by matching email and phone when it has no account', () => {
      expect(sql).toContain('(o.user_id IS NULL OR ou.is_guest = TRUE)')
      expect(sql).toContain('u.email = o.customer_email AND u.phone = o.customer_phone')
      expect(sql).toContain("bp.approval_status = 'approved'")
      expect(sql).toContain('COALESCE(l.user_id, direct.id, matched.id) AS owner_id')
    })

    it('lets only the order state take points back, never the wait or the count-from date', () => {
      expect(sql).toMatch(/WHEN NOT f\.kept AND f\.credited THEN 'reverse'/)
      expect(sql).toMatch(
        /WHEN f\.kept AND NOT f\.credited AND f\.in_range AND d\.owner_eligible\s+THEN CASE WHEN f\.matured THEN 'earn' WHEN d\.points_due >= 1 THEN 'pending' END/
      )
    })

    it('gives a restored order the points it held before instead of recalculating', () => {
      expect(sql).toContain("FILTER (WHERE reason = 'order_earn'))[1] AS last_earned")
      expect(sql).toContain('COALESCE(f.last_earned, FLOOR(f.base / $3::numeric')
    })

    it('binds the customer only in the scoped form', () => {
      expect(sql).not.toContain('$5')
      expect(orderStatesCte(true)).toContain('$5::uuid')
    })

    it('passes the delay, start date, rate and tier multipliers', () => {
      const params = orderStateParams({ ...launched, countFrom: '2026-01-01' })
      expect(params.slice(0, 3)).toEqual([7, '2026-01-01', 100])
      expect(JSON.parse(params[3] as string)).toEqual({ bronze: 1, silver: 1.25, gold: 1.5, platinum: 2 })
    })
  })
})
