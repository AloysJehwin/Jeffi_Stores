import { describe, it, expect, vi, beforeEach } from 'vitest'

const queryOne = vi.fn()
const queryMany = vi.fn()

vi.mock('@/lib/shared/db', () => ({
  queryOne: (...a: any[]) => queryOne(...a),
  queryMany: (...a: any[]) => queryMany(...a),
}))
vi.mock('@/lib/catalog/search', () => ({
  buildSearchClause: vi.fn((_q: string, _cols: string[], i: number) => ({ clause: `search_${i}`, params: ['%q%'], nextIdx: i + 1 })),
  buildVectorSearchClause: vi.fn((_q: string, _v: string, _a: string[], _b: string[], i: number) => ({ clause: `vsearch_${i}`, params: ['q'], nextIdx: i + 1 })),
}))
vi.mock('@/lib/catalog/gst', () => ({ round2: (n: number) => Math.round(n * 100) / 100 }))
vi.mock('@/lib/marketplace/sources', () => ({ isMarketplaceSource: (s: string) => s === 'amazon' || s === 'flipkart' }))

import { getReceivablesAging, getPayables, getPLReport, getCashflow, getCustomerCreditStatus } from '@/lib/payments/financial'
import { buildSearchClause, buildVectorSearchClause } from '@/lib/catalog/search'

beforeEach(() => vi.clearAllMocks())

describe('getReceivablesAging', () => {
  it('aggregates aging buckets and total from rows', async () => {
    queryOne.mockResolvedValueOnce({ count: '3' })
    queryMany.mockResolvedValueOnce([
      { total_amount: '100', aging_bucket: '0-30' },
      { total_amount: '50.50', aging_bucket: '31-60' },
      { total_amount: '200', aging_bucket: '60+' },
    ])
    const r = await getReceivablesAging({})
    expect(r.total).toBe(3)
    expect(r.summary).toEqual({ total: 350.5, bucket_0_30: 100, bucket_31_60: 50.5, bucket_60plus: 200 })
    expect(r.rows).toHaveLength(3)
  })

  it('builds date/phone/search filters and uses default paging', async () => {
    queryOne.mockResolvedValueOnce({ count: '0' })
    queryMany.mockResolvedValueOnce([])
    await getReceivablesAging({ from: '2026-01-01', to: '2026-02-01', customerPhone: '999', search: 'acme', page: 2, pageSize: 10 })
    expect(buildVectorSearchClause).toHaveBeenCalled()
    // params = from, to+time, phone, then the vector search param
    const params = queryMany.mock.calls[0][1]
    expect(params).toEqual(['2026-01-01', '2026-02-01 23:59:59', '999', 'q'])
    // offset = (2-1)*10 = 10 embedded in SQL
    expect(queryMany.mock.calls[0][0]).toContain('OFFSET 10')
    expect(queryMany.mock.calls[0][0]).toContain('LIMIT 10')
  })

  it('tolerates null count and empty rows', async () => {
    queryOne.mockResolvedValueOnce(null)
    queryMany.mockResolvedValueOnce(null)
    const r = await getReceivablesAging({})
    expect(r.total).toBe(0)
    expect(r.rows).toEqual([])
    expect(r.summary.total).toBe(0)
  })
})

describe('getPayables', () => {
  it('sums remaining, overdue and due-this-week from rows', async () => {
    const now = Date.now()
    const overdue = new Date(now - 86400000).toISOString()
    const thisWeek = new Date(now + 2 * 86400000).toISOString()
    queryOne.mockResolvedValueOnce({ count: '2' })
    queryMany.mockResolvedValueOnce([
      { total_amount: '1000', paid_amount: '200', due_date: overdue },
      { total_amount: '500', paid_amount: '0', due_date: thisWeek },
    ])
    const r = await getPayables({})
    expect(r.summary.total_payable).toBe(1300) // 800 + 500
    expect(r.summary.overdue).toBe(800)
    expect(r.summary.due_this_week).toBe(500)
    expect(r.total).toBe(2)
  })

  it('filters by explicit status, else excludes paid; adds search clause', async () => {
    queryOne.mockResolvedValueOnce({ count: '0' })
    queryMany.mockResolvedValueOnce([])
    await getPayables({ status: 'approved', from: '2026-01-01', to: '2026-03-01', search: 'widget' })
    expect(buildSearchClause).toHaveBeenCalled()
    const params = queryMany.mock.calls[0][1]
    expect(params).toEqual(['approved', '2026-01-01', '2026-03-01', '%q%'])
  })

  it("excludes paid rows when status is 'all' / unset", async () => {
    queryOne.mockResolvedValueOnce({ count: '0' })
    queryMany.mockResolvedValueOnce([])
    await getPayables({ status: 'all' })
    expect(queryMany.mock.calls[0][0]).toContain("e.status != 'paid'")
  })

  it('ignores rows with no due_date in the summary buckets', async () => {
    queryOne.mockResolvedValueOnce({ count: '1' })
    queryMany.mockResolvedValueOnce([{ total_amount: '300', paid_amount: '0', due_date: null }])
    const r = await getPayables({})
    expect(r.summary.total_payable).toBe(300)
    expect(r.summary.overdue).toBe(0)
    expect(r.summary.due_this_week).toBe(0)
  })
})

