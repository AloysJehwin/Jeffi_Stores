'use client'

import Link from 'next/link'
import { AttentionList } from '@/components/admin/overview/kit'
import { Kpi, KpiGrid, Section, Table, Badge, money, count, pct, type Col } from '@/components/admin/channels/ui'
import { TrendChart, DonutSplit, RankedBars, type SeriesDef } from '@/components/admin/dashboard/Charts'
import type { EcomCustomersOverview as Data } from '@controller/lib/overviews/ecom-customers'
import { OverviewShell, Grid2, label, useEcomOverview } from '../../_components/overview-shell'

const SERIES: SeriesDef[] = [
  { key: 'signups', label: 'Signups', color: 'rgb(59 130 246)', kind: 'bar', axis: 'count', on: true },
  { key: 'store_signups', label: 'Store signups', color: 'rgb(16 185 129)', kind: 'line', axis: 'count', on: true },
]

const STATUS_COLOR: Record<string, string> = {
  active: 'rgb(16 185 129)',
  pending_approval: 'rgb(234 179 8)',
  awaiting_payment: 'rgb(224 123 63)',
  provisioning: 'rgb(59 130 246)',
  suspended: 'rgb(239 68 68)',
  terminated: 'rgb(113 113 122)',
  rejected: 'rgb(168 85 247)',
}

type Top = Data['top_stores'][number]
const TOP_COLS: Col<Top>[] = [
  {
    key: 'name',
    label: 'Store',
    render: r => (
      <Link href={`/admin/ecom/customers/${r.id}/view`} className="font-medium text-foreground hover:text-accent-600">
        {r.name}
      </Link>
    ),
  },
  { key: 'plan', label: 'Plan', render: r => <span className="capitalize">{r.plan || '-'}</span> },
  { key: 'orders', label: 'Payments', num: true, render: r => count(r.orders), sort: r => r.orders },
  { key: 'gmv', label: 'GMV', num: true, render: r => money(r.gmv), sort: r => r.gmv },
  {
    key: 'change',
    label: 'vs previous',
    num: true,
    render: r => (r.change == null ? '-' : <Badge tone={r.change >= 0 ? 'green' : 'red'}>{pct(r.change)}</Badge>),
  },
]

export default function EcomCustomersOverview() {
  const o = useEcomOverview<Data>('/api/admin/ecom/customers/overview')
  return (
    <OverviewShell {...o}>
      {d => (
        <>
          <KpiGrid>
            <Kpi
              label="Live stores"
              value={count(d.snapshot.live_stores)}
              sub={`${count(d.snapshot.active)} active of ${count(d.snapshot.total)} tenants`}
              highlight
            />
            <Kpi
              label="New signups"
              value={count(d.current.signups)}
              delta={d.deltas.signups}
              sub={`${count(d.current.store_signups)} for a store`}
            />
            <Kpi
              label="Stores gone live"
              value={count(d.current.store_live)}
              delta={d.deltas.store_live}
              sub="of store signups in the period"
            />
            <Kpi
              label="Signup to live"
              value={pct(d.current.conversion)}
              sub={d.previous.conversion == null ? undefined : `was ${pct(d.previous.conversion)}`}
            />
            <Kpi
              label="Churned stores"
              value={count(d.current.churned)}
              delta={d.deltas.churned}
              invert
              sub="suspended or terminated"
            />
            <Kpi
              label="In the funnel"
              value={count(d.by_status.pending_approval + d.by_status.awaiting_payment + d.by_status.provisioning)}
              sub="approval, payment, provisioning"
            />
          </KpiGrid>

          <AttentionList items={d.attention} />

          <Section title="Signups">
            <TrendChart
              points={d.series.map(s => ({ label: s.bucket, signups: s.signups, store_signups: s.store_signups }))}
              bucket={d.bucket}
              series={SERIES}
              ariaLabel="Tenant signups over time"
            />
          </Section>

          <Grid2>
            <Section title="Tenants by status">
              <div className="flex flex-col sm:flex-row items-center gap-4">
                <DonutSplit
                  segments={Object.entries(d.by_status)
                    .filter(([, n]) => n > 0)
                    .map(([s, n]) => ({ label: label(s), value: n, color: STATUS_COLOR[s] ?? 'rgb(113 113 122)' }))}
                  centerLabel="Tenants"
                  centerValue={count(d.snapshot.total)}
                />
                <ul className="text-sm space-y-1 w-full">
                  {Object.entries(d.by_status).map(([s, n]) => (
                    <li key={s} className="flex justify-between gap-3">
                      <Link
                        href={`/admin/ecom/customers?tab=list&status=${s}`}
                        className="text-foreground-secondary hover:text-accent-600"
                      >
                        {label(s)}
                      </Link>
                      <span className="tabular-nums text-foreground">{count(n)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </Section>
            <Section title="Stores by plan">
              <RankedBars
                items={d.by_plan.map(p => ({
                  name: p.name,
                  value: p.active,
                  sub: `${count(p.total)} total${p.mrr ? `, ${money(p.mrr)} MRR` : ''}`,
                }))}
                unit="active"
              />
              <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
                {(['store', 'both', 'services'] as const).map(k => (
                  <div key={k} className="rounded-lg bg-surface-secondary p-2">
                    <p className="text-lg font-semibold text-foreground tabular-nums">{count(d.by_product[k])}</p>
                    <p className="text-foreground-muted">
                      {k === 'store' ? 'Store only' : k === 'both' ? 'Store + API' : 'API only'}
                    </p>
                  </div>
                ))}
              </div>
            </Section>
          </Grid2>

          <Section title="Top stores by GMV">
            <Table rows={d.top_stores} cols={TOP_COLS} rowKey={r => r.id} empty="No store payments in this period" />
          </Section>
        </>
      )}
    </OverviewShell>
  )
}
