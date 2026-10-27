'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { ap } from '@/lib/shared/admin-path'
import { DataTable, StatusBadge, type DataCol } from '@/components/admin/kit'
import { SUBSCRIPTION_STATUS, fmtDate, inr } from '../_status'
import type { AdminSubscriptionListItem as SubscriptionRow } from '@/lib/queries/subscriptions'

function Status({ s }: { s: SubscriptionRow }) {
  return (
    <>
      <StatusBadge status={s.status} map={SUBSCRIPTION_STATUS} label={s.statusLabel} />
      {s.cancelAtCycleEnd && s.status === 'active' && <p className="mt-1 text-xs text-foreground-muted">Ends {fmtDate(s.currentEnd)}</p>}
    </>
  )
}

export default function SubscriptionsTable({
  items,
  total,
  page,
  pageSize,
  status,
  search,
}: {
  items: SubscriptionRow[]
  total: number
  page: number
  pageSize: number
  status?: string
  search?: string
}) {
  const href = (s: SubscriptionRow) => ap(`/admin/subscriptions/${s.id}/view`)
  // Clone every param so advancing page keeps tab/filters; otherwise the parent Suspense re-keys.
  const sp = useSearchParams()
  const pageHref = (p: number) => {
    const params = new URLSearchParams(sp.toString())
    if (p > 1) params.set('page', String(p))
    else params.delete('page')
    const qs = params.toString()
    return ap(`/admin/subscriptions${qs ? `?${qs}` : ''}`)
  }

  const cols: DataCol<SubscriptionRow>[] = [
    {
      key: 'customer',
      label: 'Customer',
      sortParam: 'customer',
      render: s => (
        <>
          <Link href={href(s)} className="font-medium text-accent-500 hover:underline">
            {s.customerName}
          </Link>
          {s.customerEmail && <p className="text-xs text-foreground-muted">{s.customerEmail}</p>}
        </>
      ),
    },
    {
      key: 'product',
      label: 'Product',
      sortParam: 'product',
      render: s => (
        <>
          {s.productName}
          {s.isDigital && <span className="ml-2 text-xs text-foreground-muted">Digital</span>}
        </>
      ),
    },
    {
      key: 'plan',
      label: 'Plan',
      sortParam: 'plan',
      hideBelow: 'lg',
      render: s => (
        <>
          {s.intervalLabel}
          {s.quantity > 1 && <span className="text-foreground-muted"> × {s.quantity}</span>}
        </>
      ),
    },
    { key: 'amount', label: 'Per cycle', num: true, sortParam: 'amount', render: s => inr(s.amount) },
    { key: 'cycle', label: 'Cycle', sortParam: 'cycle', sortType: 'number', hideBelow: 'lg', render: s => `${s.currentCycle}${s.totalCycles ? ` of ${s.totalCycles}` : ''}` },
    { key: 'next', label: 'Next charge', sortParam: 'next', sortType: 'date', hideBelow: 'xl', render: s => (s.status === 'active' && !s.cancelAtCycleEnd ? fmtDate(s.currentEnd) : '—') },
    { key: 'status', label: 'Status', sortParam: 'status', render: s => <Status s={s} /> },
  ]

  return (
    <DataTable<SubscriptionRow>
      mode="server"
      rows={items}
      cols={cols}
      rowKey={s => s.id}
      total={total}
      page={page}
      pageSize={pageSize}
      pageHref={pageHref}
      empty="No subscriptions found"
      mobileCard={s => (
        <Link href={href(s)} className="block rounded-xl border border-border-default bg-surface-elevated p-4">
          <div className="flex justify-between gap-2">
            <p className="font-medium text-foreground">{s.customerName}</p>
            <Status s={s} />
          </div>
          <p className="text-sm text-foreground-secondary">{s.productName}</p>
          <p className="mt-1 text-xs text-foreground-muted">
            {s.intervalLabel} · {inr(s.amount)} · cycle {s.currentCycle}
            {s.totalCycles ? ` of ${s.totalCycles}` : ''}
          </p>
        </Link>
      )}
    />
  )
}
