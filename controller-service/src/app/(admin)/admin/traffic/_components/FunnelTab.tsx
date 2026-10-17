'use client'

import { Empty, Kpi, KpiGrid, Section, Table, count, money, pct, when, type Col } from '@/components/admin/channels/ui'
import type { FunnelBreakdownRow, FunnelData } from '@/lib/traffic/types'
import { ap } from '@/lib/shared/admin-path'
import { Note, PointChange, rateText, ratio } from './shared'

const COLORS = ['#3b82f6', '#a855f7', '#f59e0b', '#f97316', '#22c55e', '#16a34a']

type Abandoned = FunnelData['abandoned']['rows'][number]

export default function FunnelTab({ data }: { data: FunnelData }) {
  const first = data.steps[0]
  if (!first || first.count === 0) return <Empty msg="No tracked sessions in this period yet, so there is no funnel to show." />
  const placed = data.steps.find(s => s.key === 'placed')
  const paid = data.steps.find(s => s.key === 'paid')

  const bdCols = (label: string): Col<FunnelBreakdownRow>[] => [
    { key: 'key', label, render: r => r.key, sort: r => r.key },
    { key: 'sessions', label: 'Sessions', num: true, sort: r => r.sessions, render: r => count(r.sessions) },
    { key: 'product', label: 'Product', num: true, sort: r => r.product, render: r => rateText(r.product, r.sessions, 0) },
    { key: 'cart', label: 'Cart', num: true, sort: r => r.cart, render: r => rateText(r.cart, r.sessions, 0) },
    { key: 'checkout', label: 'Checkout', num: true, sort: r => r.checkout, render: r => rateText(r.checkout, r.sessions, 0) },
    { key: 'placed', label: 'Ordered', num: true, sort: r => ratio(r.placed, r.sessions) ?? -1, render: r => rateText(r.placed, r.sessions, 2) },
    { key: 'paid', label: 'Paid', num: true, sort: r => ratio(r.paid, r.sessions) ?? -1, render: r => rateText(r.paid, r.sessions, 2) },
  ]
  const cartCols: Col<Abandoned>[] = [
    {
      key: 'who',
      label: 'Customer',
      render: r => (
        <a href={ap(`/admin/customers/${r.userId}`)} className="hover:text-accent-600">
          {r.name || r.email || r.userId.slice(0, 8)}
          {r.name && r.email ? <span className="block text-xs text-foreground-muted">{r.email}</span> : null}
        </a>
      ),
    },
    { key: 'items', label: 'Items', num: true, sort: r => r.items, render: r => count(r.items) },
    { key: 'value', label: 'Value', num: true, sort: r => r.value, render: r => money(r.value) },
    { key: 'last', label: 'Last added', sort: r => r.lastAdded, render: r => when(r.lastAdded) },
  ]

  return (
    <div className="space-y-5">
      <KpiGrid>
        <Kpi label="Sessions" value={count(first.count)} />
        <Kpi label="Ordered" value={pct(placed?.overallRate, 2)} sub={`${count(placed?.count)} sessions`} highlight />
        <Kpi label="Paid" value={pct(paid?.overallRate, 2)} sub={`${count(paid?.count)} sessions`} />
        <Kpi label="Payments started" value={count(data.paymentIntents.started)} sub={`${count(data.paymentIntents.committed)} completed online`} />
        <Kpi label="Abandoned carts" value={count(data.abandoned.carts)} sub={`${count(data.abandoned.items)} items`} />
        <Kpi label="Abandoned value" value={money(data.abandoned.value)} />
      </KpiGrid>

      <Section title="Funnel">
        <div className="space-y-1">
          {data.steps.map((s, i) => (
            <div key={s.key}>
              {i > 0 && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-1.5 pl-5 text-xs">
                  {s.dropOff > 0 ? (
                    <span className="text-red-500 font-medium">
                      {count(s.dropOff)} dropped ({pct(s.stepRate == null ? null : 1 - s.stepRate, 0)})
                    </span>
                  ) : (
                    <span className="text-green-600 dark:text-green-400 font-medium">No drop</span>
                  )}
                  <span className="text-foreground-muted">
                    step {pct(s.stepRate, 1)} · before {pct(s.prevStepRate, 1)}
                  </span>
                  <PointChange cur={s.stepRate} prev={s.prevStepRate} />
                </div>
              )}
              <div className="rounded-lg border border-border-default overflow-hidden">
                <div className="flex flex-wrap items-center gap-3 px-4 py-3 bg-surface-secondary/50">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: COLORS[i] }} />
                  <span className="text-sm font-semibold text-foreground flex-1 min-w-[140px]">{s.label}</span>
                  <span className="text-sm text-foreground-secondary tabular-nums">{count(s.count)}</span>
                  <span className="text-xs text-foreground-muted tabular-nums">before {count(s.prevCount)}</span>
                  <span className="font-bold text-foreground w-16 text-right tabular-nums">{pct(s.overallRate, 1)}</span>
                </div>
                <div className="px-4 py-2">
                  <div className="h-2.5 bg-surface-secondary rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${(s.overallRate ?? 0) * 100}%`, backgroundColor: COLORS[i] }} />
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-3">
          <Note>
            A step counts sessions that reached it or any later step (Buy now goes straight to checkout). Ordered means
            the shopper reached the order confirmation page; paid means the order is paid or its COD was collected.
            &quot;Before&quot; is the previous period of the same length.
          </Note>
        </div>
      </Section>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <Section title="By device">
          <Table rows={data.byDevice} cols={bdCols('Device')} rowKey={r => r.key} empty="No sessions" />
        </Section>
        <Section title="By channel">
          <Table rows={data.byChannel} cols={bdCols('Channel')} rowKey={r => r.key} empty="No sessions" />
        </Section>
      </div>

      <Section title="Abandoned carts">
        <Table rows={data.abandoned.rows} cols={cartCols} rowKey={r => r.userId} empty="No abandoned carts in this period" />
        <div className="mt-2">
          <Note>
            Shoppers with a saved cart who added items in the period (not saved for later), left them for over an hour
            and have not ordered since.
          </Note>
        </div>
      </Section>
    </div>
  )
}
