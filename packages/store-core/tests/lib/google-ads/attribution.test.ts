import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/lib/shared/db', () => ({ queryOne: vi.fn(), queryMany: vi.fn() }))
vi.mock('@/lib/tenancy/tenant-context', () => ({ getCurrentTenantId: vi.fn(() => 't1') }))

import {
  computeReturnMetrics,
  googleAdsOrderStats,
  hasAttributionColumns,
  _resetAttributionCache,
} from '@/lib/google-ads/attribution'
import { queryOne } from '@/lib/shared/db'

beforeEach(() => {
  vi.clearAllMocks()
  _resetAttributionCache()
})

describe('true ROAS / POAS math', () => {
  it('nets refunds out of revenue and divides by spend', () => {
    const m = computeReturnMetrics(1000, { revenue: 5900, refunds: 900, tax: 900, cogs: 2500 })
    expect(m.netRevenue).toBe(5000)
    expect(m.trueRoas).toBe(5)
    // 5900 - 900 tax - 900 refunds - 2500 cost of goods
    expect(m.grossProfit).toBe(1600)
    expect(m.poas).toBe(1.6)
    expect(m.profitAfterAds).toBe(600)
  })

  it('returns null ratios without spend and never a negative revenue', () => {
    const m = computeReturnMetrics(0, { revenue: 100, refunds: 300, tax: 0, cogs: 50 })
    expect(m.trueRoas).toBeNull()
    expect(m.poas).toBeNull()
    expect(m.netRevenue).toBe(0)
    expect(m.grossProfit).toBe(-250)
  })

  it('shows a loss as POAS below 1', () => {
    expect(computeReturnMetrics(2000, { revenue: 3000, refunds: 0, tax: 0, cogs: 1500 }).poas).toBe(0.75)
  })
})

describe('googleAdsOrderStats', () => {
  it('reports unavailable when orders has no click-id columns', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce({ n: 0 })
    expect(await googleAdsOrderStats({ from: '2026-10-01', to: '2026-10-16' })).toEqual({
      available: false,
      orders: 0,
      revenue: 0,
      refunds: 0,
      tax: 0,
      cogs: 0,
    })
    expect(queryOne).toHaveBeenCalledTimes(1)
  })

  it('sums paid Google-click orders in the account zone', async () => {
    vi.mocked(queryOne)
      .mockResolvedValueOnce({ n: 3 })
      .mockResolvedValueOnce({ orders: 4, revenue: '11800.00', tax: '1800.00', cogs: '6000.000', refunds: '500.00' })
    const s = await googleAdsOrderStats({ from: '2026-10-01', to: '2026-10-16' }, 'Asia/Kolkata')
    expect(s).toEqual({ available: true, orders: 4, revenue: 11800, refunds: 500, tax: 1800, cogs: 6000 })
    const [sql, params] = vi.mocked(queryOne).mock.calls[1] as any[]
    expect(sql).toMatch(/o\.gclid IS NOT NULL OR o\.gbraid IS NOT NULL OR o\.wbraid IS NOT NULL/)
    expect(sql).toMatch(/payment_status = 'paid'/)
    expect(sql).toMatch(/NOT IN \('cancelled', 'returned', 'draft', 'cancel_rejected'\)/)
    expect(sql).toMatch(/rr\.status = 'completed'/)
    expect(params).toEqual(['2026-10-01', '2026-10-16', 'Asia/Kolkata'])
  })

  it('remembers the columns once present', async () => {
    vi.mocked(queryOne).mockResolvedValue({ n: 3 })
    expect(await hasAttributionColumns()).toBe(true)
    expect(await hasAttributionColumns()).toBe(true)
    expect(queryOne).toHaveBeenCalledTimes(1)
  })

  it('re-checks a missing column next time', async () => {
    vi.mocked(queryOne).mockResolvedValue({ n: 2 })
    await hasAttributionColumns()
    await hasAttributionColumns()
    expect(queryOne).toHaveBeenCalledTimes(2)
  })
})
