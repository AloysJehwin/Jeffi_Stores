'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { ap } from '@/lib/shared/admin-path'
import AdminStatsSkeleton from '@/components/admin/AdminStatsSkeleton'
import DatePicker from '@/components/ui/DatePicker'
import { rsCompact } from '@/components/admin/dashboard/Primitives'
import { Badge, Banner, Kpi, KpiGrid, Section, api, count, money, pct, type Tone } from '@/components/admin/channels/ui'
import {
  CashflowTrendCard,
  MixDonutCard,
  OutflowDonutCard,
  RevenueExpenseCard,
  TopPayablesCard,
  type OutflowSegment,
  type TrendPoint,
} from './OverviewCharts'
import {
  PRESETS,
  changeOf,
  isValidRange,
  matchPreset,
  presetRange,
  type AgingKey,
  type Bucket,
  type Range,
} from './overview-period'

type Totals = {
  revenue: number
  orders: number
  refunds: number
  net_sales: number
  cogs: number
  gross_profit: number
  gross_margin: number | null
  inflow: number
  supplier_payments: number
  refunds_out: number
  outflow: number
  net_cash: number
  refunds_issued: number
  refunds_issued_count: number
  gst_output: number | null
  gst_itc: number | null
  gst_payable: number | null
}
type Aging = { key: AgingKey; label: string; amount: number; count: number }[]
type Mix = { key: string; amount: number; count: number }[]
type Row = Record<string, any>
type Overview = {
  range: Range
  previous_range: Range
  bucket: Bucket
  current: Totals
  previous: Totals
  series: TrendPoint[]
  by_method: Mix
  by_channel: Mix
  receivables: { total: number; count: number; aging: Aging }
  payables: {
    total: number
    count: number
    due_7d: number
    due_7d_count: number
    overdue: number
    overdue_count: number
    aging: Aging
    top_suppliers: { name: string; amount: number; n: number }[]
  }
  cod: { awaiting_remittance: number; awaiting_remittance_count: number; in_transit: number; in_transit_count: number }
  attention: {
    receivables: Row[]
    payables: Row[]
    cod: Row[]
    refunds: Row[]
    returns: Row[]
    adjustments: Row[]
    payouts: Row[]
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
const FALLBACK_COLOR = 'rgb(148 163 184)'
const AGING_COLOR: Record<AgingKey, string> = {
  current: 'bg-green-500',
  d1_30: 'bg-blue-500',
  d31_60: 'bg-amber-500',
  d61_90: 'bg-orange-500',
  d90_plus: 'bg-red-500',
}

const fmtDay = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
const days = (n: number) => `${n} day${n === 1 ? '' : 's'}`

function toSegments(mix: Mix, labels: Record<string, { label: string; color: string }>): OutflowSegment[] {
  return mix
    .filter(m => m.amount > 0)
    .map(m => ({ label: labels[m.key]?.label ?? m.key, value: m.amount, color: labels[m.key]?.color ?? FALLBACK_COLOR }))
}

export function OverviewTab() {
  const router = useRouter()
  const params = useSearchParams()
  const range = useMemo<Range>(() => {
    const r = { from: params.get('from') ?? '', to: params.get('to') ?? '' }
    return isValidRange(r) ? r : presetRange('30d')
  }, [params])
  const [data, setData] = useState<Overview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    api<Overview>(`/api/admin/financial/overview?from=${range.from}&to=${range.to}`).then(({ ok, data }) => {
      if (!active) return
      if (ok && !data.error) setData(data)
      else setError(data.error || 'Could not load the overview')
      setLoading(false)
    })
    return () => {
      active = false
    }
  }, [range.from, range.to])

  const setRange = (r: Range) => {
    if (!isValidRange(r)) return
    router.replace(ap(`/admin/financial?tab=overview&from=${r.from}&to=${r.to}`), { scroll: false })
  }

  return (
    <div className="space-y-5">
      <PeriodBar range={range} onChange={setRange} previous={data?.range.from === range.from ? data.previous_range : null} />
      {error && <Banner ok={false}>{error}</Banner>}
      {loading && !data ? <OverviewSkeleton /> : data && <OverviewBody d={data} dim={loading} />}
    </div>
  )
}

