import 'server-only'
import { parsePeriod, type PeriodPreset } from '@/lib/overview/period'
import { getPLReport, type PLMonth } from '@/lib/payments/financial'
import { getAiCosts } from '@/lib/finance/ai-costs'
import { getCashflowOverview } from '@/lib/finance/cashflow'
import { codOverview } from '@/lib/finance/cod-remittance'
import { getDisputes } from '@/lib/finance/disputes'
import { getMessagingOverview } from '@/lib/finance/messaging-spend'
import { getFinanceOverview } from '@/lib/finance/overview'
import { isValidRange, presetRange } from '@/lib/finance/overview-period'
import { getPayablesOverview } from '@/lib/finance/payables'
import { getReceivablesOverview } from '@/lib/finance/receivables'
import { getTransactionsOverview } from '@/lib/finance/transactions'
import { hasScope } from '@/lib/auth/scopes'
import { AI_CAPABILITY_LABEL, aiFeatureLabel } from '@/lib/ai/feature-labels'
import { loadMarketplaceSettlementsOverview } from '@/lib/marketplace/settlements'
import { razorpayAccountFor } from '@/lib/payments/rzp-account'
import { routeOverview } from '@/lib/payments/rzp-route-report'
import { awaitingSettlement, settlementOverview } from '@/lib/payments/rzp-settlement-report'
import { isFlagshipTenant } from '@/lib/payments/wallet'
import { resolveTenant } from '@/lib/tenancy/tenant-context'
import { defineExport, formatRange, type ExportDefinition, type ExportRow, type ExportRunContext, type ExportSection } from '../define'
import { narrowed, type DateRange, type ExportColumn, type ExportFilter } from '../types'

// Finance exports, one per tab of the Finance page. Each calls the same lib function as the tab's
// API route with the same period, so the exported totals are the page's totals. The include/exclude
// choices are applied to the rows (or passed to the function) before totals are computed.

const SCOPE = 'financial:read'

function rangeFromQuery(q: URLSearchParams): DateRange | undefined {
  const from = q.get('from') ?? undefined
  const to = q.get('to') ?? undefined
  return from || to ? { from, to } : undefined
}

/** The tab's period: the dialog's range, else the tab's default preset (what the page itself falls back to). */
const periodOf = (ctx: ExportRunContext, preset: PeriodPreset = '30d') => parsePeriod(ctx.range.from ?? null, ctx.range.to ?? null, undefined, preset)
const periodLine = (preset: PeriodPreset = '30d') => (ctx: ExportRunContext) => formatRange(periodOf(ctx, preset))

const money = (key: string, label: string, extra: Partial<ExportColumn> = {}): ExportColumn => ({ key, label, type: 'money', total: 'sum', ...extra })
const int = (key: string, label: string, extra: Partial<ExportColumn> = {}): ExportColumn => ({ key, label, type: 'int', total: 'sum', ...extra })

const multi = (key: string, label: string, options: Record<string, string>, help?: string): ExportFilter => ({
  key,
  label,
  kind: 'multi',
  options: Object.entries(options).map(([value, l]) => ({ value, label: l })),
  help,
})

const fmtMonth = (m: string) => new Date(`${m.slice(0, 7)}-01T00:00:00Z`).toLocaleDateString('en-IN', { month: 'short', year: 'numeric', timeZone: 'UTC' })
const round2 = (v: number) => Math.round(v * 100) / 100
const sum = <T,>(rows: T[], f: (r: T) => number) => rows.reduce((a, r) => a + f(r), 0)
const keep = <T,>(rows: T[], picked: string[] | null, get: (r: T) => string) => (picked ? rows.filter(r => picked.includes(get(r))) : rows)
const NO_ROWS = (key: string, title: string): ExportSection => ({ key, title, rows: [], totals: null })

async function isFlagship(): Promise<boolean> {
  return isFlagshipTenant((await resolveTenant())?.tenantId)
}

// ── Overview ────────────────────────────────────────────────────────────────

const OV_CHANNELS: Record<string, string> = { website: 'Website', amazon: 'Amazon', myntra: 'Myntra', ajio: 'AJIO', flipkart: 'Flipkart', store: 'Store / POS', b2b: 'B2B' }
const OV_METHODS: Record<string, string> = { online: 'Online (prepaid)', cod: 'Cash on delivery', marketplace: 'Marketplace', upi: 'UPI QR', credit: 'Credit (B2B)', cash: 'Cash', card: 'Card' }
const OV_CHANNEL_FILTER = multi('channels', 'Sales channels', OV_CHANNELS, 'Untick a channel to leave it out of the sales-by-channel table and its total.')
const OV_METHOD_FILTER = multi('methods', 'Payment methods', OV_METHODS, 'Untick a method to leave it out of the sales-by-method table and its total.')

const overviewRange = (ctx: ExportRunContext) => {
  const asked = { from: ctx.range.from ?? '', to: ctx.range.to ?? '' }
  return asked.from && isValidRange(asked) ? asked : presetRange('30d')
}