describe('getPLReport', () => {
  it('merges revenue/refund/opex by month and computes derived fields', async () => {
    // revenueRows, refundRows, opexRows (Promise.all order)
    queryMany
      .mockResolvedValueOnce([
        { month: '2026-01', source: 'online', revenue: '1000', tax_collected: '100', order_count: 2, cogs: '400' },
        { month: '2026-01', source: 'business', revenue: '500', tax_collected: '50', order_count: 1, cogs: '100' },
        { month: '2026-01', source: 'cash_sale', revenue: '200', tax_collected: '0', order_count: 1, cogs: '0' },
        { month: '2026-01', source: 'amazon', revenue: '300', tax_collected: '30', order_count: 1, cogs: '0' },
        { month: '2026-01', source: 'offline', revenue: '100', tax_collected: '0', order_count: 1, cogs: '0' },
      ])
      .mockResolvedValueOnce([{ month: '2026-01', refunds: '200' }])
      .mockResolvedValueOnce([{ month: '2026-01', operating_expenses: '300' }])
    const { monthly, totals } = await getPLReport('2026-01-01', '2026-01-31')
    expect(monthly).toHaveLength(1)
    const m = monthly[0]
    expect(m.revenue).toBe(2100) // 1000+500+200+300+100
    expect(m.revenue_online).toBe(1000)
    expect(m.revenue_business).toBe(500)
    expect(m.revenue_cash_sale).toBe(200)
    expect(m.revenue_marketplace).toBe(300)
    expect(m.revenue_offline).toBe(100)
    expect(m.cogs).toBe(500)
    expect(m.refunds).toBe(200)
    expect(m.net_revenue).toBe(1900) // 2100-200
    expect(m.gross_profit).toBe(1400) // 1900-500
    expect(m.gross_margin_pct).toBeCloseTo(73.68, 2)
    expect(m.operating_expenses).toBe(300)
    expect(m.operating_profit).toBe(1100) // 1400-300
    expect(m.order_count).toBe(6)
    expect(totals.revenue).toBe(2100)
    expect(totals.operating_profit).toBe(1100)
    expect(totals.gross_margin_pct).toBeCloseTo(73.68, 2)
  })

  it('zeroes gross_margin_pct when net revenue is not positive', async () => {
    queryMany
      .mockResolvedValueOnce([{ month: '2026-02', source: 'online', revenue: '100', tax_collected: '0', order_count: 1, cogs: '0' }])
      .mockResolvedValueOnce([{ month: '2026-02', refunds: '100' }]) // net = 0
      .mockResolvedValueOnce([])
    const { monthly, totals } = await getPLReport('2026-02-01', '2026-02-28')
    expect(monthly[0].net_revenue).toBe(0)
    expect(monthly[0].gross_margin_pct).toBe(0)
    expect(totals.gross_margin_pct).toBe(0)
  })

  it('handles all-empty result sets', async () => {
    queryMany.mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockResolvedValueOnce(null)
    const { monthly, totals } = await getPLReport('2026-01-01', '2026-01-31')
    expect(monthly).toEqual([])
    expect(totals.revenue).toBe(0)
  })
})

describe('getCashflow', () => {
  it('splits cash-in by source, sums cash-out, carries a running balance', async () => {
    queryMany
      .mockResolvedValueOnce([
        { month: '2026-01', source: 'online', amount: '1000' },
        { month: '2026-01', source: 'business', amount: '500' },
        { month: '2026-01', source: 'cash_sale', amount: '200' },
        { month: '2026-01', source: 'offline', amount: '100' },
        { month: '2026-02', source: 'online', amount: '400' },
      ])
      .mockResolvedValueOnce([{ month: '2026-01', po_payments: '300' }])
      .mockResolvedValueOnce([{ month: '2026-01', refunds_out: '100' }])
    const { monthly } = await getCashflow('2026-01-01', '2026-02-28')
    expect(monthly).toHaveLength(2)
    const jan = monthly[0]
    expect(jan.cash_in).toBe(1800)
    expect(jan.cash_in_online).toBe(1000)
    expect(jan.cash_in_business).toBe(500)
    expect(jan.cash_in_cash_sale).toBe(200)
    expect(jan.cash_in_offline).toBe(100)
    expect(jan.cash_out).toBe(400) // 300 + 100
    expect(jan.net).toBe(1400)
    expect(jan.running_balance).toBe(1400)
    const feb = monthly[1]
    expect(feb.cash_in).toBe(400)
    expect(feb.net).toBe(400)
    expect(feb.running_balance).toBe(1800) // 1400 + 400
  })

  it('handles empty result sets', async () => {
    queryMany.mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockResolvedValueOnce(null)
    const { monthly } = await getCashflow('2026-01-01', '2026-01-31')
    expect(monthly).toEqual([])
  })
})

describe('getCustomerCreditStatus', () => {
  it('computes available credit and over-limit flag', async () => {
    queryOne.mockResolvedValueOnce({ credit_limit: '10000' }).mockResolvedValueOnce({ outstanding: '3000' })
    const r = await getCustomerCreditStatus('u1')
    expect(r).toEqual({ credit_limit: 10000, outstanding: 3000, available: 7000, is_over_limit: false })
  })

  it('flags over-limit when outstanding >= a positive limit, clamps available to 0', async () => {
    queryOne.mockResolvedValueOnce({ credit_limit: '5000' }).mockResolvedValueOnce({ outstanding: '6000' })
    const r = await getCustomerCreditStatus('u1')
    expect(r.available).toBe(0)
    expect(r.is_over_limit).toBe(true)
  })

  it('is never over-limit when the limit is zero/absent', async () => {
    queryOne.mockResolvedValueOnce(null).mockResolvedValueOnce(null)
    const r = await getCustomerCreditStatus('u1')
    expect(r).toEqual({ credit_limit: 0, outstanding: 0, available: 0, is_over_limit: false })
  })
})
