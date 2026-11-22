import { describe, it, expect, vi, beforeEach } from 'vitest'

const queryOne = vi.fn()
const queryMany = vi.fn()
const poolQuery = vi.fn()
const lastRuns = vi.fn()
const isJobRunning = vi.fn()

vi.mock('@/lib/shared/db', () => ({
  queryOne: (...a: any[]) => queryOne(...a),
  queryMany: (...a: any[]) => queryMany(...a),
}))
vi.mock('@/lib/tenant-registry', () => ({ controlPlanePool: () => ({ query: (...a: any[]) => poolQuery(...a) }) }))
vi.mock('@/lib/channels/sync-run', () => ({
  lastRuns: (...a: any[]) => lastRuns(...a),
  isJobRunning: (...a: any[]) => isJobRunning(...a),
}))

import {
  settlementOverview,
  settlementDetail,
  estimatedSettlement,
  awaitingSettlement,
  orderSettlements,
} from '@/lib/payments/rzp-settlement-report'

beforeEach(() => {
  queryOne.mockReset()
  queryMany.mockReset()
  poolQuery.mockReset()
  lastRuns.mockReset().mockResolvedValue({})
  isJobRunning.mockReset().mockResolvedValue(false)
})

describe('estimatedSettlement (pure, T+2 business days)', () => {
  it('Mon capture -> Wed', () => {
    const mon = new Date('2026-01-05T10:00:00Z') // Monday
    expect(estimatedSettlement(mon).getUTCDay()).toBe(3) // Wednesday
  })
  it('Thu capture skips the weekend -> Mon', () => {
    const thu = new Date('2026-01-08T10:00:00Z') // Thursday
    const d = estimatedSettlement(thu)
    expect(d.getUTCDay()).toBe(1) // Monday
    expect(d.getUTCDate()).toBe(12)
  })
  it('does not mutate the input', () => {
    const d = new Date('2026-01-05T10:00:00Z')
    estimatedSettlement(d)
    expect(d.toISOString()).toBe('2026-01-05T10:00:00.000Z')
  })
})

describe('settlementOverview', () => {
  it('maps totals + rows + sync; own kind => account own', async () => {
    queryOne.mockResolvedValue({ settled: '1000', fees: '10', tax: '2', count: '5', to_stores: '300' })
    const rows = [{ id: 's1', amount: 1000 }]
    queryMany.mockResolvedValue(rows as any)
    lastRuns.mockResolvedValue({ settlements: { finished_at: 'T', status: 'ok', errors: [{ message: 'e' }] } })
    isJobRunning.mockResolvedValue(true)
    const r = await settlementOverview('own', '2026-01-01', '2026-01-31')
    expect(r.account).toBe('own')
    expect(r.totals).toEqual({ settled: 1000, fees: 10, tax: 2, count: 5, to_stores: 300 })
    expect(r.settlements).toBe(rows)
    expect(r.sync).toEqual({ running: true, last_at: 'T', last_status: 'ok', last_error: 'e' })
  })
  it('platform kind and null totals/run fall back', async () => {
    queryOne.mockResolvedValue(null)
    queryMany.mockResolvedValue([])
    lastRuns.mockResolvedValue({ settlements_day: { finished_at: 'T2', status: 'fail', errors: [] } })
    const r = await settlementOverview('platform', 'a', 'b')
    expect(r.account).toBe('platform')
    expect(r.totals).toEqual({ settled: 0, fees: 0, tax: 0, count: 0, to_stores: 0 })
    expect(r.sync).toEqual({ running: false, last_at: 'T2', last_status: 'fail', last_error: null })
  })
  it('route kind maps to platform account', async () => {
    queryOne.mockResolvedValue(null)
    queryMany.mockResolvedValue([])
    const r = await settlementOverview('route', 'a', 'b')
    expect(r.account).toBe('platform')
  })
})

