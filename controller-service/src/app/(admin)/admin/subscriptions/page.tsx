import { Suspense } from 'react'
import Link from 'next/link'
import { ap } from '@/lib/shared/admin-path'
import { getHost } from '@/lib/tenancy/get-host'
import AdminFilters from '@/components/admin/AdminFilters'
import Pagination from '@/components/admin/Pagination'
import AdminStatsSkeleton from '@/components/admin/AdminStatsSkeleton'
import AdminTableSkeleton from '@/components/admin/AdminTableSkeleton'
import { getAdminSubscriptionStats, listAdminSubscriptions } from '@/lib/queries/subscriptions'
import { SUBSCRIPTION_STATUS_LABELS } from '@/lib/subscriptions/intervals'
import { SUBSCRIPTION_STATUS_BADGE, fmtDate, inr } from './_status'
import { resolveOverviewTab } from '@/lib/overviews/sales-documents'
import SubscriptionsTabBar from './_components/SubscriptionsTabBar'
import SubscriptionsOverview from './_components/SubscriptionsOverview'

export const dynamic = 'force-dynamic'
export const revalidate = 0

type SP = { [key: string]: string | undefined }

// Params the list reads; a link carrying any of them (without ?tab) opens the list.
const LIST_KEYS = ['status', 'search', 'page'] as const

export default async function SubscriptionsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams
  const tab = resolveOverviewTab(
    new URLSearchParams(Object.entries(sp).filter((e): e is [string, string] => typeof e[1] === 'string')),
    LIST_KEYS
  )
  return (
    <div className="p-4 sm:p-6">
      <div className="mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold text-secondary-500 dark:text-foreground">Subscriptions</h1>
        <p className="text-foreground-secondary mt-1 text-sm">Recurring orders billed through Razorpay mandates</p>
      </div>

      <SubscriptionsTabBar value={tab} />

      {tab === 'overview' ? (
        <Suspense fallback={<AdminStatsSkeleton cards={5} gridClass="grid-cols-2 sm:grid-cols-5" />}>
          <SubscriptionsOverview />
        </Suspense>
      ) : (
        <>
          <Suspense fallback={<AdminStatsSkeleton cards={5} gridClass="grid-cols-2 sm:grid-cols-5" />}>
            <SubscriptionStats />
          </Suspense>

          <AdminFilters
            filters={[
              {
                name: 'status',
                label: 'Status',
                options: Object.entries(SUBSCRIPTION_STATUS_LABELS).map(([value, label]) => ({ value, label })),
              },
            ]}
            searchPlaceholder="Search by customer, email, product or Razorpay ID..."
          />

          <SubscriptionsListSection searchParams={searchParams} />
        </>
      )}
    </div>
  )
}

async function SubscriptionStats() {
  const s = await getAdminSubscriptionStats()
  const cards = [
    { label: 'Active', value: String(s.active), cls: 'text-green-600' },
    { label: 'Paused', value: String(s.paused), cls: 'text-amber-600' },
    { label: 'Payment failed', value: String(s.halted), cls: 'text-red-500' },
    { label: 'Cancelled', value: String(s.cancelled), cls: 'text-secondary-500 dark:text-foreground' },
    { label: 'MRR', value: inr(s.mrr), cls: 'text-purple-600' },
  ]
  return (
    <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 sm:gap-6 mb-6 animate-fade-in">
      {cards.map(c => (
        <div key={c.label} className="bg-surface-elevated p-4 sm:p-6 rounded-lg shadow-sm border border-border-default">
          <p className="text-foreground-secondary text-sm">{c.label}</p>
          <p className={`text-2xl sm:text-3xl font-bold mt-2 ${c.cls}`}>{c.value}</p>
        </div>
      ))}
    </div>
  )
}

