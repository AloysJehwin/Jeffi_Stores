'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { ListFilters, useFilterQuery } from '@/components/admin/kit'
import { ORDER_ALIASES, ORDER_FIELDS, ORDER_SEARCH } from '@/lib/filters/fields/orders'
import { Kpi, KpiGrid, Section, Banner, Table, count, money, pct } from '@/components/admin/channels/ui'
import {
  AttentionList,
  OverviewSkeleton,
  PeriodBar,
  useOverviewData,
  usePeriod,
  type AttentionItem,
} from '@/components/admin/overview/kit'
import { DonutSplit, TrendChart, type SeriesDef } from '@/components/admin/dashboard/Charts'
import { MAX_SPAN_DAYS, delta, type Bucket, type Period } from '@/lib/overview/period'
import { ap } from '@/lib/shared/admin-path'
import { BreakdownBars, fmtDays, fmtHours, withAp } from './overview-shared'

interface Kpis {
  placed: number
  value: number
  paidValue: number
  aov: number | null
  cancelled: number
  cancelRate: number | null
  cod: number
  prepaid: number
  codValue: number
  codShare: number | null
  shipped: number
  dispatchHours: number | null
  rto: number
  rtoRate: number | null
  delivered: number
  transitDays: number | null
  orderToDoorDays: number | null
  onTimeRate: number | null
}

interface Data {
  period: Period
  previous: Period
  bucket: Bucket
  handlingDays: number
  kpis: { current: Kpis; previous: Kpis }
  snapshot: { toConfirm: number; toShip: number; lateToShip: number; oldestPending: string | null }
  pipeline: { status: string; label: string; count: number; value: number }[]
  series: { label: string; orders: number; value: number; shipped: number }[]
  bySource: { source: string; label: string; orders: number; value: number }[]
  byState: { state: string; orders: number; value: number }[]
  cancellations: { reason: string; label: string; count: number; value: number }[]
  attention: AttentionItem[]
}

const SERIES: SeriesDef[] = [
  { key: 'value', label: 'Order value', color: 'rgb(224 123 63)', kind: 'area', axis: 'money', on: true },
  { key: 'orders', label: 'Orders', color: 'rgb(59 130 246)', kind: 'bar', axis: 'count', on: true },
  { key: 'shipped', label: 'Shipped', color: 'rgb(16 185 129)', kind: 'line', axis: 'count', on: false },
]

export default function OrdersOverview() {
  const [period, setPeriod] = usePeriod()
  const sp = useSearchParams()
  // KPIs and charts follow the list's filters; the PeriodBar owns from / to.
  const filters = useFilterQuery(ORDER_FIELDS, { aliases: ORDER_ALIASES, omit: ['from', 'to'] })
  const { data, error, loading, reload } = useOverviewData<Data>(
    `/api/admin/orders/overview?from=${period.from}&to=${period.to}${filters ? `&${filters}` : ''}`
  )
  const clamped = !!sp.get('from') && sp.get('from') !== period.from

  return (
    <div className="space-y-4">
      <PeriodBar value={period} onChange={setPeriod} onRefresh={reload} busy={loading} />
      <ListFilters
        entity="orders"
        fields={ORDER_FIELDS}
        aliases={ORDER_ALIASES}
        search={ORDER_SEARCH}
        period
        noun="Orders"
        tab="overview"
      />
      {clamped && (
        <p className="text-xs text-foreground-muted">
          The overview covers at most {MAX_SPAN_DAYS} days: showing {period.from} to {period.to}.
        </p>
      )}
      {error && <Banner ok={false}>{error}</Banner>}
      {loading && !data ? <OverviewSkeleton /> : data ? <Body d={data} filters={filters} /> : null}
    </div>
  )
}