export const OVERVIEW_EXPORT = defineExport({
  key: 'financial.overview',
  title: 'Finance overview',
  noun: 'Rows',
  scope: SCOPE,
  columns: [{ key: 'label', label: 'Payment method', id: true, width: 1.5 }, money('amount', 'Paid sales'), int('count', 'Sales')],
  filters: [OV_CHANNEL_FILTER, OV_METHOD_FILTER],
  scopes: ['filtered'],
  dateRange: true,
  rangeFromQuery,
  period: ctx => formatRange(overviewRange(ctx)),
  sections: async ctx => {
    const range = overviewRange(ctx)
    const d = await getFinanceOverview(range, { withGst: hasScope(ctx.admin.role, ctx.admin.scopes, 'gst:read'), flagship: await isFlagship() })
    const channels = narrowed(OV_CHANNEL_FILTER, ctx.filters)
    const methods = narrowed(OV_METHOD_FILTER, ctx.filters)
    const row = (labels: Record<string, string>) => (r: { key: string; amount: number; count: number }): ExportRow => ({ label: labels[r.key] ?? r.key, amount: r.amount, count: r.count })
    const c = d.current
    const out: ExportSection[] = [
      { key: 'methods', title: 'Sales by payment method', rows: keep(d.by_method, methods, r => r.key).map(row(OV_METHODS)) },
      {
        key: 'channels',
        title: 'Sales by channel',
        columns: [{ key: 'label', label: 'Channel', id: true, width: 1.5 }, money('amount', 'Paid sales'), int('count', 'Sales')],
        rows: keep(d.by_channel, channels, r => r.key).map(row(OV_CHANNELS)),
      },
    ]
    // The key figures are the page's, for the whole period; leave them out once a table is narrowed.
    if (!channels && !methods) {
      out[1].summary = [
        { label: 'Revenue', value: c.revenue, type: 'money' },
        { label: 'Net sales', value: c.net_sales, type: 'money' },
        { label: 'Gross profit', value: c.gross_profit, type: 'money' },
        { label: 'Inflow', value: c.inflow, type: 'money' },
        { label: 'Outflow', value: c.outflow, type: 'money' },
        { label: 'Net cash', value: c.net_cash, type: 'money' },
        { label: 'Refunds issued', value: c.refunds_issued, type: 'money' },
        ...(c.gst_payable != null ? [{ label: 'GST payable', value: c.gst_payable, type: 'money' as const }] : []),
      ]
    }
    return out
  },
})

// ── P&L ─────────────────────────────────────────────────────────────────────

const PL_SOURCES: Record<string, string> = { online: 'Website', business: 'B2B', cash_sale: 'Cash sale', marketplace: 'Marketplaces', offline: 'Offline / Store' }
const PL_FIELD = {
  online: 'revenue_online',
  business: 'revenue_business',
  cash_sale: 'revenue_cash_sale',
  marketplace: 'revenue_marketplace',
  offline: 'revenue_offline',
} as const
const PL_SOURCE_FILTER = multi(
  'sources',
  'Revenue sources',
  PL_SOURCES,
  'Untick a source to drop its revenue; net revenue, gross profit, margin and operating profit are recomputed. Refunds, COGS, GST and order counts are not split by source and stay as on the page.'
)

/** Month with only the ticked sources' revenue; the derived figures follow from it. */
function pickSources(m: PLMonth, on: string[] | null): PLMonth {
  if (!on) return m
  const r = { ...m }
  let revenue = 0
  for (const [k, f] of Object.entries(PL_FIELD)) {
    if (on.includes(k)) revenue += m[f]
    else r[f] = 0
  }
  r.revenue = round2(revenue)
  r.net_revenue = round2(r.revenue - m.refunds)
  r.gross_profit = round2(r.net_revenue - m.cogs)
  r.gross_margin_pct = r.net_revenue > 0 ? round2((r.gross_profit / r.net_revenue) * 100) : 0
  r.operating_profit = round2(r.gross_profit - m.operating_expenses)
  return r
}

export const PL_EXPORT = defineExport({
  key: 'financial.pl',
  title: 'Profit & Loss',
  noun: 'Months',
  scope: SCOPE,
  columns: [
    { key: 'month', label: 'Month', id: true },
    money('revenue', 'Revenue'),
    money('revenue_online', 'Website revenue', { optional: true }),
    money('revenue_business', 'B2B revenue', { optional: true }),
    money('revenue_cash_sale', 'Cash sale revenue', { optional: true }),
    money('revenue_marketplace', 'Marketplace revenue', { optional: true }),
    money('revenue_offline', 'Offline / Store revenue', { optional: true }),
    money('refunds', 'Refunds'),
    money('net_revenue', 'Net revenue'),
    money('cogs', 'COGS'),
    money('gross_profit', 'Gross profit'),
    { key: 'gross_margin_pct', label: 'Margin', type: 'percent' },
    money('operating_expenses', 'Operating expenses'),
    money('operating_profit', 'Operating profit'),
    money('tax_collected', 'GST collected', { optional: true }),
    int('order_count', 'Orders'),
  ],
  filters: [PL_SOURCE_FILTER],
  scopes: ['filtered'],
  dateRange: true,
  rangeFromQuery,
  period: periodLine('fy'),
  sections: async ctx => {
    const p = periodOf(ctx, 'fy')
    const report = await getPLReport(p.from, p.to)
    const on = narrowed(PL_SOURCE_FILTER, ctx.filters)
    const months = (report?.monthly ?? []).map(m => pickSources(m, on))
    if (!months.length) return [NO_ROWS('months', 'Monthly P&L')]
    const t = Object.fromEntries(
      (Object.keys(months[0]) as (keyof PLMonth)[]).filter(k => k !== 'month' && k !== 'gross_margin_pct').map(k => [k, round2(sum(months, m => m[k] as number))])
    ) as Record<string, number>
    const margin = t.net_revenue > 0 ? round2((t.gross_profit / t.net_revenue) * 100) : 0
    return [
      {
        key: 'months',
        title: 'Monthly P&L',
        rows: months.map(m => ({ ...m, month: fmtMonth(m.month) })),
        totals: { month: 'Total', ...t, gross_margin_pct: margin },
        summary: [
          { label: 'Revenue', value: t.revenue, type: 'money' },
          { label: 'Net revenue', value: t.net_revenue, type: 'money' },
          { label: 'COGS', value: t.cogs, type: 'money' },
          { label: 'Gross profit', value: t.gross_profit, type: 'money' },
          { label: 'Gross margin', value: margin, type: 'percent' },
          { label: 'Operating expenses', value: t.operating_expenses, type: 'money' },
          { label: 'Operating profit', value: t.operating_profit, type: 'money' },
          { label: 'GST collected', value: t.tax_collected, type: 'money' },
          { label: 'Orders', value: t.order_count, type: 'int' },
        ],
      },
    ]
  },
})