describe('settlementDetail', () => {
  it('null when settlement not found', async () => {
    queryOne.mockResolvedValue(null)
    expect(await settlementDetail('s1')).toBeNull()
  })
  it('groups lines by scope with store grouping and ordering', async () => {
    queryOne.mockResolvedValue({ id: 's1', amount: 100 })
    queryMany.mockResolvedValue([
      { scope: 'order', credit: 100, debit: 0, fee: 2, entity_id: 'e1' },
      { scope: 'order', credit: 50, debit: 0, fee: 1, entity_id: 'e2' },
      { scope: 'other_store', source_tenant_slug: 'shopx', credit: 30, debit: 5, fee: 0, entity_id: 'e3' },
      { scope: 'adjustment', credit: 0, debit: 10, fee: 0, entity_id: 'e4' },
      { scope: 'unknownscope', credit: 1, debit: 0, fee: 0, entity_id: 'e5' },
    ] as any)
    const r = await settlementDetail('s1')
    expect(r!.settlement).toEqual({ id: 's1', amount: 100 })
    const order = r!.groups.find(g => g.scope === 'order')!
    expect(order.credit).toBe(150)
    expect(order.fees).toBe(3)
    expect(order.net).toBe(150)
    expect(order.lines).toHaveLength(2)
    const store = r!.groups.find(g => g.scope === 'other_store')!
    expect(store.key).toBe('store:shopx')
    expect(store.label).toBe('Store: shopx')
    expect(store.net).toBe(25)
    // known scopes keep GROUP_ORDER: order before other_store before adjustment
    const known = r!.groups.filter(g => ['order', 'other_store', 'adjustment'].includes(g.scope)).map(g => g.scope)
    expect(known).toEqual(['order', 'other_store', 'adjustment'])
    // unknown scope (indexOf -1) sorts ahead and its label falls back to the scope string
    const unk = r!.groups.find(g => g.scope === 'unknownscope')!
    expect(unk.label).toBe('unknownscope')
  })
  it('store group with unknown slug', async () => {
    queryOne.mockResolvedValue({ id: 's1' })
    queryMany.mockResolvedValue([{ scope: 'other_store', source_tenant_slug: null, credit: 1, debit: 0, fee: 0 }] as any)
    const r = await settlementDetail('s1')
    expect(r!.groups[0].key).toBe('store:unknown')
    expect(r!.groups[0].label).toBe('Store: unknown')
  })
})

describe('awaitingSettlement', () => {
  it('own: maps rows with estimated_at, no stores query', async () => {
    queryMany.mockResolvedValue([
      { payment_id: 'pay_1', order_id: 'o1', order_number: 'ORD-1', amount: 100, fee: 2, captured_at: '2026-01-05T10:00:00Z' },
    ] as any)
    const r = await awaitingSettlement('own')
    expect(r.count).toBe(1)
    expect(r.total).toBe(100)
    expect(r.rows[0].estimated_at).toBeDefined()
    expect(r.stores).toEqual([])
    // account passed as 'own'
    expect(queryMany.mock.calls[0][1]).toEqual(['own'])
    expect(poolQuery).not.toHaveBeenCalled()
  })
  it('platform: aggregates other stores by slug, excluding settled payments', async () => {
    queryMany.mockResolvedValueOnce([]) // first awaiting rows
    poolQuery.mockResolvedValue({ rows: [
      { payment_id: 'pay_a', slug: 'shopx', gross: '100' },
      { payment_id: 'pay_b', slug: 'shopx', gross: '50' },
      { payment_id: 'pay_c', slug: 'shopy', gross: '200' },
    ] })
    queryMany.mockResolvedValueOnce([{ payment_id: 'pay_b' }] as any) // already settled
    const r = await awaitingSettlement('platform')
    expect(r.stores).toEqual([
      { slug: 'shopy', count: 1, amount: 200 },
      { slug: 'shopx', count: 1, amount: 100 },
    ])
  })
  it('platform: no other-store rows => empty stores', async () => {
    queryMany.mockResolvedValueOnce([])
    poolQuery.mockResolvedValue({ rows: [] })
    const r = await awaitingSettlement('platform')
    expect(r.stores).toEqual([])
  })
  it('platform: control-plane query failure yields empty stores', async () => {
    queryMany.mockResolvedValueOnce([])
    poolQuery.mockRejectedValue(new Error('cp down'))
    const r = await awaitingSettlement('platform')
    expect(r.stores).toEqual([])
  })
})

describe('orderSettlements', () => {
  it('passes ids and returns rows', async () => {
    const rows = [{ payment_id: 'pay_1' }]
    queryMany.mockResolvedValueOnce(rows as any)
    expect(await orderSettlements(['o1'])).toBe(rows)
    expect(queryMany.mock.calls[0][1]).toEqual([['o1']])
  })
  it('[] on error', async () => {
    queryMany.mockRejectedValueOnce(new Error('db'))
    expect(await orderSettlements(['o1'])).toEqual([])
  })
})
