'use client'

// Finance Overview: KPIs with vs-previous deltas, cash flow trend, aging donuts and the
// needs-attention list. Shares `?from&to` with every other finance tab via useFinancePeriod.

import Link from 'next/link'
import { Badge, Banner, Kpi, KpiGrid, Section, count, money, pct, type Tone } from '@/components/admin/channels/ui'
import { MixDonutCard } from '@/components/admin/kit/charts'
import { OverviewSkeleton, useOverviewData } from '@/components/admin/overview/kit'
import { delta } from '@/lib/overview/period'
import { ap } from '@/lib/shared/admin-path'
import {
  CashflowTrendCard,
  OutflowDonutCard,
  RevenueExpenseCard,
  TopPayablesCard,
  type OutflowSegment,
} from './OverviewCharts'
import {
  AgingDonutCard,
  FinancePeriodBar,
  useFinancePeriod,
  type FinanceBucket,
  type FinanceOverviewContract,
} from './finance'

type Totals = {
  revenue: number; orders: number; refunds: number; net_sales: number; cogs: number
  gross_profit: number; gross_margin: number | null; inflow: number; supplier_payments: number
  refunds_out: number; outflow: number; net_cash: number; refunds_issued: number
  refunds_issued_count: number; gst_output: number | null; gst_itc: number | null
  gst_payable: number | null
}
type MixRow = { key: string; amount: number; count: number }
type AgingBucketRow = { key: string; label: string; amount: number; count: number }
type AttRow = Record<string, any>

interface Overview extends FinanceOverviewContract<Totals, MixRow> {
  by_method: MixRow[]
  by_channel: MixRow[]
  receivables: { total: number; count: number; aging: AgingBucketRow[] }
  payables: {
    total: number; count: number
    due_7d: number; due_7d_count: number
    overdue: number; overdue_count: number
    aging: AgingBucketRow[]
    top_suppliers: { name: string; amount: number; n: number }[]
  }
  cod: { awaiting_remittance: number; awaiting_remittance_count: number; in_transit: number; in_transit_count: number }
  attention: {
    receivables: AttRow[]; payables: AttRow[]; cod: AttRow[]
    refunds: AttRow[]; returns: AttRow[]; adjustments: AttRow[]; payouts: AttRow[]
    cod_stale_days: number
  }
  ai?: { flagship: boolean; amount: number; previous: number; calls: number }
}

const METHOD: Record<string, { label: string; color: string }> = {
  online: { label: 'Online (prepaid)', color: 'rgb(59 130 246)' },
  cod: { label: 'Cash on delivery', color: 'rgb(234 179 8)' },
  marketplace: { label: 'Marketplace', color: 'rgb(249 115 22)' },
  upi: { label: 'UPI QR', color: 'rgb(16 185 129)' },
  credit: { label: 'Credit (B2B)', color: 'rgb(168 85 247)' },
  cash: { label: 'Cash', color: 'rgb(100 116 139)' },
  card: { label: 'Card', color: 'rgb(236 72 153)' },
}
const CHANNEL: Record<string, { label: string; color: string }> = {
  website: { label: 'Website', color: 'rgb(59 130 246)' },
  amazon: { label: 'Amazon', color: 'rgb(249 115 22)' },
  store: { label: 'Store / POS', color: 'rgb(16 185 129)' },
  b2b: { label: 'B2B', color: 'rgb(168 85 247)' },
}
const AGING_ROW: Record<string, string> = {
  current: 'rgb(16 185 129)',
  d1_30: 'rgb(132 204 22)',
  d31_60: 'rgb(245 158 11)',
  d61_90: 'rgb(249 115 22)',
  d90_plus: 'rgb(239 68 68)',
}
const FALLBACK = 'rgb(148 163 184)'
const days = (n: number) => `${n} day${n === 1 ? '' : 's'}`
const orderHref = (id: string) => `/admin/orders/${id}/view`
const payableHref = (id: string) => `/admin/financial/payables/${id}`
const customer = (r: AttRow) => (r.customer_name ? ` · ${r.customer_name}` : '')
const toSegments = (mix: MixRow[], labels: Record<string, { label: string; color: string }>): OutflowSegment[] =>
  mix.filter(m => m.amount > 0).map(m => ({ label: labels[m.key]?.label ?? m.key, value: m.amount, color: labels[m.key]?.color ?? FALLBACK }))
const toAgingRows = (aging: AgingBucketRow[]) =>
  aging.filter(b => b.amount > 0).map(b => ({ label: b.label, value: b.amount, color: AGING_ROW[b.key] }))

