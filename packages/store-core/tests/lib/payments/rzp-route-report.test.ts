import { describe, it, expect, vi, beforeEach } from 'vitest'

const poolQuery = vi.fn()
const resolvePayoutTarget = vi.fn()

vi.mock('@/lib/tenant-registry', () => ({ controlPlanePool: () => ({ query: (...a: any[]) => poolQuery(...a) }) }))
vi.mock('@/lib/payments/route-settlement', () => ({ resolvePayoutTarget: (...a: any[]) => resolvePayoutTarget(...a) }))

import { routeOverview } from '@/lib/payments/rzp-route-report'

beforeEach(() => {
  poolQuery.mockReset()
  resolvePayoutTarget.mockReset()
})

describe('routeOverview', () => {
  it('aggregates totals/payouts/pending/rows and payout target', async () => {
    // Promise.all order: totals, payouts, pending, rows, target
    poolQuery
      .mockResolvedValueOnce({ rows: [{ gross: '1000', commission: '50', fees: '20', share: '930', refunded: '0', payments: 3 }] })
      .mockResolvedValueOnce({ rows: [
        { id: 's1', settled_at: '2026-01-01', amount: '500', fees: '5', tax: '1', utr: 'U1', status: 'processed', payments: 2 },
        { id: 's2', settled_at: '2026-01-02', amount: '430', fees: '4', tax: '1', utr: null, status: null, payments: 1 },
      ] })
      .mockResolvedValueOnce({ rows: [{ awaiting: '100', on_hold: '200', failed: 1, count: 4 }] })
      .mockResolvedValueOnce({ rows: [
        { id: 't1', payment_id: 'pay_1', order_ref: 'ORD-1', occurred_at: '2026-01-03', gross: '100', share: '93', stage: 'on_hold', failure_reason: null },
      ] })
    resolvePayoutTarget.mockResolvedValue({ linkedAccountId: 'acc_1', active: true, dailyPayout: true })

    const r = await routeOverview('t1', '2026-01-01', '2026-01-31')
    expect(r.account).toBe('route')
    expect(r.payoutTarget).toEqual({ linked: true, active: true, dailyPayout: true })
    expect(r.totals).toEqual({ gross: 1000, commission: 50, fees: 20, share: 930, refunded: 0, payments: 3 })
    expect(r.paidOut).toEqual({ amount: 930, fees: 9, count: 2 })
    expect(r.pending).toEqual({ awaitingTransfer: 100, onHold: 200, failed: 1, count: 4 })
    expect(r.payouts).toHaveLength(2)
    expect(r.payouts[0]).toMatchObject({ id: 's1', amount: 500, utr: 'U1' })
    expect(r.pendingRows[0]).toMatchObject({ id: 't1', payment_id: 'pay_1', stage: 'on_hold', gross: 100, share: 93 })
    // first query carries tenantId + period args
    expect(poolQuery.mock.calls[0][1]).toEqual(['t1', '2026-01-01', '2026-01-31'])
  })

  it('defaults when target is null and rows are empty', async () => {
    poolQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
    resolvePayoutTarget.mockResolvedValue(null)
    const r = await routeOverview('t1', 'a', 'b')
    expect(r.payoutTarget).toEqual({ linked: false, active: false, dailyPayout: false })
    expect(r.totals).toEqual({ gross: 0, commission: 0, fees: 0, share: 0, refunded: 0, payments: 0 })
    expect(r.paidOut).toEqual({ amount: 0, fees: 0, count: 0 })
    expect(r.pending).toEqual({ awaitingTransfer: 0, onHold: 0, failed: 0, count: 0 })
    expect(r.payouts).toEqual([])
    expect(r.pendingRows).toEqual([])
  })
})
