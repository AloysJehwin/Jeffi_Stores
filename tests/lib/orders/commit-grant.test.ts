import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))

import { grantDigitalEntitlementsIfAny } from '@/lib/orders/after-commit'

/**
 * These prove the in-transaction grant hook commitOrder calls is a NO-OP GUARD today: for an
 * all-physical order (no order_items row has is_digital = TRUE) the entitlement INSERT ... SELECT
 * matches zero rows, so nothing is granted and no granted_at stamp runs. We drive it with a fake
 * PoolClient scripted to return rowCount 0 from the grant INSERT (what Postgres returns when no
 * is_digital line exists) — the same fake-client shape the entitlements unit test uses.
 */
function fakeClient(rowCounts: number[] = []) {
  const calls: { sql: string; params: any[] }[] = []
  let i = 0
  const client = {
    query: vi.fn(async (sql: string, params: any[] = []) => {
      calls.push({ sql, params })
      const rowCount = rowCounts[i] ?? 0
      i += 1
      return { rowCount, rows: Array.from({ length: rowCount }, (_, k) => ({ id: `row-${k}` })) }
    }),
  }
  return { client: client as any, calls }
}

describe('grantDigitalEntitlementsIfAny (commitOrder in-transaction grant hook)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('grants nothing for an all-physical order and never stamps granted_at', async () => {
    // rowCount 0 from the INSERT ... SELECT = no is_digital line matched (every order today).
    const { client, calls } = fakeClient([0])
    const n = await grantDigitalEntitlementsIfAny(client, { orderId: 'o1', userId: 'u1' })

    expect(n).toBe(0)
    // Exactly one query ran — the guarded INSERT. The granted_at UPDATE is skipped when 0 rows insert.
    expect(calls).toHaveLength(1)
    expect(calls[0].sql).toMatch(/INSERT INTO vault_entitlements/)
    expect(calls[0].sql).toMatch(/oi\.is_digital = TRUE/)
    expect(calls[0].params).toEqual(['o1', 'u1', 'one_time', null, null])
  })

  it('uses the SAME client it is handed (grant runs inside the caller transaction)', async () => {
    const { client } = fakeClient([0])
    await grantDigitalEntitlementsIfAny(client, { orderId: 'o1', userId: 'u1' })
    expect(client.query).toHaveBeenCalledTimes(1)
  })

  it('would grant + stamp if digital lines existed (proves the guard is the only thing suppressing it)', async () => {
    const { client, calls } = fakeClient([2, 2]) // 2 digital lines inserted, then the granted_at stamp
    const n = await grantDigitalEntitlementsIfAny(client, { orderId: 'o1', userId: 'u1' })
    expect(n).toBe(2)
    expect(calls).toHaveLength(2)
    expect(calls[1].sql).toMatch(/UPDATE order_items SET granted_at/)
  })
})
