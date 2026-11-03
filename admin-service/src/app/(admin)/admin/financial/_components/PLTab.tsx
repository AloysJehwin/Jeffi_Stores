'use client'

// P&L tab rebuilt on the AiCostsTab pattern: shared ?from&to range (default FY), kit KPIs with
// delta vs the previous FY, trend + donut row, and a monthly table whose rows deep-link to
// ?month=YYYY-MM for an inline detail view (replaces the former modal).

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Banner, Kpi, KpiGrid, Section, Table, count, money, type Col } from '@/components/admin/channels/ui'
import { OverviewSkeleton, useOverviewData } from '@/components/admin/overview/kit'
import { KeyedTrendCard, MixDonutCard, type TrendPoint } from '@/components/admin/kit/charts'
import { delta } from '@/lib/overview/period'
import { ap } from '@/lib/shared/admin-path'
import { FinancePeriodBar, useFinancePeriod, type FinanceBucket, type FinanceRange } from './finance'
import type { PLMonth, PLTotals } from '@/lib/payments/financial'

type SourceRow = { key: string; label: string; revenue: number }
// Mirrors FinanceOverviewContract<PLTotals, PLMonth>, but by_dim2 carries source rows (not PLMonth).
type PL = {
  range: FinanceRange
  previous_range: FinanceRange
  bucket: FinanceBucket
  current: PLTotals
  previous: PLTotals
  series?: TrendPoint[]
  by_dim?: PLMonth[]
  by_dim2?: SourceRow[]
}

const METRIC_LABEL: Record<string, string> = { revenue: 'Revenue', cogs: 'COGS', gross_profit: 'Gross profit' }
const SOURCE_COLOR: Record<string, string> = {
  online: 'rgb(59 130 246)',
  business: 'rgb(168 85 247)',
  cash_sale: 'rgb(16 185 129)',
  offline: 'rgb(249 115 22)',
}
const SOURCE_FALLBACK = 'rgb(148 163 184)'

const monthShort = (m: string) =>
  new Date(`${m.slice(0, 7)}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })
const monthLong = (m: string) =>
  new Date(`${m.slice(0, 7)}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })

function monthRange(m: string): { from: string; to: string } {
  const y = +m.slice(0, 4)
  const mo = +m.slice(5, 7)
  const last = new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10)
  return { from: `${m.slice(0, 7)}-01`, to: last }
}

export function PLTab() {
  const sp = useSearchParams()
  const month = sp.get('month')
  const { range } = useFinancePeriod('fy')
  const { data, error, loading, reload } = useOverviewData<PL>(
    `/api/admin/financial/pl?from=${range.from}&to=${range.to}`
  )

  return (
    <div className="space-y-5">
      <FinancePeriodBar onRefresh={reload} busy={loading} defaultPreset="fy" />
      {error && <Banner ok={false}>{error}</Banner>}
      {loading && !data ? (
        <OverviewSkeleton />
      ) : data ? (
        month ? <MonthDetail d={data} month={month} /> : <Body d={data} />
      ) : null}
    </div>
  )
}

function Body({ d }: { d: PL }) {
  const c = d.current
  const p = d.previous
  const monthly = d.by_dim ?? []
  const sources = d.by_dim2 ?? []
  const rowHref = (m: string) =>
    ap(`/admin/financial?tab=pl&from=${d.range.from}&to=${d.range.to}&month=${m}`)

  const cols: Col<PLMonth>[] = [
    {
      key: 'month',
      label: 'Month',
      sort: m => m.month,
      render: m => (
        <Link href={rowHref(m.month)} className="font-medium text-foreground hover:text-accent-500">
          {monthShort(m.month)}
        </Link>
      ),
    },
    { key: 'revenue', label: 'Revenue', num: true, sort: m => m.revenue, render: m => money(m.revenue) },
    { key: 'refunds', label: 'Refunds', num: true, sort: m => m.refunds, render: m => money(m.refunds) },
    { key: 'net', label: 'Net rev', num: true, sort: m => m.net_revenue, render: m => money(m.net_revenue) },
    { key: 'cogs', label: 'COGS', num: true, sort: m => m.cogs, render: m => money(m.cogs) },
    { key: 'gross', label: 'Gross profit', num: true, sort: m => m.gross_profit, render: m => money(m.gross_profit) },
    { key: 'margin', label: 'Margin', num: true, sort: m => m.gross_margin_pct, render: m => `${m.gross_margin_pct}%` },
    {
      key: 'opex',
      label: 'Op exp',
      num: true,
      sort: m => m.operating_expenses,
      render: m => money(m.operating_expenses),
    },
    {
      key: 'op',
      label: 'Op profit',
      num: true,
      sort: m => m.operating_profit,
      render: m => (
        <span className={m.operating_profit < 0 ? 'text-red-500' : 'text-foreground'}>
          {money(m.operating_profit)}
        </span>
      ),
    },
    { key: 'orders', label: 'Orders', num: true, sort: m => m.order_count, render: m => count(m.order_count) },
  ]

  return (
    <div className="space-y-5">
      <KpiGrid>
        <Kpi
          label="Revenue"
          value={money(c.revenue)}
          delta={delta(c.revenue, p.revenue)}
          sub={`${count(c.order_count)} orders`}
          highlight
        />
        <Kpi
          label="Net revenue"
          value={money(c.net_revenue)}
          delta={delta(c.net_revenue, p.net_revenue)}
          sub={`${money(c.refunds)} reversed`}
        />
        <Kpi label="COGS" value={money(c.cogs)} delta={delta(c.cogs, p.cogs)} invert />
        <Kpi
          label="Gross profit"
          value={money(c.gross_profit)}
          delta={delta(c.gross_profit, p.gross_profit)}
          sub={`${c.gross_margin_pct}% margin`}
        />
        <Kpi
          label="Op expenses"
          value={money(c.operating_expenses)}
          delta={delta(c.operating_expenses, p.operating_expenses)}
          invert
          sub="Supplier / PO payments"
        />
        <Kpi
          label="Op profit"
          value={money(c.operating_profit)}
          delta={delta(c.operating_profit, p.operating_profit)}
        />
        <Kpi
          label="GST collected"
          value={money(c.tax_collected)}
          delta={delta(c.tax_collected, p.tax_collected)}
          sub="Output on paid invoices"
        />
        <Kpi label="Orders" value={count(c.order_count)} delta={delta(c.order_count, p.order_count)} />
      </KpiGrid>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2">
          <KeyedTrendCard
            title="Revenue, COGS and gross profit"
            data={d.series ?? []}
            keys={['revenue', 'cogs', 'gross_profit']}
            labels={METRIC_LABEL}
            granularity={d.bucket}
          />
        </div>
        <MixDonutCard
          title="Revenue by source"
          segments={sources.map(s => ({
            label: s.label,
            value: s.revenue,
            color: SOURCE_COLOR[s.key] ?? SOURCE_FALLBACK,
          }))}
          total={money(c.revenue)}
          totalLabel="Revenue"
        />
      </div>

      <Section title="Monthly P&L">
        <Table
          rows={monthly}
          cols={cols}
          rowKey={m => m.month}
          empty="No paid orders in this period."
        />
      </Section>
    </div>
  )
}

