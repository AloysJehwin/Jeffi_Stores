import { Suspense } from 'react'
import { listKey } from '@/lib/admin/list-key'
import AdminStatsSkeleton from '@/components/admin/AdminStatsSkeleton'
import { DataToolbar, Kpi, KpiGrid, PageBody, PageHeader, TableSkeleton } from '@/components/admin/kit'
import { getAdminSubscriptionStats, listAdminSubscriptions } from '@/lib/queries/subscriptions'
import { SUBSCRIPTION_STATUS_LABELS } from '@/lib/subscriptions/intervals'
import { inr } from './_status'
import SubscriptionsTable from './_components/SubscriptionsTable'
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
    <PageBody>
      <PageHeader title="Subscriptions" description="Recurring orders billed through Razorpay mandates" />

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

          <DataToolbar
            search={{ placeholder: 'Search by customer, email, product or Razorpay ID...', param: 'search' }}
            filters={[
              {
                name: 'status',
                label: 'Status',
                options: Object.entries(SUBSCRIPTION_STATUS_LABELS).map(([value, label]) => ({ value, label })),
              },
            ]}
          />

          <SubscriptionsListSection searchParams={searchParams} />
        </>
      )}
    </PageBody>
  )
}

async function SubscriptionStats() {
  const s = await getAdminSubscriptionStats()
  return (
    <div className="animate-fade-in">
      <KpiGrid>
        <Kpi label="Active" value={String(s.active)} highlight />
        <Kpi label="Paused" value={String(s.paused)} />
        <Kpi label="Payment failed" value={String(s.halted)} />
        <Kpi label="Cancelled" value={String(s.cancelled)} />
        <Kpi label="MRR" value={inr(s.mrr)} />
      </KpiGrid>
    </div>
  )
}

async function SubscriptionsListSection({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams
  return (
    <Suspense key={listKey(sp)} fallback={<TableSkeleton rows={8} cols={7} />}>
      <SubscriptionsListContent sp={sp} />
    </Suspense>
  )
}

async function SubscriptionsListContent({ sp }: { sp: SP }) {
  const page = Math.max(1, parseInt(sp.page || '1', 10) || 1)
  const { items, total, pageSize } = await listAdminSubscriptions({ status: sp.status, q: sp.search, page })
  return <SubscriptionsTable items={items} total={total} page={page} pageSize={pageSize} status={sp.status} search={sp.search} />
}
