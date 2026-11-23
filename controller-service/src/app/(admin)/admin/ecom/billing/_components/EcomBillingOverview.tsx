'use client'

import Link from 'next/link'
import { AttentionList } from '@/components/admin/overview/kit'
import { Kpi, KpiGrid, Section, Table, Badge, money, count, pct, type Col } from '@/components/admin/channels/ui'
import { TrendChart, RankedBars, type SeriesDef } from '@/components/admin/dashboard/Charts'
import type { EcomBillingOverview as Data } from '@controller/lib/overviews/ecom-billing'
import { LINE_KIND_LABEL } from '@controller/components/admin/ecom/detail/BillingTables'
import { OverviewShell, Grid2, dateIn, useEcomOverview } from '../../_components/overview-shell'
import { BillingOverviewLoading } from '../../_components/skeletons'

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
  {
    key: 'for',
    label: 'For',
    render: r => (r.what ? <span className="break-words">{r.what}</span> : <span className="capitalize">{r.plan ? `${r.plan} plan` : '-'}</span>),
  },
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

type Kind = Data['by_kind'][number]
const KIND_COLS: Col<Kind>[] = [
  { key: 'kind', label: 'Line', render: r => LINE_KIND_LABEL[r.kind] ?? r.kind },
  { key: 'active', label: 'Active', num: true, render: r => count(r.lines.active), sort: r => r.lines.active },
  { key: 'trial', label: 'Trial', num: true, render: r => count(r.lines.trial), sort: r => r.lines.trial },
  { key: 'awaiting', label: 'Not paid yet', num: true, render: r => count(r.lines.awaiting), sort: r => r.lines.awaiting },
  { key: 'legacy', label: 'Wallet (legacy)', num: true, render: r => count(r.lines.legacy), sort: r => r.lines.legacy },
  { key: 'mrr', label: 'MRR', num: true, render: r => money(r.mrr), sort: r => r.mrr },
  { key: 'collected', label: 'Collected', num: true, render: r => money(r.collected), sort: r => r.collected },
  { key: 'change', label: 'vs before', num: true, render: r => pct(r.delta, 0), sort: r => r.delta ?? 0 },
]

const WORKSPACE_STATES = [
  ['active', 'Active', 'green'],
  ['authenticated', 'Authorised', 'blue'],
  ['created', 'Not paid yet', 'amber'],
  ['pending', 'Retrying', 'amber'],
  ['halted', 'Payment failed', 'red'],
  ['cancelled', 'Cancelled', 'muted'],
] as const

const STORE_STATES = [
  ['active', 'Active', 'green'],
  ['authenticated', 'Authorised', 'blue'],
  ['created', 'Not paid yet', 'amber'],
  ['halted', 'Payment failed', 'red'],
  ['cancelled', 'Cancelled', 'muted'],
] as const

export default function EcomBillingOverview() {
  const o = useEcomOverview<Data>('/api/admin/ecom/billing/overview')
  return (
    <OverviewShell {...o} skeleton={<BillingOverviewLoading />}>
      {d => {
        const w = d.current.wallet
        return (
          <>
            <KpiGrid>
              <Kpi label="MRR" value={money(d.snapshot.mrr)} sub={`ARR ${money(d.snapshot.arr)}`} highlight />
              <Kpi
                label="Paying workspaces"
                value={count(d.snapshot.paying)}
                sub={[`${count(d.snapshot.paying_stores)} stores`, d.snapshot.arpa == null ? null : `${money(d.snapshot.arpa)} each`].filter(Boolean).join(' · ')}
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
                sub={`${count(d.current.charges)} charges${d.current.subscription_refunds ? `, ${money(d.current.subscription_refunds)} refunded` : ''}`}
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
                {(() => {
                  const ws = d.workspace_subscriptions
                  const onBilling = WORKSPACE_STATES.some(([k]) => ws[k] > 0)
                  const states = onBilling ? WORKSPACE_STATES : STORE_STATES
                  const counts: Record<string, number> = onBilling ? ws : d.subscriptions
                  return (
                    <>
                      <div className={`grid grid-cols-2 ${onBilling ? 'sm:grid-cols-6' : 'sm:grid-cols-5'} gap-2 text-center text-xs`}>
                        {states.map(([k, l, tone]) => (
                          <div key={k} className={`rounded-lg bg-surface-secondary p-2 ${onBilling ? '' : 'last:col-span-2 sm:last:col-span-1'}`}>
                            <p className="text-lg font-semibold text-foreground tabular-nums">{count(counts[k])}</p>
                            <Badge tone={tone}>{l}</Badge>
                          </div>
                        ))}
                      </div>
                      <p className="text-xs text-foreground-muted mt-3">
                        {onBilling
                          ? `Workspace subscriptions by Razorpay status. ${count(ws.in_grace)} in grace after a failed payment, ${count(ws.replacements)} changes waiting for the owner.`
                          : 'Paid store plans, by Razorpay subscription status.'}{' '}
                        Refunds on store orders this period: {money(d.current.refunds)}.
                      </p>
                    </>
                  )
                })()}
              </Section>
              <Section title="MRR by plan">
                <RankedBars
                  items={d.by_plan.map(p => ({ name: p.name, value: p.mrr, sub: `${count(p.paying)} paying` }))}
                  unit="MRR"
                />
              </Section>
            </Grid2>

            <Section title="Subscription lines">
              <Table rows={d.by_kind} cols={KIND_COLS} rowKey={r => r.kind} empty="No subscription lines" />
              <p className="text-xs text-foreground-muted mt-3">
                MRR from current workspace subscriptions; a paying store not on one yet counts under Store plan. Collected splits each charge over the
                lines it paid for; charges from before the switch count as Store plan.
              </p>
            </Section>

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
