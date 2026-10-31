import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/shared/db', () => ({ queryOne: vi.fn(), queryMany: vi.fn() }))

import { queryMany, queryOne } from '@/lib/shared/db'
import { byPeriod, fillKeyed, periodArgs, resolveOverviewTab } from '@/lib/overviews/sales-documents'
import { AGING_KEYS, INVOICE_SQL, invoiceAttention, invoiceStats, loadInvoiceOverview } from '@/lib/overviews/invoices'
import { QUOTATION_SQL, QUOTE_VALID_DAYS, loadQuotationOverview, quotationAttention, quoteStats } from '@/lib/overviews/quotations'
import { CASH_SALE_SQL, cashSaleAttention, cashSaleStats, paymentModeLabel } from '@/lib/overviews/cash-sale'
import { SUBSCRIPTION_SQL, intervalName, loadSubscriptionOverview, subscriptionAttention, subscriptionStats } from '@/lib/overviews/subscriptions'

const sp = (q: string) => new URLSearchParams(q)
const P = { from: '2026-10-01', to: '2026-10-10' }

describe('resolveOverviewTab', () => {
  const keys = ['payment', 'search', 'view']
  it('opens the overview by default and keeps the period params on it', () => {
    expect(resolveOverviewTab(sp(''), keys)).toBe('overview')
    expect(resolveOverviewTab(sp('from=2026-10-01&to=2026-10-10'), keys)).toBe('overview')
  })
  it('opens the list for old list links', () => {
    expect(resolveOverviewTab(sp('payment=unpaid'), keys)).toBe('list')
    expect(resolveOverviewTab(sp('view=create'), keys)).toBe('list')
  })
  it('lets ?tab win', () => {
    expect(resolveOverviewTab(sp('tab=overview&payment=unpaid'), keys)).toBe('overview')
    expect(resolveOverviewTab(sp('tab=list'), keys)).toBe('list')
    expect(resolveOverviewTab(sp('tab=bogus'), keys)).toBe('overview')
  })
})

describe('shared helpers', () => {
  it('builds the previous period and bucket', () => {
    expect(periodArgs(P)).toEqual({ previous: { from: '2026-09-21', to: '2026-09-30' }, bucket: 'day', args: ['2026-09-21', '2026-10-01', '2026-10-10'] })
  })
  it('splits rows by period and fills keyed buckets', () => {
    const r = byPeriod([{ period: 'cur', n: '2' }], x => Number(x?.n ?? 0))
    expect(r).toEqual({ current: 2, previous: 0 })
    expect(fillKeyed(AGING_KEYS, [{ bucket: 'd61_90', n: '1', amount: '50' }]).map(b => [b.key, b.count, b.amount])).toEqual([
      ['d0_30', 0, 0],
      ['d31_60', 0, 0],
      ['d61_90', 1, 50],
      ['d90_plus', 0, 0],
    ])
  })
  it('every period query uses the three bound params', () => {
    for (const sql of [INVOICE_SQL.kpis, QUOTATION_SQL.kpis, CASH_SALE_SQL.kpis, SUBSCRIPTION_SQL.kpis, INVOICE_SQL.series('week')]) {
      expect(sql).toContain('$1::date')
      expect(sql).toContain('$3::date')
    }
  })
})

describe('invoices', () => {
  it('derives average invoice and e-invoice coverage', () => {
    const s = invoiceStats({ invoices: '4', value: '1000', b2b: '2', b2b_irn: '1' })
    expect(s.avgInvoice).toBe(250)
    expect(s.eInvoiceCoverage).toBe(0.5)
    expect(invoiceStats(undefined)).toMatchObject({ invoices: 0, avgInvoice: null, eInvoiceCoverage: null })
  })
  it('flags overdue, drafts and missing IRNs', () => {
    const aging = [
      { key: 'd0_30', count: 3, amount: 300 },
      { key: 'd31_60', count: 1, amount: 100 },
      { key: 'd61_90', count: 0, amount: 0 },
      { key: 'd90_plus', count: 2, amount: 900 },
    ]
    const a = invoiceAttention({ aging, drafts: 1, b2bNoIrn: 0, voided: 0 })
    expect(a.map(x => x.key)).toEqual(['overdue', 'drafts'])
    expect(a[0]).toMatchObject({ severity: 'critical', title: '3 unpaid invoices older than 30 days' })
    expect(invoiceAttention({ aging: aging.map(b => ({ ...b, count: 0, amount: 0 })), drafts: 0, b2bNoIrn: 0, voided: 0 })).toEqual([])
  })
  it('loads with the period args and links each invoice kind', async () => {
    vi.mocked(queryOne).mockResolvedValue({ drafts: '0', b2b_no_irn: '2' } as any)
    vi.mocked(queryMany).mockImplementation(async (sql: string) => {
      if (sql === INVOICE_SQL.oldestUnpaid)
        return [
          { kind: 'order', id: 'o1', invoice_number: 'JS/1', customer: 'A', amount: '10', at: 'x', days: '40' },
          { kind: 'cash_sale', id: 'c1', invoice_number: 'JS/2', customer: 'B', amount: '5', at: 'x', days: '2' },
        ] as any
      return [] as any
    })
    const d = await loadInvoiceOverview(P)
    expect(vi.mocked(queryMany).mock.calls[0][1]).toEqual(['2026-09-21', '2026-10-01', '2026-10-10'])
    expect(d.oldestUnpaid.map(r => r.href)).toEqual(['/admin/invoices/o1/view', '/admin/cash-sale/c1/view'])
    expect(d.attention.map(a => a.key)).toEqual(['irn'])
  })
})