export function OverviewTab() {
  const { range } = useFinancePeriod('30d')
  const { data, error, loading, reload } = useOverviewData<Overview>(
    `/api/admin/financial/overview?from=${range.from}&to=${range.to}`
  )

  return (
    <div className="space-y-5">
      <FinancePeriodBar onRefresh={reload} busy={loading} />
      {error && <Banner ok={false}>{error}</Banner>}
      {loading && !data ? <OverviewSkeleton /> : data && <Body d={data} />}
    </div>
  )
}

function Body({ d }: { d: Overview }) {
  const c = d.current
  const p = d.previous
  const bucket = d.bucket as FinanceBucket
  const over30 = d.receivables.aging.filter(b => b.key !== 'current' && b.key !== 'd1_30').reduce((s, b) => s + b.amount, 0)
  const outflow: OutflowSegment[] = [
    { label: 'Supplier / PO payments', value: c.supplier_payments, color: 'rgb(239 68 68)' },
    { label: 'Refunds', value: c.refunds_out, color: 'rgb(234 179 8)' },
  ].filter(s => s.value > 0)
  const trend = d.series ?? []
  const hasTrend = trend.some(s => Number(s.revenue) || Number(s.cash_out) || Number(s.cogs))

  return (
    <div className="space-y-5">
      <KpiGrid>
        <Kpi label="Net sales" value={money(c.net_sales)} delta={delta(c.net_sales, p.net_sales)} sub={`${count(c.orders)} sales, ${money(c.refunds)} reversed`} highlight />
        <Kpi label="Gross margin" value={c.gross_margin == null ? '-' : pct(c.gross_margin)} delta={c.gross_margin == null ? null : delta(c.gross_profit, p.gross_profit)} sub={c.gross_margin == null ? 'No cost prices on items sold' : `${money(c.gross_profit)} gross profit`} />
        <Kpi label="Inflow" value={money(c.inflow)} delta={delta(c.inflow, p.inflow)} sub="Paid sales" />
        <Kpi label="Outflow" value={money(c.outflow)} delta={delta(c.outflow, p.outflow)} invert sub="Supplier payments and refunds" />
        <Kpi label="Net cash" value={money(c.net_cash)} delta={delta(c.net_cash, p.net_cash)} sub={c.net_cash < 0 ? 'More went out than came in' : undefined} />
        <Kpi label="Refunds issued" value={money(c.refunds_issued)} delta={delta(c.refunds_issued, p.refunds_issued)} invert sub={`${count(c.refunds_issued_count)} refunded`} />
        {c.gst_payable != null && (
          <Kpi label="GST payable" value={money(c.gst_payable)} delta={delta(c.gst_payable, p.gst_payable ?? 0)} invert sub={`${money(c.gst_output)} output less ${money(c.gst_itc)} ITC`} />
        )}
        {d.ai && (
          <Kpi label={d.ai.flagship ? 'AI cost' : 'AI spend'} value={money(d.ai.amount)} delta={delta(d.ai.amount, d.ai.previous)} invert sub={`${count(d.ai.calls)} calls`} />
        )}
        <Kpi label="Receivables" value={money(d.receivables.total)} sub={`${count(d.receivables.count)} unpaid, ${money(over30)} over 30 days`} href={ap('/admin/financial?tab=receivables')} />
        <Kpi label="Payables due in 7 days" value={money(d.payables.due_7d)} sub={d.payables.overdue > 0 ? `${money(d.payables.overdue)} overdue` : `${money(d.payables.total)} open`} href={ap('/admin/financial?tab=payables')} />
        <Kpi label="COD awaiting remittance" value={money(d.cod.awaiting_remittance)} sub={`${count(d.cod.awaiting_remittance_count)} delivered`} href={ap('/admin/financial?tab=cod_remittance')} />
      </KpiGrid>

      <NeedsAttention d={d} />

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2">
          {hasTrend ? (
            <CashflowTrendCard data={trend} granularity={bucket} />
          ) : (
            <Section title="Cash flow">
              <p className="text-sm text-foreground-muted py-8 text-center">No sales or payments in this period.</p>
            </Section>
          )}
        </div>
        {outflow.length ? (
          <OutflowDonutCard segments={outflow} total={money(c.outflow)} />
        ) : (
          <MixDonutCard title="Outflow composition" segments={[]} total="" totalLabel="" />
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <AgingDonutCard title="Receivables aging" hint="Days since invoice" rows={toAgingRows(d.receivables.aging)} total={money(d.receivables.total)} centerLabel={`${count(d.receivables.count)} unpaid`} />
        <AgingDonutCard title="Payables aging" hint="Days past due date" rows={toAgingRows(d.payables.aging)} total={money(d.payables.total)} centerLabel={`${count(d.payables.count)} open`} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        <MixDonutCard title="Sales by payment method" segments={toSegments(d.by_method, METHOD)} total={money(c.revenue)} totalLabel="Paid sales" />
        <MixDonutCard title="Sales by channel" segments={toSegments(d.by_channel, CHANNEL)} total={money(c.revenue)} totalLabel="Paid sales" />
        <RevenueExpenseCard data={trend} granularity={bucket} />
      </div>

      {d.payables.top_suppliers.length > 0 && (
        <TopPayablesCard items={d.payables.top_suppliers.map(s => ({ name: s.name || 'Unknown supplier', value: s.amount, sub: money(s.amount) }))} />
      )}
    </div>
  )
}

type AttItem = { key: string; primary: string; secondary: string; amount?: number; href: string }
type AttGroup = { key: string; title: string; tone: Tone; href: string; action: string; items: AttItem[] }

function NeedsAttention({ d }: { d: Overview }) {
  const a = d.attention
  const red: Tone = 'red'
  const amber: Tone = 'amber'
  const groups: AttGroup[] = [
    { key: 'rec', title: 'Overdue receivables (over 30 days)', tone: red, href: '/admin/financial?tab=receivables', action: 'Receivables',
      items: a.receivables.map(r => ({ key: r.id, primary: `${r.customer_name} · ${r.order_number}`, secondary: `${days(r.days)} since invoice`, amount: r.amount, href: orderHref(r.id) })) },
    { key: 'pay', title: 'Supplier bills due this week or overdue', tone: amber, href: '/admin/financial?tab=payables', action: 'Payables',
      items: a.payables.map(r => ({ key: r.id, primary: `${r.supplier_name} · ${r.expense_number}`, secondary: r.days > 0 ? `${days(r.days)} overdue` : `Due ${r.due_date}`, amount: r.amount, href: payableHref(r.id) })) },
    { key: 'cod', title: `COD delivered but not remitted for over ${a.cod_stale_days} days`, tone: amber, href: '/admin/financial?tab=cod_remittance', action: 'COD remittance',
      items: a.cod.map(r => ({ key: r.id, primary: `${r.order_number}${customer(r)}`, secondary: `Delivered ${days(r.days)} ago`, amount: r.amount, href: orderHref(r.id) })) },
    { key: 'refund', title: 'Cancelled or returned but not refunded', tone: red, href: '/admin/orders', action: 'Orders', items: [
      ...a.refunds.map(r => ({ key: `o${r.id}`, primary: `${r.order_number}${customer(r)}`, secondary: `${r.status === 'returned' ? 'Returned' : 'Cancelled'} ${days(r.days)} ago, still paid`, amount: r.amount, href: orderHref(r.id) })),
      ...a.returns.map(r => ({ key: `r${r.id}`, primary: `${r.order_number ?? 'Return'}${customer(r)}`, secondary: `Return ${days(r.days)} ago, refund pending`, amount: r.amount || undefined, href: r.order_id ? orderHref(r.order_id) : '/admin/returns' })),
      ...a.adjustments.map(r => ({ key: `a${r.id}`, primary: r.order_number, secondary: `Adjustment refund pending for ${days(r.days)}`, amount: r.amount, href: orderHref(r.order_id) })),
    ] },
    { key: 'payout', title: 'Supplier payouts failed or stuck', tone: red, href: '/admin/financial?tab=payables', action: 'Payables',
      items: a.payouts.map(r => ({ key: r.id, primary: `${r.supplier_name} · ${r.expense_number}`, secondary: `Payout ${r.payout_status}`, amount: r.amount, href: payableHref(r.expense_id) })) },
  ].filter(g => g.items.length > 0)

  if (!groups.length) return <Banner ok>Nothing needs attention right now.</Banner>

  return (
    <Section title="Needs attention">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {groups.map(g => (
          <div key={g.key} className="rounded-lg border border-border-default p-3 min-w-0">
            <div className="flex items-center justify-between gap-2 mb-2">
              <p className="text-sm font-medium text-foreground flex items-center gap-2 min-w-0">
                <Badge tone={g.tone}>{g.items.length}</Badge>
                <span className="truncate">{g.title}</span>
              </p>
              <Link href={ap(g.href)} className="text-xs text-accent-500 hover:underline shrink-0">{g.action}</Link>
            </div>
            <ul className="divide-y divide-border-default/60">
              {g.items.map(it => (
                <li key={it.key}>
                  <Link href={ap(it.href)} className="flex items-center gap-3 py-2 hover:bg-surface-secondary rounded px-1 -mx-1">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-foreground truncate">{it.primary}</p>
                      <p className="text-xs text-foreground-muted">{it.secondary}</p>
                    </div>
                    {it.amount != null && <span className="text-sm font-medium tabular-nums text-foreground">{money(it.amount)}</span>}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Section>
  )
}