function MonthDetail({ d, month }: { d: PL; month: string }) {
  const monthly = d.by_dim ?? []
  const m = monthly.find(r => r.month === month)
  const backHref = ap(`/admin/financial?tab=pl&from=${d.range.from}&to=${d.range.to}`)
  const { from: mFrom, to: mTo } = monthRange(month)

  if (!m) {
    return (
      <Section
        title={`${monthLong(month)} - not in current range`}
        action={
          <Link href={backHref} className="text-xs text-accent-500 hover:underline normal-case">
            Back to P&L
          </Link>
        }
      >
        <p className="text-sm text-foreground-muted">
          Change the period above to include this month, then re-open the row.
        </p>
      </Section>
    )
  }

  const sources: SourceRow[] = [
    { key: 'online', label: 'Website', revenue: m.revenue_online },
    { key: 'business', label: 'B2B', revenue: m.revenue_business },
    { key: 'cash_sale', label: 'Cash sale', revenue: m.revenue_cash_sale },
    { key: 'offline', label: 'Offline / Store', revenue: m.revenue_offline },
  ].filter(s => s.revenue > 0)

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-foreground uppercase tracking-wide">
          {monthLong(month)} - P&L
        </h2>
        <Link href={backHref} className="text-xs text-accent-500 hover:underline">
          Back to P&L
        </Link>
      </div>
      <KpiGrid>
        <Kpi label="Revenue" value={money(m.revenue)} sub={`${count(m.order_count)} orders`} highlight />
        <Kpi label="Refunds" value={money(m.refunds)} />
        <Kpi label="Net revenue" value={money(m.net_revenue)} />
        <Kpi label="COGS" value={money(m.cogs)} />
        <Kpi label="Gross profit" value={money(m.gross_profit)} sub={`${m.gross_margin_pct}% margin`} />
        <Kpi label="Op expenses" value={money(m.operating_expenses)} />
        <Kpi label="Op profit" value={money(m.operating_profit)} />
        <Kpi label="GST collected" value={money(m.tax_collected)} />
      </KpiGrid>
      {sources.length > 0 && (
        <MixDonutCard
          title="Revenue by source"
          segments={sources.map(s => ({
            label: s.label,
            value: s.revenue,
            color: SOURCE_COLOR[s.key] ?? SOURCE_FALLBACK,
          }))}
          total={money(m.revenue)}
          totalLabel="Revenue"
        />
      )}
      <Section
        title="Drill into this month"
        action={
          <Link
            href={ap(`/admin/orders?from=${mFrom}&to=${mTo}`)}
            className="text-xs text-accent-500 hover:underline normal-case"
          >
            Orders in {monthShort(month)}
          </Link>
        }
      >
        <ul className="space-y-2 text-sm">
          <li>
            <Link
              href={ap(`/admin/orders?from=${mFrom}&to=${mTo}`)}
              className="text-accent-500 hover:underline"
            >
              Orders invoiced in this month
            </Link>
          </li>
          <li>
            <Link
              href={ap(`/admin/financial?tab=payables&from=${mFrom}&to=${mTo}`)}
              className="text-accent-500 hover:underline"
            >
              Supplier bills and payments
            </Link>
          </li>
          <li>
            <Link
              href={ap(`/admin/financial?tab=transactions&from=${mFrom}&to=${mTo}`)}
              className="text-accent-500 hover:underline"
            >
              All finance transactions
            </Link>
          </li>
        </ul>
      </Section>
    </div>
  )
}
