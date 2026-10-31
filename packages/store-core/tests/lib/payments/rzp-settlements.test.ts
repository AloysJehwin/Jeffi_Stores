import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/shared/db', () => ({ query: vi.fn(), queryMany: vi.fn(), queryOne: vi.fn() }))
vi.mock('@/lib/payments/razorpay', () => ({ getRazorpayInstanceFor: vi.fn() }))
vi.mock('@/lib/tenant-registry', () => ({ controlPlanePool: vi.fn() }))
vi.mock('@/lib/payments/rzp-account', () => ({ razorpayAccountFor: vi.fn() }))
vi.mock('@/lib/channels/sync-run', () => ({
  withChannelLock: vi.fn(async (_c: string, _l: string, _k: string, fn: any) => {
    const errors: any[] = []
    const counts: Record<string, number> = {}
    await fn({
      errors,
      step: async (name: string, run: () => Promise<number | void>) => {
        try {
          const n = await run()
          if (typeof n === 'number') counts[name] = (counts[name] ?? 0) + n
        } catch (e: any) {
          errors.push({ step: name, message: e.message })
        }
      },
    })
    return { id: '1', status: errors.length ? 'partial' : 'success', counts, errors }
  }),
}))

import { syncRazorpaySettlements, RazorpaySettlementsUnavailable, lastSettlementSync } from '@/lib/payments/rzp-settlements'
import { query, queryMany, queryOne } from '@/lib/shared/db'
import { getRazorpayInstanceFor } from '@/lib/payments/razorpay'
import { controlPlanePool } from '@/lib/tenant-registry'
import { razorpayAccountFor } from '@/lib/payments/rzp-account'

const reports = vi.fn()
const all = vi.fn()
const fetchOne = vi.fn()
const cpQuery = vi.fn()
const sqlOf = (re: RegExp) => vi.mocked(query).mock.calls.filter(c => re.test(String(c[0])))

const line = (settlement_id: string, entity_id: string, extra: Record<string, unknown> = {}) => ({
  settlement_id,
  entity_id,
  type: 'payment',
  amount: 10000,
  credit: 9764,
  debit: 0,
  fee: 200,
  tax: 36,
  settled: true,
  created_at: 1_760_000_000,
  settled_at: 1_760_200_000,
  ...extra,
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getRazorpayInstanceFor).mockResolvedValue({
    instance: { settlements: { reports, all, fetch: fetchOne } },
    creds: { key_id: 'rzp_live_x' },
  } as any)
  vi.mocked(controlPlanePool).mockReturnValue({ query: cpQuery } as any)
  vi.mocked(query).mockResolvedValue({ rows: [], rowCount: 1 } as any)
  vi.mocked(queryOne).mockResolvedValue(null)
  reports.mockResolvedValue({ items: [] })
  all.mockResolvedValue({ items: [] })
})

describe('syncRazorpaySettlements', () => {
  it('refuses a Route store: it is paid out by transfer, not settlements', async () => {
    vi.mocked(razorpayAccountFor).mockResolvedValue({ kind: 'route', tenantId: 't1', slug: 's', ownFlag: false })
    await expect(syncRazorpaySettlements()).rejects.toBeInstanceOf(RazorpaySettlementsUnavailable)
  })

  it('backfills months on the first run, matches other stores and saves the run state', async () => {
    vi.mocked(razorpayAccountFor).mockResolvedValue({ kind: 'platform', tenantId: null, slug: null, ownFlag: false })
    reports.mockResolvedValueOnce({
      items: [
        line('setl_A', 'pay_1'),
        line('setl_A', 'trf_1', { type: 'transfer', payment_id: 'pay_9' }),
        line('setl_B', 'pay_2', { notes: { tenant_slug: 'shop' } }),
        { settlement_id: 'setl_A', entity_id: 'pay_x', settled: false },
      ],
    })
    all.mockResolvedValueOnce({ items: [{ id: 'setl_A', amount: 1000000, fees: 2000, tax: 360, utr: 'UTR1', status: 'processed', created_at: 1_760_200_000 }] })
    fetchOne.mockResolvedValue({ id: 'setl_B', amount: 500, status: 'processed', processed_at: 1_760_300_000 })
    vi.mocked(queryMany).mockImplementation(async (sql: string) => {
      if (/NOT EXISTS/.test(sql)) return [{ settlement_id: 'setl_B' }] as any
      if (/scope = 'unmatched' AND COALESCE/.test(sql))
        return [
          { entity_id: 'trf_1', settlement_id: 'setl_A', payment_id: 'pay_9', type: 'transfer' },
          { entity_id: 'pay_2', settlement_id: 'setl_B', payment_id: 'pay_2', type: 'payment' },
        ] as any
      return []
    })
    cpQuery.mockResolvedValue({ rows: [{ payment_id: null, transfer_id: 'trf_1', tenant_id: 'tid-1', order_ref: 'ORD-9', slug: 'shop' }] })

    const r = await syncRazorpaySettlements()

    expect(r.errors).toEqual([])
    expect(reports.mock.calls.length).toBeGreaterThanOrEqual(4)
    const upserted = JSON.parse(sqlOf(/INSERT INTO razorpay_settlement_items/)[0][1]![0] as string)
    expect(upserted.map((l: any) => l.entity_id)).toEqual(['pay_1', 'trf_1', 'pay_2'])
    expect(upserted[0]).toMatchObject({ amount: 100, credit: 97.64, fee: 2, tax: 0.36, payment_id: 'pay_1' })
    expect(sqlOf(/INSERT INTO razorpay_settlements/).map(c => c[1]![0])).toEqual(['setl_A', 'setl_B'])
    const other = sqlOf(/SET scope = 'other_store', source_tenant_id = x.tenant_id/)
    expect(JSON.parse(other[0][1]![0] as string)).toEqual([
      { settlement_id: 'setl_A', entity_id: 'trf_1', tenant_id: 'tid-1', slug: 'shop', order_ref: 'ORD-9' },
    ])
    expect(r.counts.matched).toBeGreaterThan(0)
    const state = sqlOf(/INSERT INTO site_settings/)
    expect(JSON.parse(state[0][1]![1] as string)).toMatchObject({ backfilled: true })
  })

  it('syncs one day for an own-key store without touching the run state or other stores', async () => {
    vi.mocked(razorpayAccountFor).mockResolvedValue({ kind: 'own', tenantId: 't1', slug: 's', ownFlag: true })
    vi.mocked(queryOne).mockResolvedValue({ value: JSON.stringify({ backfilled: true, last_run_at: new Date().toISOString() }) } as any)
    reports.mockResolvedValueOnce({ items: [line('setl_C', 'pay_3')] })
    vi.mocked(queryMany).mockResolvedValue([])

    await syncRazorpaySettlements({ day: new Date('2026-10-20T06:00:00Z') })

    expect(reports).toHaveBeenCalledTimes(1)
    expect(reports.mock.calls[0][0]).toMatchObject({ year: 2026, month: 10, day: 20 })
    expect(cpQuery).not.toHaveBeenCalled()
    expect(sqlOf(/INSERT INTO site_settings/)).toHaveLength(0)
    expect(sqlOf(/UPDATE payments p SET fee/)).toHaveLength(1)
  })

  it('reads an unreadable run state as a first run', async () => {
    vi.mocked(queryOne).mockResolvedValue({ value: '{not json' } as any)
    await expect(lastSettlementSync()).resolves.toEqual({})
  })
})
