'use client'

import Link from 'next/link'
import { AttentionList } from '@/components/admin/overview/kit'
import { Kpi, KpiGrid, Section, Table, Badge, money, count, pct, type Col } from '@/components/admin/channels/ui'
import { TrendChart, RankedBars, type SeriesDef } from '@/components/admin/dashboard/Charts'
import type { EcomBillingOverview as Data } from '@controller/lib/overviews/ecom-billing'
import { OverviewShell, Grid2, dateIn, useEcomOverview } from '../../_components/overview-shell'

const SERIES: SeriesDef[] = [
  { key: 'gmv', label: 'Store GMV', color: 'rgb(16 185 129)', kind: 'area', axis: 'money', on: true },
  { key: 'commission', label: 'Commission', color: 'rgb(59 130 246)', kind: 'line', axis: 'money', on: true },
  {
    key: 'subscriptions',
    label: 'Subscriptions collected',
    color: 'rgb(168 85 247)',
    kind: 'bar',
    axis: 'money',
    on: true,
  },
  { key: 'wallet_usage', label: 'Wallet usage', color: 'rgb(224 123 63)', kind: 'line', axis: 'money' },
]

type Renewal = Data['renewals_7d'][number]
const RENEWAL_COLS: Col<Renewal>[] = [
  {
    key: 'name',
    label: 'Store',
    render: r => (
      <Link href={`/admin/ecom/billing/${r.id}/view`} className="font-medium text-foreground hover:text-accent-600">
        {r.name}
      </Link>
    ),
  },
  { key: 'plan', label: 'Plan', render: r => <span className="capitalize">{r.plan}</span> },
  { key: 'interval', label: 'Billing', render: r => <span className="capitalize">{r.interval}</span> },
  { key: 'due', label: 'Due', render: r => dateIn(r.due), sort: r => r.due },
  { key: 'amount', label: 'Amount', num: true, render: r => money(r.amount), sort: r => r.amount },
]

type Plan = Data['by_plan'][number]
const PLAN_COLS: Col<Plan>[] = [
  { key: 'name', label: 'Plan', render: r => r.name },
  { key: 'price', label: 'Price / month', num: true, render: r => money(r.price) },
  { key: 'paying', label: 'Paying', num: true, render: r => count(r.paying), sort: r => r.paying },
  { key: 'mrr', label: 'MRR', num: true, render: r => money(r.mrr), sort: r => r.mrr },
  { key: 'arr', label: 'ARR', num: true, render: r => money(r.arr), sort: r => r.arr },
]

export default function EcomBillingOverview() {
  const o = useEcomOverview<Data>('/api/admin/ecom/billing/overview')
  return (
    <OverviewShell {...o}>
      {d => {
        const w = d.current.wallet
        return (
          <>
            <KpiGrid>
              <Kpi label="MRR" value={money(d.snapshot.mrr)} sub={`ARR ${money(d.snapshot.arr)}`} highlight />
              <Kpi
                label="Paying stores"
                value={count(d.snapshot.paying)}
                sub={d.snapshot.arpa == null ? undefined : `${money(d.snapshot.arpa)} per store`}
              />
              <Kpi label="New MRR" value={money(d.current.new_mrr)} delta={d.deltas.new_mrr} />
              <Kpi
                label="Churned MRR"
                value={money(d.current.churned_mrr)}
                delta={d.deltas.churned_mrr}
                invert
                sub={`${count(d.current.churned_stores)} stores`}
              />
              <Kpi
                label="Net new MRR"
                value={money(d.current.net_new_mrr)}
                sub={`was ${money(d.previous.net_new_mrr)}`}
              />
              <Kpi label="MRR churn" value={pct(d.snapshot.mrr_churn_rate)} sub="of MRR at the start" />
              <Kpi
                label="Subscriptions collected"
                value={money(d.current.collected)}
                delta={d.deltas.collected}
                sub={`${count(d.current.charges)} charges`}
              />
              <Kpi
                label="Store GMV"
                value={money(d.current.gmv)}
                delta={d.deltas.gmv}
                sub={`${count(d.current.orders)} payments`}
              />
              <Kpi
                label="Commission"
                value={money(d.current.commission)}
                delta={d.deltas.commission}
                sub={`fees ${money(d.current.gateway_fees)}`}
              />
              <Kpi
                label="Wallet top-ups"
                value={money(w.topups)}
                delta={d.deltas.topups}
                sub={`${count(w.topup_count)} top-ups`}
              />
              <Kpi
                label="Messaging revenue"
                value={money(w.messaging, 2)}
                delta={d.deltas.messaging}
                sub="SMS, WhatsApp, email"
              />
              <Kpi label="Documents revenue" value={money(w.documents, 2)} sub={`shipping ${money(w.shipping, 2)}`} />
              <Kpi
                label="Servers revenue"
                value={money(w.infra, 2)}
                delta={d.deltas.infra}
                sub={`AWS est. ${money(w.infra_cost, 2)}, margin ${money(w.infra_margin, 2)}`}
              />
            </KpiGrid>

            <AttentionList items={d.attention} />

            <Section title="Revenue over time">
              <TrendChart
                points={d.series.map(s => ({
                  label: s.bucket,
                  gmv: s.gmv,
                  commission: s.commission,
                  subscriptions: s.subscriptions,
                  wallet_usage: s.wallet_usage,
                }))}
                bucket={d.bucket}
                series={SERIES}
                ariaLabel="Platform revenue over time"
              />
            </Section>

            <Grid2>
              <Section title="Subscriptions">
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-center text-xs">
                  {(
                    [
                      ['active', 'Active', 'green'],
                      ['authenticated', 'Authorised', 'blue'],
                      ['created', 'Not paid yet', 'amber'],
                      ['halted', 'Payment failed', 'red'],
                      ['cancelled', 'Cancelled', 'muted'],
                    ] as const
                  ).map(([k, l, tone]) => (
                    <div key={k} className="rounded-lg bg-surface-secondary p-2 last:col-span-2 sm:last:col-span-1">
                      <p className="text-lg font-semibold text-foreground tabular-nums">{count(d.subscriptions[k])}</p>
                      <Badge tone={tone}>{l}</Badge>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-foreground-muted mt-3">
                  Paid store plans, by Razorpay subscription status. Refunds on store orders this period:{' '}
                  {money(d.current.refunds)}.
                </p>
              </Section>
              <Section title="MRR by plan">
                <RankedBars
                  items={d.by_plan.map(p => ({ name: p.name, value: p.mrr, sub: `${count(p.paying)} paying` }))}
                  unit="MRR"
                />
              </Section>
            </Grid2>

            <Section title="Plans">
              <Table rows={d.by_plan} cols={PLAN_COLS} rowKey={r => r.plan} empty="No paying stores" />
            </Section>

            <Section title="Renewals in the next 7 days">
              <Table
                rows={d.renewals_7d}
                cols={RENEWAL_COLS}
                rowKey={r => r.id}
                empty="No renewals due in the next 7 days"
              />
            </Section>
          </>
        )
      }}
    </OverviewShell>
  )
}
