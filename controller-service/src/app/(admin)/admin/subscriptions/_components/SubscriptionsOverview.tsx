'use client'

import Link from 'next/link'
import { AttentionList, OverviewSkeleton, PeriodBar, useOverviewData, usePeriod } from '@/components/admin/overview/kit'
import { Badge, Kpi, KpiGrid, Section, Table, count, money, pct, when } from '@/components/admin/channels/ui'
import { RankedBars, TrendChart, type SeriesDef } from '@/components/admin/dashboard/Charts'
import { delta } from '@/lib/overview/period'
import { ap } from '@/lib/shared/admin-path'
import type { SubscriptionOverview } from '@/lib/overviews/subscriptions'

const SERIES: SeriesDef[] = [
  { key: 'billed', label: 'Billed', color: 'rgb(16 185 129)', kind: 'area', axis: 'money' },
  { key: 'newSubs', label: 'New', color: 'rgb(59 130 246)', kind: 'bar', axis: 'count' },
  { key: 'cancelled', label: 'Cancelled', color: 'rgb(239 68 68)', kind: 'line', axis: 'count' },
]

export default function SubscriptionsOverview() {
  const [period, setPeriod] = usePeriod()
  const { data, error, loading, reload } = useOverviewData<SubscriptionOverview>(
    `/api/admin/subscriptions/overview?from=${period.from}&to=${period.to}`
  )

  return (
    <div className="space-y-5">
      <PeriodBar value={period} onChange={setPeriod} onRefresh={reload} busy={loading} />
      {error && <p className="text-sm text-red-500">{error}</p>}
      {!data ? loading && <OverviewSkeleton /> : <Body d={data} />}
    </div>
  )
}

function Body({ d }: { d: SubscriptionOverview }) {
  const s = d.snapshot
  const c = d.kpis.current
  const p = d.kpis.previous
  const subLink = (r: { href: string; customer: string }) => (
    <Link href={ap(r.href)} className="text-accent-500 hover:underline">
      {r.customer}
    </Link>
  )
  return (
    <>
      <KpiGrid>
        <Kpi label="Active" value={count(s.active)} sub={`${count(s.paused)} paused`} highlight />
        <Kpi label="MRR" value={money(s.mrr)} sub={`ARR ${money(s.arr)}`} />
        <Kpi label="New" value={count(c.newSubs)} delta={delta(c.newSubs, p.newSubs)} sub={`+${money(c.newMrr)} MRR`} />
        <Kpi
          label="Cancelled"
          value={count(c.cancelled)}
          delta={delta(c.cancelled, p.cancelled)}
          invert
          sub={`-${money(c.churnedMrr)} MRR`}
        />
        <Kpi
          label="Churn"
          value={pct(c.churnRate)}
          delta={delta(c.churnRate, p.churnRate)}
          invert
          sub={`of ${count(c.base)} at period start`}
        />
        <Kpi label="Net new" value={`${c.netNew > 0 ? '+' : ''}${count(c.netNew)}`} delta={delta(c.netNew, p.netNew)} />
        <Kpi
          label="Billed"
          value={money(c.billed)}
          delta={delta(c.billed, p.billed)}
          sub={`${count(c.charges)} charges, ${count(c.renewals)} renewals`}
        />
        <Kpi label="Renewals due (7 days)" value={count(s.due)} sub={money(s.dueAmount)} />
        <Kpi
          label="Failed renewals"
          value={count(s.halted + s.retrying)}
          sub={`${count(s.halted)} halted, ${count(s.retrying)} retrying`}
        />
        <Kpi label="Ending at cycle end" value={count(s.ending)} />
      </KpiGrid>
      <p className="text-[11px] text-foreground-muted -mt-2">
        Active, MRR and failed renewals are as of now; MRR normalises weekly, quarterly and yearly plans to a month.
        Churn is cancellations in the period over subscriptions live at its start.
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <AttentionList items={d.attention.map(a => ({ ...a, href: a.href && ap(a.href) }))} />
        <Section title="Failed renewals">
          <Table
            rows={d.failing}
            rowKey={r => r.id}
            empty="No failed renewals"
            cols={[
              { key: 'customer', label: 'Customer', render: subLink },
              { key: 'product', label: 'Product', render: r => r.product },
              {
                key: 'status',
                label: 'Status',
                render: r => (
                  <Badge tone={r.status === 'halted' ? 'red' : 'amber'}>
                    {r.status === 'halted' ? 'Halted' : 'Retrying'}
                  </Badge>
                ),
              },
              { key: 'amount', label: 'Per cycle', num: true, render: r => money(r.amount, 2) },
            ]}
          />
        </Section>
      </div>

      <Section title="Subscriptions over time">
        <TrendChart
          points={d.series}
          bucket={d.bucket}
          series={SERIES}
          ariaLabel="New and cancelled subscriptions and billing over time"
        />
      </Section>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <Section title="Renewals due in 7 days">
          <Table
            rows={d.dueSoon}
            rowKey={r => r.id}
            empty="No renewals due this week"
            cols={[
              { key: 'customer', label: 'Customer', render: subLink },
              { key: 'due', label: 'Due', render: r => when(r.dueAt as string | null) },
              { key: 'amount', label: 'Amount', num: true, render: r => money(r.amount, 2) },
            ]}
          />
        </Section>
        <Section title="MRR by product">
          <RankedBars
            items={d.byProduct.map(r => ({ name: r.name, value: r.mrr, sub: `${money(r.mrr)} (${count(r.active)})` }))}
          />
        </Section>
        <Section title="By plan">
          <RankedBars
            items={d.byInterval.map(r => ({
              name: r.label,
              value: r.mrr,
              sub: `${money(r.mrr)} (${count(r.active)})`,
            }))}
            barClass="bg-blue-500"
          />
        </Section>
      </div>
    </>
  )
}