// ── Cashflow ────────────────────────────────────────────────────────────────

const CF_SOURCES: Record<string, string> = { online: 'Online', business: 'Business', cash_sale: 'Cash sale', offline: 'Offline' }
const CF_SOURCE_FILTER = multi('sources', 'Cash-in sources', CF_SOURCES, 'Untick a source to drop its cash in; cash in, net and the running balance are recomputed.')

export const CASHFLOW_EXPORT = defineExport({
  key: 'financial.cashflow',
  title: 'Cashflow',
  noun: 'Months',
  scope: SCOPE,
  columns: [
    { key: 'month', label: 'Month', id: true },
    money('cash_in', 'Cash in'),
    money('cash_in_online', 'Online', { optional: true }),
    money('cash_in_business', 'Business', { optional: true }),
    money('cash_in_cash_sale', 'Cash sale', { optional: true }),
    money('cash_in_offline', 'Offline', { optional: true }),
    money('po_payments', 'Supplier payments'),
    money('refunds_out', 'Refunds'),
    money('cash_out', 'Cash out'),
    money('net', 'Net'),
    { key: 'running_balance', label: 'Balance', type: 'money' },
  ],
  filters: [CF_SOURCE_FILTER],
  scopes: ['filtered'],
  dateRange: true,
  rangeFromQuery,
  period: periodLine('fy'),
  sections: async ctx => {
    const d = await getCashflowOverview(periodOf(ctx, 'fy'))
    const on = narrowed(CF_SOURCE_FILTER, ctx.filters)
    let running = 0
    const months = d.monthly.map(m => {
      const inn: Record<string, number> = { online: m.cash_in_online, business: m.cash_in_business, cash_sale: m.cash_in_cash_sale, offline: m.cash_in_offline }
      const r = on
        ? { ...m, ...Object.fromEntries(Object.keys(inn).map(k => [`cash_in_${k}`, on.includes(k) ? inn[k] : 0])), cash_in: round2(sum(Object.keys(inn).filter(k => on.includes(k)), k => inn[k])) }
        : m
      const net = on ? round2(r.cash_in - m.cash_out) : m.net
      running = on ? round2(running + net) : m.running_balance
      return { ...r, net, running_balance: running }
    })
    const cashIn = keep(d.by_dim, on, r => r.key)
    const out: ExportSection[] = [
      {
        key: 'months',
        title: 'Monthly cashflow',
        rows: months.map(m => ({ ...m, month: fmtMonth(m.month) })),
        totals: months.length
          ? {
              month: 'Total',
              ...Object.fromEntries(
                ['cash_in', 'cash_in_online', 'cash_in_business', 'cash_in_cash_sale', 'cash_in_offline', 'po_payments', 'refunds_out', 'cash_out', 'net'].map(k => [k, round2(sum(months, m => (m as unknown as Record<string, number>)[k]))])
              ),
              running_balance: months[months.length - 1].running_balance,
            }
          : null,
      },
      { key: 'in', title: 'Cash in by source', columns: [{ key: 'label', label: 'Source', id: true }, money('amount', 'Amount')], rows: cashIn },
      { key: 'out', title: 'Cash out breakdown', columns: [{ key: 'label', label: 'Destination', id: true }, money('amount', 'Amount')], rows: d.by_dim2 },
    ]
    const cin = on ? sum(cashIn, r => r.amount) : d.current.cash_in
    out[2].summary = [
      { label: 'Cash in', value: round2(cin), type: 'money' },
      { label: 'Cash out', value: d.current.cash_out, type: 'money' },
      { label: 'Net', value: round2(cin - d.current.cash_out), type: 'money' },
      { label: 'Opening balance', value: d.current.opening_balance, type: 'money' },
      { label: 'Closing balance', value: round2(d.current.opening_balance + cin - d.current.cash_out), type: 'money' },
    ]
    return out
  },
})

// ── Receivables ─────────────────────────────────────────────────────────────

const AGING: Record<string, string> = { d0_30: '0-30 days', d31_60: '31-60 days', d60_plus: '60+ days' }
const RCV_AGING_FILTER = multi('aging', 'Aging', AGING, 'Untick a bucket to leave its invoices out of the overdue list and the aging table.')
const RCV_STATUS_FILTER = multi('status', 'Payment status', { unpaid: 'Unpaid', partial: 'Partly paid' }, 'Applies to the overdue invoices list; the summaries cover every unpaid and partly paid invoice.')

