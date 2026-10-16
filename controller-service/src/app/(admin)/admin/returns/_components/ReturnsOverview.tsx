'use client'

import Link from 'next/link'
import { Kpi, KpiGrid, Section, Banner, Table, Badge, count, money, pct, when } from '@/components/admin/channels/ui'
import {
  AttentionList,
  OverviewSkeleton,
  PeriodBar,
  useOverviewData,
  usePeriod,
  type AttentionItem,
} from '@/components/admin/overview/kit'
import { DonutSplit, TrendChart, type SeriesDef } from '@/components/admin/dashboard/Charts'
import { delta, type Bucket, type Period } from '@/lib/overview/period'
import { ap } from '@/lib/shared/admin-path'
import { BreakdownBars, fmtDays, withAp } from '../../orders/_components/overview-shared'

export interface ReturnsKpis {
  requests: number
  units: number
  value: number
  rejected: number
  delivered: number
  rate: number | null
  completed: number
  refunded: number
  closeDays: number | null
}

export interface ReturnsData {
  period: Period
  previous: Period
  bucket: Bucket
  kpis: { current: ReturnsKpis; previous: ReturnsKpis }
  snapshot: {
    pendingApproval: number
    awaitingPickup: number
    inTransitBack: number
    pendingInspection: number
    inspectedNotClosed: number
    open: number
  }
  byReason: { reason: string; label: string; count: number; value: number }[]
  byCondition: { condition: string; label: string; count: number }[]
  topProducts: {
    productId: string | null
    name: string
    slug: string | null
    requests: number
    units: number
    value: number
  }[]
  series: { label: string; requests: number }[]
  oldestOpen: {
    id: string
    status: string
    reason: string
    createdAt: string
    orderId: string
    orderNumber: string
    customer: string
  }[]
  attention: AttentionItem[]
}

const SERIES: SeriesDef[] = [
  { key: 'requests', label: 'Return requests', color: 'rgb(239 68 68)', kind: 'bar', axis: 'count', on: true },
]
const CONDITION_COLORS: Record<string, string> = {
  good: 'rgb(16 185 129)',
  defective: 'rgb(234 179 8)',
  damaged: 'rgb(239 68 68)',
}

export const statusLabel = (s: string) => s.replace(/_/g, ' ')

export default function ReturnsOverview() {
  const [period, setPeriod] = usePeriod()
  const { data, error, loading, reload } = useOverviewData<ReturnsData>(
    `/api/admin/returns/overview?from=${period.from}&to=${period.to}`
  )
  return (
    <div className="space-y-4">
      <PeriodBar value={period} onChange={setPeriod} onRefresh={reload} busy={loading} />
      {error && <Banner ok={false}>{error}</Banner>}
      {loading && !data ? <OverviewSkeleton /> : data ? <Body d={data} /> : null}
    </div>
  )
}

function Body({ d }: { d: ReturnsData }) {
  const c = d.kpis.current
  const p = d.kpis.previous
  const s = d.snapshot
  const stages = [
    { label: 'Waiting for approval', value: s.pendingApproval },
    { label: 'Approved, no pickup booked', value: s.awaitingPickup },
    { label: 'Coming back', value: s.inTransitBack },
    { label: 'Received, to inspect', value: s.pendingInspection },
    { label: 'Inspected, to refund', value: s.inspectedNotClosed },
  ]
  const conditionTotal = d.byCondition.reduce((a, r) => a + r.count, 0)

  return (
    <>
      <KpiGrid>
        <Kpi label="Return requests" value={count(c.requests)} delta={delta(c.requests, p.requests)} invert highlight />
        <Kpi
          label="Return rate"
          value={pct(c.rate)}
          delta={delta(c.rate, p.rate)}
          invert
          sub={`Of ${count(c.delivered)} delivered`}
        />
        <Kpi
          label="Value requested"
          value={money(c.value)}
          delta={delta(c.value, p.value)}
          invert
          sub={`${count(c.units)} units`}
        />
        <Kpi
          label="Refunded"
          value={money(c.refunded)}
          delta={delta(c.refunded, p.refunded)}
          invert
          sub={`${count(c.completed)} closed`}
        />
        <Kpi label="Time to close" value={fmtDays(c.closeDays)} delta={delta(c.closeDays, p.closeDays)} invert />
        <Kpi label="Open now" value={count(s.open)} sub={`${count(c.rejected)} rejected in period`} />
      </KpiGrid>

      <div className="grid gap-4 lg:grid-cols-2">
        <AttentionList items={withAp(d.attention)} />
        <Section title="Open returns by stage">
          <ul className="divide-y divide-border-default text-sm">
            {stages.map(st => (
              <li key={st.label} className="flex items-center justify-between py-2">
                <span className="text-foreground">{st.label}</span>
                <span className={`tabular-nums ${st.value ? 'text-foreground font-medium' : 'text-foreground-muted'}`}>
                  {count(st.value)}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      </div>

      <Section title="Return requests over time">
        <TrendChart
          points={d.series}
          series={SERIES}
          bucket={d.bucket}
          height={200}
          ariaLabel="Return requests over the period"
        />
      </Section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="By reason">
          <BreakdownBars rows={d.byReason.map(r => ({ label: r.label, value: r.count, sub: money(r.value) }))} />
        </Section>
        <Section title="Inspected condition">
          {conditionTotal ? (
            <DonutSplit
              segments={d.byCondition.map(r => ({
                label: r.label,
                value: r.count,
                color: CONDITION_COLORS[r.condition] ?? 'rgb(148 163 184)',
              }))}
              centerLabel="inspected"
              centerValue={count(conditionTotal)}
            />
          ) : (
            <p className="text-sm text-foreground-muted py-4 text-center">Nothing inspected in this period.</p>
          )}
        </Section>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Most returned products">
          <Table
            rows={d.topProducts}
            rowKey={r => r.productId ?? r.name}
            empty="No returned products in this period."
            cols={[
              {
                key: 'name',
                label: 'Product',
                render: r =>
                  r.productId ? (
                    <Link href={ap(`/admin/products/${r.productId}/edit`)} className="hover:text-accent-500">
                      {r.name}
                    </Link>
                  ) : (
                    r.name
                  ),
              },
              { key: 'requests', label: 'Requests', num: true, render: r => count(r.requests), sort: r => r.requests },
              { key: 'units', label: 'Units', num: true, render: r => count(r.units), sort: r => r.units },
              { key: 'value', label: 'Value', num: true, render: r => money(r.value), sort: r => r.value },
            ]}
          />
        </Section>
        <OldestOpen rows={d.oldestOpen} />
      </div>
    </>
  )
}

export function OldestOpen({
  rows,
  title = 'Oldest open requests',
}: {
  rows: ReturnsData['oldestOpen']
  title?: string
}) {
  return (
    <Section title={title}>
      <Table
        rows={rows}
        rowKey={r => r.id}
        empty="No open requests."
        pageSize={6}
        cols={[
          {
            key: 'order',
            label: 'Order',
            render: r => (
              <Link href={ap(`/admin/orders/${r.orderId}/view`)} className="hover:text-accent-500">
                {r.orderNumber}
              </Link>
            ),
          },
          { key: 'customer', label: 'Customer', render: r => r.customer || '-' },
          { key: 'reason', label: 'Reason', render: r => r.reason },
          { key: 'status', label: 'Status', render: r => <Badge tone="amber">{statusLabel(r.status)}</Badge> },
          { key: 'created', label: 'Raised', render: r => when(r.createdAt) },
        ]}
      />
    </Section>
  )
}