function Body({ d, filters }: { d: Data; filters: string }) {
  const c = d.kpis.current
  const p = d.kpis.previous
  const listHref = (patch: Record<string, string>) => {
    const q = new URLSearchParams(filters)
    for (const [k, v] of Object.entries(patch)) q.set(k, v)
    return ap(`/admin/orders?tab=list&${q}`)
  }

  return (
    <>
      <KpiGrid>
        <Kpi label="Orders placed" value={count(c.placed)} delta={delta(c.placed, p.placed)} highlight />
        <Kpi label="Order value" value={money(c.value)} delta={delta(c.value, p.value)} sub="Excludes cancelled" />
        <Kpi label="Average order" value={money(c.aov)} delta={delta(c.aov, p.aov)} />
        <Kpi label="Paid revenue" value={money(c.paidValue)} delta={delta(c.paidValue, p.paidValue)} />
        <Kpi
          label="Cancel rate"
          value={pct(c.cancelRate)}
          delta={delta(c.cancelRate, p.cancelRate)}
          invert
          sub={`${count(c.cancelled)} cancelled`}
        />
        <Kpi
          label="COD share"
          value={pct(c.codShare)}
          delta={delta(c.codShare, p.codShare)}
          sub={`${count(c.cod)} COD, ${count(c.prepaid)} prepaid`}
        />
        <Kpi label="Shipped" value={count(c.shipped)} delta={delta(c.shipped, p.shipped)} />
        <Kpi
          label="Time to dispatch"
          value={fmtHours(c.dispatchHours)}
          delta={delta(c.dispatchHours, p.dispatchHours)}
          invert
          sub={`Target ${d.handlingDays} days`}
        />
        <Kpi label="Delivered" value={count(c.delivered)} delta={delta(c.delivered, p.delivered)} />
        <Kpi
          label="Time in transit"
          value={fmtDays(c.transitDays)}
          delta={delta(c.transitDays, p.transitDays)}
          invert
          sub={`Order to door ${fmtDays(c.orderToDoorDays)}`}
        />
        <Kpi
          label="On time"
          value={pct(c.onTimeRate)}
          delta={delta(c.onTimeRate, p.onTimeRate)}
          sub="Delivered by the promised date"
        />
        <Kpi
          label="RTO rate"
          value={pct(c.rtoRate)}
          delta={delta(c.rtoRate, p.rtoRate)}
          invert
          sub={`${count(c.rto)} returned to origin`}
        />
      </KpiGrid>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <AttentionList items={withAp(d.attention)} />
        <Section title="Open orders now">
          <div className="grid grid-cols-3 gap-2 mb-4 text-center">
            <Link href={listHref({ status: 'pending' })} className="rounded-lg bg-surface-secondary p-2 hover:bg-surface">
              <p className="text-lg font-bold tabular-nums text-foreground">{count(d.snapshot.toConfirm)}</p>
              <p className="text-xs text-foreground-muted">To confirm</p>
            </Link>
            <Link href={ap('/admin/packing-slips')} className="rounded-lg bg-surface-secondary p-2 hover:bg-surface">
              <p className="text-lg font-bold tabular-nums text-foreground">{count(d.snapshot.toShip)}</p>
              <p className="text-xs text-foreground-muted">To ship</p>
            </Link>
            <Link href={listHref({ late_to_ship: 'true' })} className="rounded-lg bg-surface-secondary p-2 hover:bg-surface">
              <p
                className={`text-lg font-bold tabular-nums ${d.snapshot.lateToShip ? 'text-red-500' : 'text-foreground'}`}
              >
                {count(d.snapshot.lateToShip)}
              </p>
              <p className="text-xs text-foreground-muted">Late to ship</p>
            </Link>
          </div>
          <ul className="divide-y divide-border-default text-sm">
            {d.pipeline
              .filter(s => s.count > 0)
              .map(s => (
                <li key={s.status}>
                  <Link
                    href={listHref({ status: s.status })}
                    className="flex items-center justify-between gap-3 py-2 hover:text-accent-500"
                  >
                    <span className="text-foreground">{s.label}</span>
                    <span className="tabular-nums text-foreground-muted">
                      {count(s.count)} <span className="ml-2">{money(s.value)}</span>
                    </span>
                  </Link>
                </li>
              ))}
          </ul>
        </Section>
      </div>

      <Section title="Orders over time">
        <TrendChart
          points={d.series}
          series={SERIES}
          bucket={d.bucket}
          height={240}
          ariaLabel="Orders and order value over the period"
        />
      </Section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Section title="Payment mix">
          {c.cod + c.prepaid ? (
            <DonutSplit
              segments={[
                { label: 'Prepaid', value: c.prepaid, color: 'rgb(16 185 129)' },
                { label: 'Cash on delivery', value: c.cod, color: 'rgb(234 179 8)' },
              ]}
              centerLabel="orders"
              centerValue={count(c.cod + c.prepaid)}
            />
          ) : (
            <p className="text-sm text-foreground-muted">No orders in this period.</p>
          )}
          <p className="mt-3 text-xs text-foreground-muted">COD value {money(c.codValue)}</p>
        </Section>
        <Section title="By channel">
          <BreakdownBars
            rows={d.bySource.map(s => ({ label: s.label, value: s.value, sub: `${count(s.orders)} orders` }))}
            format={v => money(v)}
          />
        </Section>
        <Section title="Cancellations by reason">
          <BreakdownBars rows={d.cancellations.map(r => ({ label: r.label, value: r.count, sub: money(r.value) }))} />
        </Section>
      </div>

      <Section title="Top states">
        <Table
          rows={d.byState}
          rowKey={r => r.state}
          empty="No orders in this period."
          cols={[
            { key: 'state', label: 'State', render: r => r.state },
            { key: 'orders', label: 'Orders', num: true, render: r => count(r.orders), sort: r => r.orders },
            { key: 'value', label: 'Value', num: true, render: r => money(r.value), sort: r => r.value },
            {
              key: 'share',
              label: 'Share',
              num: true,
              render: r => pct(c.value ? r.value / c.value : null),
            },
          ]}
        />
      </Section>
    </>
  )
}