export const RECEIVABLES_EXPORT = defineExport({
  key: 'financial.receivables',
  title: 'Receivables',
  noun: 'Invoices',
  scope: SCOPE,
  columns: [
    { key: 'invoice_number', label: 'Invoice', id: true, width: 1.3 },
    { key: 'order_number', label: 'Order', id: true },
    { key: 'customer_name', label: 'Customer', width: 1.5 },
    { key: 'invoice_date', label: 'Invoice date', type: 'date' },
    int('days_outstanding', 'Days outstanding', { total: undefined }),
    { key: 'aging', label: 'Aging' },
    { key: 'payment_status', label: 'Payment status' },
    money('total_amount', 'Amount'),
  ],
  filters: [RCV_AGING_FILTER, RCV_STATUS_FILTER],
  scopes: ['filtered'],
  dateRange: true,
  rangeFromQuery,
  period: periodLine(),
  sections: async ctx => {
    const d = await getReceivablesOverview(periodOf(ctx))
    const aging = narrowed(RCV_AGING_FILTER, ctx.filters)
    const status = narrowed(RCV_STATUS_FILTER, ctx.filters)
    const overdue = keep(keep(d.overdue, aging, r => r.aging_bucket), status, r => r.payment_status)
    const buckets = keep(d.by_aging, aging, r => r.key)
    const c = d.current
    const out: ExportSection[] = [
      {
        key: 'overdue',
        title: 'Overdue invoices',
        rows: overdue.map(r => ({ ...r, invoice_number: r.invoice_number ?? r.order_number, aging: AGING[r.aging_bucket] ?? r.aging_bucket })),
      },
      {
        key: 'debtors',
        title: 'Top debtors',
        columns: [
          { key: 'customer_name', label: 'Customer', id: true, width: 1.5 },
          { key: 'customer_phone', label: 'Phone', optional: true },
          int('invoice_count', 'Invoices'),
          int('oldest_days', 'Oldest (days)', { total: undefined }),
          money('outstanding', 'Outstanding'),
        ],
        rows: d.top_debtors.map(r => ({ ...r, customer_name: r.customer_name || 'Guest' })),
      },
      {
        key: 'aging',
        title: 'Outstanding by aging',
        columns: [{ key: 'label', label: 'Bucket', id: true }, int('count', 'Invoices'), money('amount', 'Outstanding')],
        rows: buckets.map(r => ({ label: AGING[r.key], count: r.count, amount: r.amount })),
      },
    ]
    out[2].summary = [
      { label: 'Outstanding', value: aging ? sum(buckets, r => r.amount) : c.outstanding, type: 'money' },
      { label: 'Invoices', value: aging ? sum(buckets, r => r.count) : c.invoice_count, type: 'int' },
      { label: 'Overdue (60+ days)', value: buckets.find(b => b.key === 'd60_plus')?.amount ?? 0, type: 'money' },
      ...(aging ? [] : [{ label: 'Average days outstanding', value: c.avg_days, type: 'int' as const }]),
    ]
    return out
  },
})

// ── Transactions ────────────────────────────────────────────────────────────

const TXN_METHODS: Record<string, string> = {
  bank_transfer: 'Bank transfer',
  upi: 'UPI',
  cash: 'Cash',
  cheque: 'Cheque',
  card: 'Card',
  online: 'Online',
  cod: 'Cash on delivery',
  wallet: 'Wallet',
  unknown: 'Unknown',
}
const TXN_KIND: Record<string, string> = { customer: 'Customer', supplier: 'Supplier', cash: 'Cash sale', order: 'Guest order' }
const TXN_DIRECTION_FILTER = multi('directions', 'Direction', { inflow: 'Inflow (payments received)', outflow: 'Outflow (payments made)' })
const TXN_METHOD_FILTER = multi('methods', 'Payment methods', TXN_METHODS, 'Untick a method to leave its transactions out of every figure.')
const methodLabel = (m: string) => TXN_METHODS[m] ?? m.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())

export const TRANSACTIONS_EXPORT = defineExport({
  key: 'financial.transactions',
  title: 'Transactions',
  noun: 'Rows',
  scope: SCOPE,
  columns: [{ key: 'method', label: 'Method', id: true }, money('inflow', 'Inflow'), money('outflow', 'Outflow'), money('net', 'Net'), int('count', 'Transactions')],
  filters: [TXN_DIRECTION_FILTER, TXN_METHOD_FILTER],
  scopes: ['filtered'],
  dateRange: true,
  rangeFromQuery,
  period: periodLine(),
  sections: async ctx => {
    const p = periodOf(ctx)
    const d = await getTransactionsOverview(p.from, p.to, {
      directions: narrowed(TXN_DIRECTION_FILTER, ctx.filters) ?? undefined,
      methods: narrowed(TXN_METHOD_FILTER, ctx.filters) ?? undefined,
    })
    const c = d.current
    return [
      { key: 'methods', title: 'By method', rows: d.by_method.map(r => ({ ...r, method: methodLabel(r.method), net: r.inflow - r.outflow })) },
      {
        key: 'parties',
        title: 'Top counterparties',
        columns: [{ key: 'party', label: 'Counterparty', id: true, width: 1.5 }, { key: 'kind', label: 'Kind' }, money('inflow', 'Inflow'), money('outflow', 'Outflow'), int('count', 'Transactions')],
        rows: d.by_party.map(r => ({ ...r, kind: TXN_KIND[r.party_type] ?? r.party_type })),
        summary: [
          { label: 'Inflow', value: c.inflow, type: 'money' },
          { label: 'Outflow', value: c.outflow, type: 'money' },
          { label: 'Net', value: c.net, type: 'money' },
          { label: 'Transactions', value: c.count, type: 'int' },
        ],
      },
    ]
  },
})

// ── Payables ────────────────────────────────────────────────────────────────

const PAY_STATUS_FILTER = multi('status', 'Bill status', { unpaid: 'Unpaid', partial: 'Partly paid' }, 'Applies to the open bills list; the supplier and aging tables cover every open bill.')
const PAY_OVERDUE_FILTER: ExportFilter = { key: 'overdue', label: 'Overdue bills only', kind: 'toggle', help: 'Open bills list only.' }