describe('quotations', () => {
  beforeEach(() => vi.clearAllMocks())
  it('derives conversion', () => {
    const s = quoteStats({ sent: '4', sent_value: '400', accepted: '1', accepted_value: '200' })
    expect(s).toMatchObject({ conversion: 0.25, valueConversion: 0.5, avgQuote: 100 })
    expect(quoteStats(undefined).conversion).toBeNull()
  })
  it('flags expiring, stale drafts and lapsed quotes', () => {
    const a = quotationAttention({ expiring: 2, expiringValue: 1000, lapsed: 1, lapsedValue: 50, staleDrafts: 0 })
    expect(a.map(x => x.key)).toEqual(['expiring', 'lapsed'])
    expect(a[0].sub).toContain(`day ${QUOTE_VALID_DAYS}`)
  })
  it('loads the pipeline snapshot', async () => {
    vi.mocked(queryMany).mockResolvedValue([])
    vi.mocked(queryOne).mockResolvedValue({ open: '3', open_value: '900', expiring: '1', expiring_value: '100', lapsed: '0', lapsed_value: '0', stale_drafts: '2' } as any)
    const d = await loadQuotationOverview(P)
    expect(d.pipeline).toMatchObject({ open: 3, openValue: 900, staleDrafts: 2 })
    expect(d.won.current).toEqual({ count: 0, value: 0, avgDaysToAccept: null })
    expect(d.attention.map(a => a.key)).toEqual(['expiring', 'drafts'])
  })
})

describe('cash sale', () => {
  it('derives average bill, per-day takings and cancel rate', () => {
    const s = cashSaleStats({ bills: '9', sales: '900', cancelled: '1', trading_days: '3' })
    expect(s).toMatchObject({ avgBill: 100, perDay: 300, cancelRate: 0.1 })
  })
  it('warns when cancellations reach 10% of bills', () => {
    const cur = cashSaleStats({ bills: '9', sales: '900', cancelled: '1', cancelled_value: '50' })
    expect(cashSaleAttention({ current: cur, unlinkedLines: 0, unlinkedAmount: 0 })[0]).toMatchObject({ key: 'cancelled', severity: 'warning' })
    const low = cashSaleStats({ bills: '99', cancelled: '1' })
    expect(cashSaleAttention({ current: low, unlinkedLines: 2, unlinkedAmount: 10 }).map(a => [a.key, a.severity])).toEqual([
      ['cancelled', 'info'],
      ['unlinked', 'info'],
    ])
  })
  it('labels payment modes', () => {
    expect(paymentModeLabel('upi_qr')).toBe('UPI (QR)')
    expect(paymentModeLabel('store_credit')).toBe('Store credit')
  })
})

describe('subscriptions', () => {
  beforeEach(() => vi.clearAllMocks())
  it('derives churn and net new', () => {
    const s = subscriptionStats({ new_subs: '3', cancelled: '1', base: '10', billed_paise: '12345' })
    expect(s).toMatchObject({ churnRate: 0.1, netNew: 2, billed: 123.45 })
    expect(subscriptionStats(undefined).churnRate).toBeNull()
  })
  it('puts halted subscriptions first', () => {
    const a = subscriptionAttention({ halted: 1, retrying: 2, due: 0, dueAmount: 0, ending: 0, abandoned: 0 })
    expect(a.map(x => [x.key, x.severity])).toEqual([
      ['halted', 'critical'],
      ['retrying', 'warning'],
    ])
  })
  it('names plans', () => {
    expect(intervalName('quarterly')).toBe('Every 3 months')
    expect(intervalName(null)).toBe('Other')
  })
  it('uses the list headline for active and MRR', async () => {
    vi.mocked(queryMany).mockResolvedValue([])
    vi.mocked(queryOne).mockResolvedValue({ retrying: '0', due: '2', due_paise: '50000' } as any)
    const d = await loadSubscriptionOverview(P, { active: 5, paused: 1, halted: 0, cancelled: 2, mrr: 1000 })
    expect(d.snapshot).toMatchObject({ active: 5, mrr: 1000, arr: 12000, due: 2, dueAmount: 500 })
    expect(d.attention.map(a => a.key)).toEqual(['due'])
  })
})