async function SubscriptionsListSection({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams
  return (
    <Suspense key={JSON.stringify(sp)} fallback={<AdminTableSkeleton rows={8} cols={7} />}>
      <SubscriptionsListContent sp={sp} />
    </Suspense>
  )
}

async function SubscriptionsListContent({ sp }: { sp: SP }) {
  const host = await getHost()
  const page = Math.max(1, parseInt(sp.page || '1', 10) || 1)
  const { items, total, pageSize } = await listAdminSubscriptions({ status: sp.status, q: sp.search, page })

  const buildUrl = (p: number) => {
    const params = new URLSearchParams({ tab: 'list' })
    if (sp.status) params.set('status', sp.status)
    if (sp.search) params.set('search', sp.search)
    if (p > 1) params.set('page', String(p))
    return ap(`/admin/subscriptions?${params}`, host)
  }

  const th = 'px-4 py-3 text-left text-xs font-semibold text-foreground-secondary uppercase tracking-wider'
  return (
    <>
      <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default overflow-hidden mt-4">
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-secondary">
              <tr>
                <th className={th}>Customer</th>
                <th className={th}>Product</th>
                <th className={th}>Plan</th>
                <th className={th}>Per cycle</th>
                <th className={th}>Cycle</th>
                <th className={th}>Next charge</th>
                <th className={th}>Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-default">
              {items.map(s => (
                <tr key={s.id} className="hover:bg-surface-secondary/50">
                  <td className="px-4 py-3">
                    <Link
                      href={ap(`/admin/subscriptions/${s.id}/view`, host)}
                      className="font-medium text-accent-600 hover:underline"
                    >
                      {s.customerName}
                    </Link>
                    {s.customerEmail && <p className="text-xs text-foreground-muted">{s.customerEmail}</p>}
                  </td>
                  <td className="px-4 py-3">
                    {s.productName}
                    {s.isDigital && <span className="ml-2 text-xs text-purple-600">Digital</span>}
                  </td>
                  <td className="px-4 py-3">
                    {s.intervalLabel}
                    {s.quantity > 1 && <span className="text-foreground-muted"> × {s.quantity}</span>}
                  </td>
                  <td className="px-4 py-3">{inr(s.amount)}</td>
                  <td className="px-4 py-3">
                    {s.currentCycle}
                    {s.totalCycles ? ` of ${s.totalCycles}` : ''}
                  </td>
                  <td className="px-4 py-3">
                    {s.status === 'active' && !s.cancelAtCycleEnd ? fmtDate(s.currentEnd) : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`px-2 py-0.5 rounded-full text-xs font-medium ${SUBSCRIPTION_STATUS_BADGE[s.status] ?? ''}`}
                    >
                      {s.statusLabel}
                    </span>
                    {s.cancelAtCycleEnd && s.status === 'active' && (
                      <p className="text-xs text-foreground-muted mt-1">Ends {fmtDate(s.currentEnd)}</p>
                    )}
                  </td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-foreground-muted">
                    No subscriptions found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="md:hidden divide-y divide-border-default">
          {items.map(s => (
            <Link key={s.id} href={ap(`/admin/subscriptions/${s.id}/view`, host)} className="block p-4">
              <div className="flex justify-between gap-2">
                <p className="font-medium">{s.customerName}</p>
                <span
                  className={`px-2 py-0.5 rounded-full text-xs font-medium ${SUBSCRIPTION_STATUS_BADGE[s.status] ?? ''}`}
                >
                  {s.statusLabel}
                </span>
              </div>
              <p className="text-sm text-foreground-secondary">{s.productName}</p>
              <p className="text-xs text-foreground-muted mt-1">
                {s.intervalLabel} · {inr(s.amount)} · cycle {s.currentCycle}
                {s.totalCycles ? ` of ${s.totalCycles}` : ''}
              </p>
            </Link>
          ))}
          {items.length === 0 && (
            <p className="p-4 text-center text-foreground-muted text-sm">No subscriptions found</p>
          )}
        </div>
      </div>

      <Pagination page={page} total={total} pageSize={pageSize} buildUrl={buildUrl} />
    </>
  )
}