export const PAYABLES_EXPORT = defineExport({
  key: 'financial.payables',
  title: 'Payables',
  noun: 'Bills',
  scope: SCOPE,
  columns: [
    { key: 'expense_number', label: 'Bill', id: true },
    { key: 'supplier_name', label: 'Supplier', id: true, width: 1.5 },
    { key: 'due_date', label: 'Due date', type: 'date' },
    { key: 'status', label: 'Status' },
    money('total_amount', 'Bill amount'),
    money('paid_amount', 'Paid'),
    money('balance', 'Balance'),
    int('days_overdue', 'Days overdue', { total: undefined }),
    { key: 'supplier_bank_name', label: 'Bank', optional: true },
    { key: 'supplier_account_number', label: 'Account no', optional: true },
    { key: 'supplier_ifsc', label: 'IFSC', optional: true },
    { key: 'supplier_upi_id', label: 'UPI', optional: true },
  ],
  filters: [PAY_STATUS_FILTER, PAY_OVERDUE_FILTER],
  scopes: ['filtered'],
  dateRange: true,
  rangeFromQuery,
  period: periodLine(),
  sections: async ctx => {
    const d = await getPayablesOverview(periodOf(ctx))
    const status = narrowed(PAY_STATUS_FILTER, ctx.filters)
    const overdueOnly = ctx.filters.overdue === true
    const bills = keep(d.top, status, r => r.status).filter(r => !overdueOnly || (r.days_overdue ?? 0) > 0)
    const c = d.current
    return [
      { key: 'bills', title: 'Open bills', rows: bills.map(r => ({ ...r, balance: Math.max(r.total_amount - r.paid_amount, 0) })) },
      {
        key: 'suppliers',
        title: 'Top suppliers by outstanding',
        columns: [{ key: 'supplier_name', label: 'Supplier', id: true, width: 1.5 }, int('bills_open', 'Open bills'), money('outstanding', 'Outstanding'), money('overdue', 'Overdue')],
        rows: d.by_dim2,
      },
      {
        key: 'aging',
        title: 'Aging',
        columns: [{ key: 'label', label: 'Bucket', id: true }, money('value', 'Outstanding')],
        rows: d.by_dim,
        summary: [
          { label: 'Outstanding', value: c.outstanding, type: 'money' },
          { label: 'Due this week', value: c.due_this_week, type: 'money' },
          { label: 'Overdue', value: c.overdue, type: 'money' },
          { label: 'Paid in period', value: c.paid, type: 'money' },
          { label: 'Open bills', value: c.bills_open, type: 'int' },
        ],
      },
    ]
  },
})

// ── COD remittance ──────────────────────────────────────────────────────────

const COD_STATUS: Record<string, string> = { cod_pending: 'Pending delivery', cod_collected: 'Collected, to remit', paid: 'Remitted' }
const COD_STATUS_FILTER = multi('status', 'Status', COD_STATUS, 'Leave a status out of the orders list and the by-status table.')

export const COD_REMITTANCE_EXPORT = defineExport({
  key: 'financial.cod-remittance',
  title: 'COD remittance',
  noun: 'Orders',
  scope: SCOPE,
  columns: [
    { key: 'order_number', label: 'Order', id: true },
    { key: 'customer_name', label: 'Customer', width: 1.5 },
    { key: 'status', label: 'Status' },
    money('total_amount', 'Amount'),
    { key: 'delivered_at', label: 'Delivered', type: 'datetime' },
    { key: 'cod_remitted_at', label: 'Remitted', type: 'datetime' },
  ],
  filters: [COD_STATUS_FILTER],
  scopes: ['filtered'],
  dateRange: true,
  rangeFromQuery,
  period: periodLine(),
  sections: async ctx => {
    const picked = narrowed(COD_STATUS_FILTER, ctx.filters)
    // One status is what the page asks for; several are cut from the unfiltered list.
    const d = await codOverview(periodOf(ctx), picked?.length === 1 ? (picked[0] as 'cod_pending' | 'cod_collected' | 'paid') : 'all')
    const c = d.current
    return [
      {
        key: 'orders',
        title: 'Orders',
        rows: keep(d.top, picked, r => r.payment_status).map(r => ({ ...r, status: COD_STATUS[r.payment_status] ?? r.payment_status })),
      },
      {
        key: 'status',
        title: 'By status',
        columns: [{ key: 'label', label: 'Status', id: true }, int('count', 'Orders'), money('amount', 'Amount')],
        rows: keep(d.by_dim, picked, r => r.key).map(r => ({ label: COD_STATUS[r.key], count: r.count, amount: r.amount })),
        summary: [
          { label: 'Collected', value: c.collected_amount, type: 'money' },
          { label: 'Pending delivery', value: c.pending_amount, type: 'money' },
          { label: 'Remitted', value: c.remitted_amount, type: 'money' },
        ],
      },
    ]
  },
})

// ── Disputes ────────────────────────────────────────────────────────────────

const DISPUTE_STATUS: Record<string, string> = { open: 'Needs response', under_review: 'Under review', won: 'Won', lost: 'Lost', closed: 'Closed' }
const DISPUTE_STATUS_FILTER = multi('status', 'Status', DISPUTE_STATUS)

export const DISPUTES_EXPORT = defineExport({
  key: 'financial.disputes',
  title: 'Chargebacks',
  noun: 'Disputes',
  scope: SCOPE,
  columns: [
    { key: 'order_number', label: 'Order', id: true },
    { key: 'razorpay_payment_id', label: 'Payment id', id: true, optional: true },
    { key: 'razorpay_dispute_id', label: 'Dispute id', optional: true },
    money('amount', 'Amount'),
    money('amount_deducted', 'Deducted'),
    { key: 'reason', label: 'Reason', width: 1.5 },
    { key: 'status', label: 'Status' },
    { key: 'respond_by', label: 'Respond by', type: 'datetime' },
    { key: 'created_at', label: 'Opened', type: 'datetime' },
    { key: 'closed_at', label: 'Closed', type: 'datetime', optional: true },
  ],
  filters: [DISPUTE_STATUS_FILTER],
  scopes: ['filtered'],
  sections: async ctx => {
    const picked = narrowed(DISPUTE_STATUS_FILTER, ctx.filters)
    const set = picked ? [...picked].sort().join() : ''
    // The page's own Open / Closed tabs are the same two queries; anything else is cut from all of them.
    const view = set === 'open,under_review' ? 'open' : set === 'closed,lost,won' ? 'closed' : 'all'
    const d = await getDisputes(view)
    const rows = keep(d.rows, picked, r => r.status)
    return [
      {
        key: 'disputes',
        title: 'Chargebacks',
        rows: rows.map(r => ({ ...r, order_number: r.order_number ? `#${r.order_number}` : '', reason: r.reason_description || r.reason_code || '', status: DISPUTE_STATUS[r.status] ?? r.status })),
        summary: [
          { label: 'Open', value: d.totals.open_amount, type: 'money' },
          { label: 'Open disputes', value: d.totals.open_count, type: 'int' },
          { label: 'Lost', value: d.totals.lost_amount, type: 'money' },
          { label: 'Won', value: d.totals.won_count, type: 'int' },
        ],
      },
    ]
  },
})