function PeriodBar({ range, onChange, previous }: { range: Range; onChange: (r: Range) => void; previous: Range | null }) {
  const active = matchPreset(range)
  return (
    <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex flex-wrap gap-1 p-1 bg-surface-elevated border border-border-default rounded-lg w-fit max-w-full">
        {PRESETS.map(p => (
          <button
            key={p.key}
            type="button"
            onClick={() => onChange(presetRange(p.key))}
            className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap ${
              active === p.key ? 'bg-accent-500 text-white' : 'text-foreground-muted hover:text-foreground'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs text-foreground-secondary">
        <span aria-label="From">
          <DatePicker aria-label="From" value={range.from} max={range.to} onChange={v => onChange({ from: v, to: range.to })} />
        </span>
        <span>to</span>
        <span aria-label="To">
          <DatePicker aria-label="To" value={range.to} min={range.from} onChange={v => onChange({ from: range.from, to: v })} />
        </span>
        {previous && (
          <span className="text-foreground-muted">
            vs {fmtDay(previous.from)} to {fmtDay(previous.to)}
          </span>
        )}
      </div>
    </div>
  )
}

function OverviewBody({ d, dim }: { d: Overview; dim: boolean }) {
  const c = d.current
  const p = d.previous
  const over30 = d.receivables.aging.filter(b => b.key !== 'current' && b.key !== 'd1_30').reduce((s, b) => s + b.amount, 0)
  const outflowSegs: OutflowSegment[] = [
    { label: 'Supplier / PO payments', value: c.supplier_payments, color: 'rgb(239 68 68)' },
    { label: 'Refunds', value: c.refunds_out, color: 'rgb(234 179 8)' },
  ].filter(s => s.value > 0)
  const hasTrend = d.series.some(s => Number(s.revenue) || Number(s.cash_out) || Number(s.cogs))

  return (
    <div className={`space-y-5 transition-opacity ${dim ? 'opacity-60' : ''}`}>
      <KpiGrid>
        <Kpi
          label="Net sales"
          value={money(c.net_sales)}
          delta={changeOf(c.net_sales, p.net_sales)}
          sub={`${count(c.orders)} sales, ${money(c.refunds)} reversed`}
          highlight
        />
        <Kpi
          label="Gross margin"
          value={c.gross_margin == null ? '-' : pct(c.gross_margin)}
          delta={c.gross_margin == null ? null : changeOf(c.gross_profit, p.gross_profit)}
          sub={c.gross_margin == null ? 'No cost prices on items sold' : `${money(c.gross_profit)} gross profit`}
        />
        <Kpi label="Inflow" value={money(c.inflow)} delta={changeOf(c.inflow, p.inflow)} sub="Paid sales" />
        <Kpi
          label="Outflow"
          value={money(c.outflow)}
          delta={changeOf(c.outflow, p.outflow)}
          invert
          sub="Supplier payments and refunds"
        />
        <Kpi
          label="Net cash"
          value={money(c.net_cash)}
          delta={changeOf(c.net_cash, p.net_cash)}
          sub={c.net_cash < 0 ? 'More went out than came in' : undefined}
        />
        <Kpi
          label="Refunds issued"
          value={money(c.refunds_issued)}
          delta={changeOf(c.refunds_issued, p.refunds_issued)}
          invert
          sub={`${count(c.refunds_issued_count)} orders refunded`}
        />
        {c.gst_payable != null && (
          <Kpi
            label="GST payable"
            value={money(c.gst_payable)}
            delta={changeOf(c.gst_payable, p.gst_payable ?? 0)}
            invert
            sub={`${money(c.gst_output)} output less ${money(c.gst_itc)} ITC`}
          />
        )}
        {d.ai && (
          <Kpi
            label={d.ai.flagship ? 'AI cost' : 'AI spend'}
            value={money(d.ai.amount)}
            delta={changeOf(d.ai.amount, d.ai.previous)}
            invert
            sub={`${count(d.ai.calls)} calls, ${d.ai.flagship ? 'platform cost' : 'charged to wallet'}`}
          />
        )}
        <Kpi
          label="Receivables"
          value={money(d.receivables.total)}
          sub={`${count(d.receivables.count)} unpaid, ${money(over30)} over 30 days`}
        />
        <Kpi
          label="Payables due in 7 days"
          value={money(d.payables.due_7d)}
          sub={d.payables.overdue > 0 ? `${money(d.payables.overdue)} overdue` : `${money(d.payables.total)} open in total`}
        />
        <Kpi
          label="COD awaiting remittance"
          value={money(d.cod.awaiting_remittance)}
          sub={`${count(d.cod.awaiting_remittance_count)} delivered, ${count(d.cod.in_transit_count)} still in transit`}
        />
      </KpiGrid>

      <NeedsAttention d={d} />

      {hasTrend ? (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <CashflowTrendCard data={d.series} granularity={d.bucket} />
          <RevenueExpenseCard data={d.series} granularity={d.bucket} />
        </div>
      ) : (
        <Section title="Trends">
          <p className="text-sm text-foreground-muted text-center py-6">No sales or payments in this period.</p>
        </Section>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <AgingCard
          title="Receivables aging"
          hint="Days since invoice"
          total={d.receivables.total}
          aging={d.receivables.aging}
          href="/admin/financial?tab=receivables"
        />
        <AgingCard
          title="Payables aging"
          hint="Days past due date"
          total={d.payables.total}
          aging={d.payables.aging}
          href="/admin/financial?tab=payables"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        <MixDonutCard
          title="Sales by payment method"
          segments={toSegments(d.by_method, METHOD)}
          total={rsCompact(c.revenue)}
          totalLabel="Paid sales"
        />
        <MixDonutCard
          title="Sales by channel"
          segments={toSegments(d.by_channel, CHANNEL)}
          total={rsCompact(c.revenue)}
          totalLabel="Paid sales"
        />
        {outflowSegs.length ? (
          <OutflowDonutCard segments={outflowSegs} total={rsCompact(c.outflow)} />
        ) : (
          <MixDonutCard title="Outflow composition" segments={[]} total="" totalLabel="" />
        )}
      </div>

      {d.payables.top_suppliers.length > 0 && (
        <TopPayablesCard
          items={d.payables.top_suppliers.map(s => ({ name: s.name || 'Unknown supplier', value: s.amount, sub: money(s.amount) }))}
        />
      )}
    </div>
  )
}

function AgingCard({ title, hint, total, aging, href }: { title: string; hint: string; total: number; aging: Aging; href: string }) {
  return (
    <Section
      title={title}
      action={
        <Link href={ap(href)} className="text-xs text-accent-500 hover:underline normal-case">
          Open
        </Link>
      }
    >
      <p className="text-xs text-foreground-muted -mt-2 mb-3">
        {hint}. {money(total)} open.
      </p>
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-surface-secondary mb-4">
        {total > 0 &&
          aging
            .filter(b => b.amount > 0)
            .map(b => (
              <div key={b.key} className={AGING_COLOR[b.key]} style={{ width: `${(b.amount / total) * 100}%` }} title={b.label} />
            ))}
      </div>
      <ul className="space-y-1.5">
        {aging.map(b => (
          <li key={b.key} className="flex items-center gap-2 text-sm">
            <span className={`w-2.5 h-2.5 rounded-sm shrink-0 ${AGING_COLOR[b.key]}`} />
            <span className="text-foreground-secondary flex-1">{b.label}</span>
            <span className="text-xs text-foreground-muted tabular-nums">{count(b.count)}</span>
            <span className="w-28 text-right font-medium tabular-nums text-foreground">{money(b.amount)}</span>
          </li>
        ))}
      </ul>
    </Section>
  )
}

type Item = { key: string; primary: string; secondary: string; amount?: number; href: string }
type Group = { key: string; title: string; tone: Tone; href: string; action: string; items: Item[] }

function NeedsAttention({ d }: { d: Overview }) {
  const a = d.attention
  const orderHref = (id: string) => `/admin/orders/${id}/view`
  const groups: Group[] = [
    {
      key: 'rec',
      title: 'Overdue receivables (over 30 days)',
      tone: 'red' as Tone,
      href: '/admin/financial?tab=receivables',
      action: 'Receivables',
      items: a.receivables.map(r => ({
        key: r.id,
        primary: `${r.customer_name} · ${r.order_number}`,
        secondary: `${days(r.days)} since invoice`,
        amount: r.amount,
        href: orderHref(r.id),
      })),
    },
    {
      key: 'pay',
      title: 'Supplier bills due this week or overdue',
      tone: 'amber' as Tone,
      href: '/admin/financial?tab=payables',
      action: 'Payables',
      items: a.payables.map(r => ({
        key: r.id,
        primary: `${r.supplier_name} · ${r.expense_number}`,
        secondary: r.days > 0 ? `${days(r.days)} overdue` : `Due ${fmtDay(r.due_date)}`,
        amount: r.amount,
        href: '/admin/financial?tab=payables',
      })),
    },
    {
      key: 'cod',
      title: `COD delivered but not remitted for over ${a.cod_stale_days} days`,
      tone: 'amber' as Tone,
      href: '/admin/financial?tab=cod_remittance',
      action: 'COD remittance',
      items: a.cod.map(r => ({
        key: r.id,
        primary: `${r.order_number}${r.customer_name ? ` · ${r.customer_name}` : ''}`,
        secondary: `Delivered ${days(r.days)} ago`,
        amount: r.amount,
        href: '/admin/financial?tab=cod_remittance',
      })),
    },
    {
      key: 'refund',
      title: 'Cancelled or returned but not refunded',
      tone: 'red' as Tone,
      href: '/admin/orders',
      action: 'Orders',
      items: [
        ...a.refunds.map(r => ({
          key: `o${r.id}`,
          primary: `${r.order_number}${r.customer_name ? ` · ${r.customer_name}` : ''}`,
          secondary: `${r.status === 'returned' ? 'Returned' : 'Cancelled'} ${days(r.days)} ago, still marked paid`,
          amount: r.amount,
          href: orderHref(r.id),
        })),
        ...a.returns.map(r => ({
          key: `r${r.id}`,
          primary: `${r.order_number ?? 'Return'}${r.customer_name ? ` · ${r.customer_name}` : ''}`,
          secondary: `Return received ${days(r.days)} ago, refund pending`,
          amount: r.amount || undefined,
          href: r.order_id ? orderHref(r.order_id) : '/admin/returns',
        })),
        ...a.adjustments.map(r => ({
          key: `a${r.id}`,
          primary: r.order_number,
          secondary: `Adjustment refund pending for ${days(r.days)}`,
          amount: r.amount,
          href: orderHref(r.order_id),
        })),
      ],
    },
    {
      key: 'payout',
      title: 'Supplier payouts failed or stuck',
      tone: 'red' as Tone,
      href: '/admin/financial?tab=payables',
      action: 'Payables',
      items: a.payouts.map(r => ({
        key: r.id,
        primary: `${r.supplier_name} · ${r.expense_number}`,
        secondary: `Payout ${r.payout_status}${r.payout_status === 'failed' || r.payout_status === 'reversed' ? '' : ` for ${days(r.days)}`}`,
        amount: r.amount,
        href: '/admin/financial?tab=payables',
      })),
    },
  ].filter(g => g.items.length > 0)

  if (!groups.length) {
    return <Banner ok>Nothing needs attention: no overdue receivables, bills due this week, stale COD, pending refunds or stuck payouts.</Banner>
  }

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
              <Link href={ap(g.href)} className="text-xs text-accent-500 hover:underline shrink-0">
                {g.action}
              </Link>
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

function OverviewSkeleton() {
  return (
    <div className="space-y-5">
      <AdminStatsSkeleton cards={6} gridClass="grid-cols-2 md:grid-cols-3 xl:grid-cols-6" />
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <ChartSkeleton bodyClass="h-44" />
        <ChartSkeleton bodyClass="h-44" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartSkeleton bodyClass="h-40" />
        <ChartSkeleton bodyClass="h-40" />
      </div>
    </div>
  )
}

function ChartSkeleton({ bodyClass }: { bodyClass: string }) {
  return (
    <div className="bg-surface-elevated rounded-xl border border-border-default p-4 sm:p-5 animate-fade-in">
      <div className="motion-safe:animate-pulse space-y-3">
        <div className="h-4 w-40 bg-surface-secondary rounded" />
        <div className={`w-full bg-surface-secondary rounded ${bodyClass}`} />
      </div>
    </div>
  )
}
