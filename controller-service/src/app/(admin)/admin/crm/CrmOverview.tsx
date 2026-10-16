'use client'

import { useCallback, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { Kpi, Section, Badge, Table, Empty, api, money, count, pct, change, when, type Col } from '@/components/admin/channels/ui'
import { TrendChart, type SeriesDef, type ChartPoint } from '@/components/admin/dashboard/Charts'
import { GroupLabel } from '@/components/admin/dashboard/Primitives'
import { ap } from '@/lib/shared/admin-path'
import DatePicker from '@/components/ui/DatePicker'
import type { CrmInsights as CrmInsightsData } from '@/lib/shared/crm-insights-shared'
import CrmInsights from './CrmInsights'
import { PERIOD_PRESETS, insightsRangeFor, matchPreset, periodLabel, presetPeriod, type Period } from './_lib/period'
import type { CohortRow, CrmOverviewData, OverviewAttention, TopCustomer } from './_lib/overview'

const DOT: Record<OverviewAttention['severity'], string> = {
  high: 'bg-red-500',
  medium: 'bg-amber-500',
  low: 'bg-zinc-400',
}

const TREND_SERIES: SeriesDef[] = [
  { key: 'returningRevenue', label: 'Returning revenue', color: 'rgb(16 185 129)', kind: 'area', axis: 'money', on: true },
  { key: 'newRevenue', label: 'New customer revenue', color: 'rgb(59 130 246)', kind: 'area', axis: 'money', on: true },
  { key: 'newBuyers', label: 'New buyers', color: 'rgb(224 123 63)', kind: 'bar', axis: 'count' },
  { key: 'returningBuyers', label: 'Returning buyers', color: 'rgb(168 85 247)', kind: 'line', axis: 'count' },
]

function PeriodPicker({
  value,
  today,
  disabled,
  onChange,
}: {
  value: Period
  today: string
  disabled: boolean
  onChange: (p: Period) => void
}) {
  const active = matchPreset(value, today)
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:flex-wrap">
      <div className="flex flex-wrap gap-1 p-1 bg-surface-elevated border border-border-default rounded-lg w-fit">
        {PERIOD_PRESETS.map(p => (
          <button
            key={p.key}
            type="button"
            disabled={disabled}
            onClick={() => onChange(presetPeriod(p.key, today))}
            className={`px-2.5 py-1.5 text-xs font-medium rounded-md disabled:opacity-50 ${
              active === p.key ? 'bg-accent-500 text-white' : 'text-foreground-muted hover:text-foreground'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1.5 text-xs text-foreground-muted">
        <span aria-label="From">
          <DatePicker aria-label="From" value={value.from} max={value.to} disabled={disabled} onChange={v => v && onChange({ from: v, to: value.to })} />
        </span>
        <span>to</span>
        <span aria-label="To">
          <DatePicker aria-label="To" value={value.to} min={value.from} max={today} disabled={disabled} onChange={v => v && onChange({ from: value.from, to: v })} />
        </span>
      </div>
    </div>
  )
}

function AttentionList({ items, host }: { items: OverviewAttention[]; host: string }) {
  if (!items.length) return <p className="text-sm text-foreground-muted">No customer trends need action right now.</p>
  return (
    <div className="divide-y divide-border-default">
      {items.map(it => (
        <Link
          key={it.key}
          href={ap(it.href, host)}
          className="flex items-center gap-3 py-2.5 group hover:bg-surface-secondary/50 -mx-2 px-2 rounded-lg transition-colors"
        >
          <span className={`w-2 h-2 rounded-full shrink-0 ${DOT[it.severity]}`} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-foreground group-hover:text-accent-600 transition-colors">{it.label}</p>
            <p className="text-[11px] text-foreground-muted mt-0.5">{it.sub}</p>
          </div>
        </Link>
      ))}
    </div>
  )
}

function cohortLabel(ym: string) {
  return new Date(`${ym}-01T00:00:00Z`).toLocaleDateString('en-IN', { month: 'short', year: '2-digit', timeZone: 'UTC' })
}

function cellStyle(v: number | null) {
  if (v == null) return undefined
  const alpha = Math.max(0.06, Math.min(0.9, v))
  return { background: `rgb(16 185 129 / ${alpha})`, color: alpha > 0.55 ? '#fff' : undefined }
}

function CohortTable({ rows }: { rows: CohortRow[] }) {
  if (!rows.length) return <Empty msg="No first orders in the last 12 months" />
  return (
    <div className="overflow-x-auto -mx-1">
      <table className="w-full text-xs border-separate border-spacing-1">
        <thead>
          <tr>
            <th className="text-left font-medium text-foreground-muted px-1 py-1">First order</th>
            <th className="text-right font-medium text-foreground-muted px-1 py-1">Customers</th>
            {[1, 2, 3, 4, 5, 6].map(m => (
              <th key={m} className="text-center font-medium text-foreground-muted px-1 py-1 tabular-nums">
                M{m}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.cohort}>
              <td className="text-foreground-secondary px-1 py-1 whitespace-nowrap">{cohortLabel(r.cohort)}</td>
              <td className="text-right text-foreground px-1 py-1 tabular-nums">{count(r.size)}</td>
              {r.retention.map((v, i) => (
                <td key={i} className="text-center px-1 py-1 tabular-nums rounded text-foreground" style={cellStyle(v)}>
                  {v == null ? '' : `${Math.round(v * 100)}%`}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function riskBadge(c: TopCustomer) {
  if (c.healthScore == null) return <Badge>Not scored</Badge>
  const tone = c.churnRisk === 'high' ? 'red' : c.churnRisk === 'rising_concern' ? 'amber' : 'green'
  return <Badge tone={tone}>{c.healthScore}</Badge>
}

export default function CrmOverview({
  initial,
  today,
  host,
  insights,
  attentionQueue,
  tasks,
  health,
  segments,
  activity,
}: {
  initial: CrmOverviewData
  today: string
  host: string
  insights: CrmInsightsData | null
  attentionQueue: ReactNode
  tasks: ReactNode
  health: ReactNode
  segments: ReactNode
  activity: ReactNode
}) {
  const [data, setData] = useState<CrmOverviewData>(initial)
  const [period, setPeriod] = useState<Period>(initial.period)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const changePeriod = useCallback(
    async (p: Period) => {
      if (p.from > p.to || (p.from === period.from && p.to === period.to)) return
      setPeriod(p)
      setLoading(true)
      setError(null)
      // History only: a router navigation would re-run the whole server page.
      const url = new URL(window.location.href)
      url.searchParams.set('from', p.from)
      url.searchParams.set('to', p.to)
      window.history.replaceState(null, '', url)
      const { ok, data: d } = await api<CrmOverviewData>(`/api/admin/crm/overview?from=${p.from}&to=${p.to}`).catch(() => ({
        ok: false,
        data: { error: 'Network error' } as CrmOverviewData & { error?: string },
      }))
      if (ok) setData(d)
      else setError(d.error || 'Failed to load')
      setLoading(false)
    },
    [period]
  )

  const k = data.current
  const p = data.prior
  const syncRange = insightsRangeFor(matchPreset(period, today))
  const points: ChartPoint[] = data.trend.map(t => ({ ...t }))

  const cols: Col<TopCustomer>[] = [
    {
      key: 'name',
      label: 'Customer',
      render: c => (
        <Link href={ap(`/admin/customers/${c.id}`, host)} className="block min-w-0 hover:text-accent-600">
          <span className="font-medium text-foreground">{c.name}</span>
          {c.email && <span className="block text-[11px] text-foreground-muted truncate max-w-[14rem]">{c.email}</span>}
        </Link>
      ),
    },
    { key: 'orders', label: 'Orders', num: true, render: c => count(c.orders), sort: c => c.orders },
    { key: 'revenue', label: 'Revenue', num: true, render: c => money(c.revenue), sort: c => c.revenue },
    { key: 'ltv', label: 'Lifetime', num: true, render: c => money(c.ltv), sort: c => c.ltv },
    { key: 'last', label: 'Last order', render: c => <span className="whitespace-nowrap text-xs">{when(c.lastAt)}</span> },
    { key: 'health', label: 'Health', render: riskBadge, sort: c => c.healthScore ?? -1 },
  ]

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-secondary-500 dark:text-foreground">CRM</h1>
          <p className="text-foreground-secondary text-sm mt-1">
            {periodLabel(data.period)} compared with {periodLabel(data.previous)}
          </p>
        </div>
        <PeriodPicker value={period} today={today} disabled={loading} onChange={changePeriod} />
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}

      <div className={`grid gap-3 grid-cols-2 md:grid-cols-4 transition-opacity ${loading ? 'opacity-60' : ''}`}>
        <Kpi label="Total customers" value={count(k.totalCustomers)} delta={change(k.totalCustomers, p.totalCustomers)} sub="Registered accounts" />
        <Kpi label="New customers" value={count(k.newCustomers)} delta={change(k.newCustomers, p.newCustomers)} sub={`${count(k.firstTimeBuyers)} placed a first order`} />
        <Kpi label="Active customers" value={count(k.activeCustomers)} delta={change(k.activeCustomers, p.activeCustomers)} sub={`${count(k.orders)} orders in period`} highlight />
        <Kpi
          label="Repeat purchase rate"
          value={pct(k.repeatRate, 0)}
          delta={k.repeatRate != null && p.repeatRate != null ? change(k.repeatRate, p.repeatRate) : null}
          sub="Active customers with 2+ orders to date"
        />
        <Kpi label="Avg order value" value={money(k.aov)} delta={k.aov != null && p.aov != null ? change(k.aov, p.aov) : null} />
        <Kpi
          label="Revenue per customer"
          value={money(k.revenuePerCustomer)}
          delta={k.revenuePerCustomer != null && p.revenuePerCustomer != null ? change(k.revenuePerCustomer, p.revenuePerCustomer) : null}
          sub={`${money(k.revenue)} from customers`}
        />
        <Kpi
          label="Avg lifetime value"
          value={money(k.avgClv)}
          delta={k.avgClv != null && p.avgClv != null ? change(k.avgClv, p.avgClv) : null}
          sub={`${count(k.buyersToDate)} customers who have bought`}
        />
        <Kpi
          label="At risk + churned"
          value={count(k.atRisk + k.churned)}
          delta={change(k.atRisk + k.churned, p.atRisk + p.churned)}
          invert
          sub={`${count(k.atRisk)} at risk (90-180d), ${count(k.churned)} churned (180d+)`}
        />
      </div>
      <p className="text-[11px] text-foreground-muted -mt-2">
        Revenue counts paid or COD-collected orders by registered customers, excluding cancelled and returned orders.
      </p>

      <GroupLabel title="Needs attention" />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Section title="Customer trends">
          <AttentionList items={data.attention} host={host} />
        </Section>
        <div className="space-y-5">
          {attentionQueue}
          {tasks}
        </div>
      </div>

      <GroupLabel title="Customers and revenue" hint={periodLabel(data.period)} />
      <div className={`space-y-5 transition-opacity ${loading ? 'opacity-60' : ''}`}>
        <Section title="New vs returning customers">
          <TrendChart points={points} bucket={data.bucket} series={TREND_SERIES} ariaLabel="Revenue from new and returning customers" />
        </Section>
        <div className="grid grid-cols-1 xl:grid-cols-5 gap-5">
          <div className="xl:col-span-3 min-w-0">
            <Section title="Top customers by revenue">
              <Table rows={data.topCustomers} cols={cols} rowKey={c => c.id} empty="No customer orders in this period" pageSize={10} />
            </Section>
          </div>
          <div className="xl:col-span-2 min-w-0">
            <Section title="Retention by first-order month">
              <p className="text-[11px] text-foreground-muted -mt-2 mb-3">Share of each cohort ordering again 1 to 6 months later.</p>
              <CohortTable rows={data.cohorts} />
            </Section>
          </div>
        </div>
      </div>

      <GroupLabel title="Health" hint="current" />
      {health}

      <GroupLabel title="Segments" />
      {segments}

      <GroupLabel title="Activity" />
      {activity}

      {insights && (
        <>
          <GroupLabel
            title="Deep dive"
            hint={syncRange ? 'follows the period above; filter by segment' : 'pick a range here; custom periods do not apply'}
          />
          <CrmInsights initial={insights} syncRange={syncRange} />
        </>
      )}
    </div>
  )
}