// ── Razorpay settlements ────────────────────────────────────────────────────

const RZP_TABLES: Record<string, string> = { settlements: 'Settlements', awaiting: 'Awaiting settlement' }
const RZP_TABLE_FILTER = multi('tables', 'Tables', RZP_TABLES)
const RZP_MISMATCH_FILTER: ExportFilter = { key: 'mismatch', label: 'Only settlements that do not match their lines', kind: 'toggle' }

export const RAZORPAY_SETTLEMENTS_EXPORT = defineExport({
  key: 'financial.razorpay-settlements',
  title: 'Razorpay settlements',
  noun: 'Settlements',
  scope: SCOPE,
  columns: [
    { key: 'id', label: 'Settlement', id: true },
    { key: 'settled_at', label: 'Settled', type: 'datetime', id: true },
    { key: 'utr', label: 'UTR' },
    { key: 'status', label: 'Status' },
    money('amount', 'To bank'),
    money('fees', 'Fees'),
    money('tax', 'GST on fees'),
    int('item_count', 'Items'),
    money('lines_net', 'Lines net', { optional: true }),
    { key: 'mismatch', label: 'Mismatch', type: 'bool', optional: true },
  ],
  filters: [RZP_TABLE_FILTER, RZP_MISMATCH_FILTER],
  scopes: ['filtered'],
  dateRange: true,
  rangeFromQuery,
  period: periodLine(),
  sections: async ctx => {
    const account = await razorpayAccountFor()
    // Route stores are paid out instead (the page answers 404).
    if (account.kind === 'route') return [NO_ROWS('settlements', 'Settlements')]
    const p = periodOf(ctx)
    const tables = narrowed(RZP_TABLE_FILTER, ctx.filters)
    const want = (k: string) => !tables || tables.includes(k)
    const out: ExportSection[] = []
    if (want('settlements')) {
      const d = await settlementOverview(account.kind, p.from, p.to)
      const rows = ctx.filters.mismatch === true ? d.settlements.filter(r => r.mismatch) : d.settlements
      out.push({
        key: 'settlements',
        title: 'Settlements',
        rows,
        summary: [
          { label: 'Settled to bank', value: sum(rows, r => r.amount), type: 'money' },
          { label: 'Razorpay fees', value: sum(rows, r => r.fees), type: 'money' },
          { label: 'GST on fees', value: sum(rows, r => r.tax), type: 'money' },
          { label: 'Settlements', value: rows.length, type: 'int' },
        ],
      })
    }
    if (want('awaiting')) {
      const a = await awaitingSettlement(account.kind)
      out.push({
        key: 'awaiting',
        title: 'Awaiting settlement (last 30 days)',
        columns: [
          { key: 'payment_id', label: 'Payment', id: true },
          { key: 'order_number', label: 'Order', id: true },
          money('amount', 'Amount'),
          money('fee', 'Fee', { optional: true }),
          { key: 'captured_at', label: 'Paid', type: 'datetime' },
          { key: 'estimated_at', label: 'Expected by', type: 'date' },
        ],
        rows: a.rows,
      })
    }
    return out.length ? out : [NO_ROWS('settlements', 'Settlements')]
  },
})

// ── Route payouts ───────────────────────────────────────────────────────────

const STAGES: Record<string, string> = { awaiting: 'Awaiting transfer', on_hold: 'Held until payout', failed: 'Transfer failed' }
const ROUTE_STAGE_FILTER = multi('stage', 'Not paid out: status', STAGES, 'Leave a stage out of the not-paid-out list.')

export const ROUTE_PAYOUTS_EXPORT = defineExport({
  key: 'financial.route-payouts',
  title: 'Route payouts',
  noun: 'Payouts',
  scope: SCOPE,
  columns: [
    { key: 'id', label: 'Payout', id: true },
    { key: 'settled_at', label: 'Paid out', type: 'datetime', id: true },
    { key: 'utr', label: 'UTR' },
    money('amount', 'To bank'),
    money('fees', 'Fees + GST'),
    int('payments', 'Payments'),
  ],
  filters: [ROUTE_STAGE_FILTER],
  scopes: ['filtered'],
  dateRange: true,
  rangeFromQuery,
  period: periodLine(),
  sections: async ctx => {
    const account = await razorpayAccountFor()
    // Stores with settlements of their own use the Razorpay export (the page answers 404).
    if (account.kind !== 'route' || !account.tenantId) return [NO_ROWS('payouts', 'Payouts to your bank')]
    const p = periodOf(ctx)
    const d = await routeOverview(account.tenantId, p.from, p.to)
    const pending = keep(d.pendingRows, narrowed(ROUTE_STAGE_FILTER, ctx.filters), r => r.stage)
    return [
      { key: 'payouts', title: 'Payouts to your bank', rows: d.payouts },
      {
        key: 'pending',
        title: 'Not paid out yet',
        columns: [
          { key: 'order_ref', label: 'Order', id: true },
          { key: 'occurred_at', label: 'Paid', type: 'datetime', id: true },
          money('gross', 'Payment'),
          money('share', 'Your share'),
          { key: 'stage', label: 'Status' },
          { key: 'failure_reason', label: 'Failure reason', optional: true, width: 1.5 },
        ],
        rows: pending.map(r => ({ ...r, stage: STAGES[r.stage] ?? r.stage })),
        summary: [
          { label: 'Online sales', value: d.totals.gross, type: 'money' },
          { label: 'Platform commission', value: d.totals.commission, type: 'money' },
          { label: 'Gateway fees', value: d.totals.fees, type: 'money' },
          { label: 'Your share', value: d.totals.share, type: 'money' },
          { label: 'Paid to your bank', value: d.paidOut.amount, type: 'money' },
        ],
      },
    ]
  },
})

