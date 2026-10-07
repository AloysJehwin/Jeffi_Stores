import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))

import { grantOrderEntitlements, revokeOrderEntitlements } from '@/lib/orders/entitlements'

// A minimal fake PoolClient that records calls and returns a scripted rowCount.
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

describe('grantOrderEntitlements', () => {
  beforeEach(() => vi.clearAllMocks())

  it('inserts active entitlements only for digital lines and stamps granted_at', async () => {
    const { client, calls } = fakeClient([2, 2]) // 2 inserted, then the granted_at update
    const n = await grantOrderEntitlements(client, { orderId: 'o1', userId: 'u1' })
    expect(n).toBe(2)
    expect(calls[0].sql).toMatch(/INSERT INTO vault_entitlements/)
    expect(calls[0].sql).toMatch(/oi\.is_digital = TRUE/)
    expect(calls[0].sql).toMatch(/ON CONFLICT \(order_item_id\) DO UPDATE/)
    expect(calls[0].params).toEqual(['o1', 'u1', 'one_time', null, null])
    // second call stamps order_items.granted_at
    expect(calls[1].sql).toMatch(/UPDATE order_items SET granted_at/)
  })

  it('is idempotent: when nothing new is inserted it skips the granted_at update', async () => {
    const { client, calls } = fakeClient([0])
    const n = await grantOrderEntitlements(client, { orderId: 'o1', userId: 'u1' })
    expect(n).toBe(0)
    expect(calls).toHaveLength(1) // no second UPDATE
  })

  it('passes subscription source and access expiry through', async () => {
    const { client, calls } = fakeClient([1, 1])
    const exp = new Date('2026-12-01T00:00:00Z')
    await grantOrderEntitlements(client, {
      orderId: 'o2',
      userId: 'u2',
      source: 'subscription',
      subscriptionId: 'sub1',
      accessExpiresAt: exp,
    })
    expect(calls[0].params).toEqual(['o2', 'u2', 'subscription', 'sub1', exp])
  })
})

describe('revokeOrderEntitlements', () => {
  beforeEach(() => vi.clearAllMocks())

  it('revokes the whole order when no line ids are given', async () => {
    const { client, calls } = fakeClient([3, 3])
    const n = await revokeOrderEntitlements(client, { orderId: 'o1', reason: 'refund' })
    expect(n).toBe(3)
    expect(calls[0].sql).toMatch(/status = 'revoked'/)
    expect(calls[0].sql).not.toMatch(/ANY\(\$3/)
    expect(calls[0].params).toEqual(['o1', 'refund'])
    expect(calls[1].sql).toMatch(/UPDATE order_items SET access_revoked_at/)
    expect(calls[1].sql).toMatch(/AND is_digital = TRUE/)
  })

  it('revokes only the named lines for a per-line refund', async () => {
    const { client, calls } = fakeClient([1, 1])
    await revokeOrderEntitlements(client, { orderId: 'o1', orderItemIds: ['li1'], reason: 'partial_refund' })
    expect(calls[0].sql).toMatch(/order_item_id = ANY\(\$3::uuid\[\]\)/)
    expect(calls[0].params).toEqual(['o1', 'partial_refund', ['li1']])
    expect(calls[1].sql).toMatch(/id = ANY\(\$2::uuid\[\]\)/)
  })

  it('truncates an over-long reason to 40 chars', async () => {
    const { client, calls } = fakeClient([1, 1])
    await revokeOrderEntitlements(client, { orderId: 'o1', reason: 'x'.repeat(100) })
    expect((calls[0].params[1] as string).length).toBe(40)
  })
})
