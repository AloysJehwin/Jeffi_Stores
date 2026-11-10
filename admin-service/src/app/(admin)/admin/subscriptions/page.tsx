import { Suspense } from 'react'
import { filterScope, normalizeQuery, type FilterQuery } from '@jeffi/list-filters'
import { listKey } from '@/lib/admin/list-key'
import { isListUrl } from '@/lib/admin/filter-url'
import { Kpi, KpiGrid, ListFilters, PageBody, PageHeader } from '@/components/admin/kit'
import { LoadingKpis, LoadingTable } from '@/components/admin/kit/skeleton'
import { getAdminSubscriptionStats, queryAdminSubscriptions } from '@/lib/queries/subscriptions'
import { SUBSCRIPTIONS_ENTITY } from '@/lib/filters/entities/subscriptions'
import { SUBSCRIPTION_FIELDS, SUBSCRIPTION_SEARCH } from '@/lib/filters/fields/subscriptions'
import { inr } from './_status'
import SubscriptionsTable from './_components/SubscriptionsTable'
import SubscriptionsTabBar from './_components/SubscriptionsTabBar'
import SubscriptionsOverview from './_components/SubscriptionsOverview'
import SubscriptionsOverviewSkeleton from './_components/SubscriptionsOverviewSkeleton'

export const dynamic = 'force-dynamic'
export const revalidate = 0

type SP = { [key: string]: string | undefined }

export default async function SubscriptionsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams
  // A link carrying any list param (without ?tab) opens the list.
  const tab = isListUrl(sp, SUBSCRIPTION_FIELDS) ? 'list' : 'overview'
  const q = normalizeQuery(SUBSCRIPTIONS_ENTITY, sp)
  return (
    <PageBody>
      <PageHeader title="Subscriptions" description="Recurring orders billed through Razorpay mandates" />

      <SubscriptionsTabBar value={tab} />

      {tab === 'overview' ? (
        <Suspense fallback={<SubscriptionsOverviewSkeleton />}>
          <SubscriptionsOverview />
        </Suspense>
      ) : (
        <>
          <Suspense
            key={JSON.stringify(q)}
            fallback={<LoadingKpis labels={['Active', 'Paused', 'Payment failed', 'Cancelled', 'MRR']} />}
          >
            <SubscriptionStats q={q} />
          </Suspense>

          <ListFilters
            entity="subscriptions"
            fields={SUBSCRIPTION_FIELDS}
            search={SUBSCRIPTION_SEARCH}
            noun="Subscriptions"
            tab="list"
            exportable
          />

          <SubscriptionsListSection sp={sp} />
        </>
      )}
    </PageBody>
  )
}

/** KPIs over every subscription the filters match. */
async function SubscriptionStats({ q }: { q: FilterQuery }) {
  const s = await getAdminSubscriptionStats(filterScope(SUBSCRIPTIONS_ENTITY, q).and(1))
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

function SubscriptionsListSection({ sp }: { sp: SP }) {
  return (
    <Suspense key={listKey(sp)} fallback={<LoadingTable columns={['Customer', 'Product', 'Plan', 'Per cycle', 'Cycle', 'Next charge', 'Status']} />}>
      <SubscriptionsListContent sp={sp} />
    </Suspense>
  )
}

async function SubscriptionsListContent({ sp }: { sp: SP }) {
  const page = Math.max(1, parseInt(sp.page || '1', 10) || 1)
  const { items, total, pageSize } = await queryAdminSubscriptions(normalizeQuery(SUBSCRIPTIONS_ENTITY, sp), page, { get: k => sp[k] ?? null })
  return (
    <SubscriptionsTable
      items={items}
      total={total}
      page={page}
      pageSize={pageSize}
      status={sp.status}
      search={sp.search}
    />
  )
}