// ── Marketplace settlements ─────────────────────────────────────────────────

const MKT: Record<string, string> = { myntra: 'Myntra', ajio: 'AJIO', flipkart: 'Flipkart', amazon: 'Amazon' }
const MKT_FILTER = multi('marketplaces', 'Marketplaces', MKT, 'Untick a marketplace to leave its payouts and receivable out; totals are recomputed.')

export const MARKETPLACE_SETTLEMENTS_EXPORT = defineExport({
  key: 'financial.marketplace-settlements',
  title: 'Marketplace settlements',
  noun: 'Rows',
  scope: SCOPE,
  columns: [
    { key: 'label', label: 'Marketplace', id: true },
    int('count', 'Payouts'),
    money('gross', 'Sales'),
    money('charges', 'Commission + fees'),
    money('tax', 'TCS / TDS'),
    money('refunds', 'Refunds'),
    money('net', 'Settled'),
    money('receivable', 'Receivable'),
    int('overdue_orders', 'Overdue orders'),
    { key: 'lastSettledOn', label: 'Last settled', type: 'date' },
  ],
  filters: [MKT_FILTER],
  scopes: ['filtered'],
  dateRange: true,
  rangeFromQuery,
  period: periodLine(),
  sections: async ctx => {
    const p = periodOf(ctx)
    const d = await loadMarketplaceSettlementsOverview({ from: p.from, to: p.to })
    const on = narrowed(MKT_FILTER, ctx.filters)
    const channels = keep(d.channels, on, r => r.channel)
    const recent = keep(d.recent, on, r => r.channel)
    return [
      {
        key: 'channels',
        title: 'By marketplace',
        rows: channels.map(r => ({ ...r, receivable: r.receivable?.unsettledValue ?? null, overdue_orders: r.receivable?.overdueOrders ?? null })),
        summary: [
          { label: 'Settled to bank', value: sum(channels, r => r.net), type: 'money' },
          { label: 'Commission + fees', value: sum(channels, r => r.charges), type: 'money' },
          { label: 'Receivable', value: sum(channels, r => r.receivable?.unsettledValue ?? 0), type: 'money' },
          { label: 'Overdue orders', value: sum(channels, r => r.receivable?.overdueOrders ?? 0), type: 'int' },
        ],
      },
      {
        key: 'recent',
        title: 'Payouts',
        columns: [
          { key: 'settled_on', label: 'Settled', type: 'date', id: true },
          { key: 'label', label: 'Marketplace', id: true },
          { key: 'ref', label: 'Reference' },
          money('gross', 'Sales'),
          money('charges', 'Charges'),
          money('net', 'Settled'),
        ],
        rows: recent.map(r => ({ ...r, label: MKT[r.channel] ?? r.channel })),
      },
    ]
  },
})

// ── AI costs ────────────────────────────────────────────────────────────────

const PROVIDERS: Record<string, string> = { anthropic: 'Anthropic (Claude)', ollama: 'Razer (Ollama)', razer: 'Razer (SD)', google: 'Google', replicate: 'Replicate', openai: 'OpenAI' }
const AI_PROVIDER_FILTER = multi('providers', 'Providers', PROVIDERS, 'Narrowing providers leaves only the By provider table; the others cannot be split by provider.')

export const AI_COSTS_EXPORT = defineExport({
  key: 'financial.ai-costs',
  title: 'AI costs',
  noun: 'Rows',
  scope: SCOPE,
  columns: [{ key: 'label', label: 'Feature', id: true, width: 1.5 }, int('calls', 'Calls'), money('amount', 'Amount'), money('cost_inr', 'Platform cost', { optional: true }), int('failed', 'Failed')],
  filters: [AI_PROVIDER_FILTER],
  scopes: ['filtered'],
  dateRange: true,
  rangeFromQuery,
  period: periodLine(),
  sections: async ctx => {
    const flagship = await isFlagship()
    const d = await getAiCosts(periodOf(ctx), { flagship })
    const picked = narrowed(AI_PROVIDER_FILTER, ctx.filters)
    // The flagship pays providers (cost); a store is charged to its wallet (price).
    const amt = (r: { cost_inr: number; price_inr: number }) => (flagship ? r.cost_inr : r.price_inr)
    const label = flagship ? 'Platform cost' : 'Charged to wallet'
    const cols = (first: string): ExportColumn[] => [{ key: 'label', label: first, id: true, width: 1.5 }, int('calls', 'Calls'), money('amount', label), ...(flagship ? [] : [money('cost_inr', 'Platform cost')]), int('failed', 'Failed')]
    const rowsOf = (rows: typeof d.by_feature, labels: (k: string) => string) => rows.map(r => ({ ...r, label: labels(r.key), amount: amt(r) }))
    const providers = keep(d.by_provider, picked, r => r.key)
    const out: ExportSection[] = []
    if (!picked) out.push({ key: 'features', title: 'By feature', rows: rowsOf(d.by_feature, aiFeatureLabel) })
    out.push({ key: 'providers', title: 'By provider', columns: cols('Provider'), rows: rowsOf(providers, k => PROVIDERS[k] ?? k) })
    if (!picked) {
      out.push({ key: 'capabilities', title: 'By capability', columns: cols('Capability'), rows: rowsOf(d.by_capability, k => AI_CAPABILITY_LABEL[k] ?? k) })
      if (d.top_refs.length)
        out.push({
          key: 'refs',
          title: 'Top references',
          columns: [{ key: 'ref', label: 'Reference', id: true, width: 1.5 }, { key: 'feature', label: 'Feature' }, int('calls', 'Calls'), money('amount', label)],
          rows: d.top_refs.map(r => ({ ...r, feature: aiFeatureLabel(r.feature), amount: amt(r) })),
        })
    }
    const c = d.current
    out[out.length - 1].summary = picked
      ? [
          { label, value: sum(providers, amt), type: 'money' },
          { label: 'Calls', value: sum(providers, r => r.calls), type: 'int' },
          { label: 'Failed', value: sum(providers, r => r.failed), type: 'int' },
        ]
      : [
          { label, value: flagship ? c.cost_inr : c.price_inr, type: 'money' },
          { label: 'Calls', value: c.calls, type: 'int' },
          ...(flagship ? [] : [{ label: 'Platform cost', value: c.cost_inr, type: 'money' as const }]),
          { label: 'Failed', value: c.failed, type: 'int' },
          ...(flagship ? [] : [{ label: 'Unpaid', value: c.unpaid, type: 'int' as const }]),
        ]
    return out
  },
})

// ── Messaging spend ─────────────────────────────────────────────────────────

const MSG_CHANNELS: Record<string, string> = { sms: 'SMS', whatsapp: 'WhatsApp', email: 'Email' }
const MSG_DIRECTIONS: Record<string, string> = { txn: 'Transactional', promo: 'Promotional', marketing: 'Marketing' }
const MSG_CHANNEL_FILTER = multi('channels', 'Channels', MSG_CHANNELS, 'Narrowing channels leaves out the By direction table, which cannot be split by channel.')

export const MESSAGING_SPEND_EXPORT = defineExport({
  key: 'financial.messaging-spend',
  title: 'Messaging spend',
  noun: 'Rows',
  scope: SCOPE,
  columns: [{ key: 'label', label: 'Channel', id: true }, int('sends', 'Sends'), int('failed', 'Failed'), money('spent', 'Spent')],
  filters: [MSG_CHANNEL_FILTER],
  scopes: ['filtered'],
  dateRange: true,
  rangeFromQuery,
  period: periodLine(),
  sections: async ctx => {
    const d = await getMessagingOverview(periodOf(ctx))
    const picked = narrowed(MSG_CHANNEL_FILTER, ctx.filters)
    const ch = <T extends { channel: string }>(rows: T[]) => keep(rows, picked, r => r.channel)
    const channels = keep(d.by_channel, picked, r => r.key)
    const named = <T extends { channel: string }>(rows: T[]) => ch(rows).map(r => ({ ...r, channel: MSG_CHANNELS[r.channel] ?? r.channel }))
    const out: ExportSection[] = [{ key: 'channels', title: 'By channel', rows: channels.map(r => ({ ...r, label: MSG_CHANNELS[r.key] })) }]
    if (!picked)
      out.push({
        key: 'directions',
        title: 'By direction',
        columns: [{ key: 'label', label: 'Direction', id: true }, int('sends', 'Sends'), money('spent', 'Spent')],
        rows: d.by_direction.map(r => ({ ...r, label: MSG_DIRECTIONS[r.key] })),
      })
    out.push(
      {
        key: 'templates',
        title: 'By template',
        columns: [{ key: 'slug', label: 'Template', id: true, width: 1.5 }, { key: 'channel', label: 'Channel' }, int('sends', 'Sends'), money('spent', 'Spent')],
        rows: named(d.by_template),
      },
      {
        key: 'campaigns',
        title: 'By campaign',
        columns: [{ key: 'name', label: 'Campaign', id: true, width: 1.5 }, { key: 'channel', label: 'Channel' }, int('sends', 'Sends'), money('spent', 'Spent')],
        rows: named(d.by_campaign),
      },
      {
        key: 'recipients',
        title: 'Top recipients',
        columns: [{ key: 'to', label: 'Recipient', id: true, width: 1.5 }, { key: 'channel', label: 'Channel' }, int('sends', 'Sends'), money('spent', 'Spent')],
        rows: named(d.top_recipients),
      }
    )
    const c = d.current
    const spent = picked ? sum(channels, r => r.spent) : c.total
    out[out.length - 1].summary = [
      { label: 'Spent', value: spent, type: 'money' },
      { label: 'Sends', value: picked ? sum(channels, r => r.sends) : c.sends, type: 'int' },
      { label: 'Failed', value: picked ? sum(channels, r => r.failed) : c.failed, type: 'int' },
    ]
    return out
  },
})

export const FINANCIAL_EXPORTS: ExportDefinition[] = [
  OVERVIEW_EXPORT,
  PL_EXPORT,
  CASHFLOW_EXPORT,
  RECEIVABLES_EXPORT,
  TRANSACTIONS_EXPORT,
  PAYABLES_EXPORT,
  COD_REMITTANCE_EXPORT,
  DISPUTES_EXPORT,
  RAZORPAY_SETTLEMENTS_EXPORT,
  ROUTE_PAYOUTS_EXPORT,
  MARKETPLACE_SETTLEMENTS_EXPORT,
  AI_COSTS_EXPORT,
  MESSAGING_SPEND_EXPORT,
]
