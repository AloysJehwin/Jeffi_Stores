import { Suspense } from 'react'
import { listKey } from '@/lib/admin/list-key'
import { getCustomers, getCustomerStats, getCustomerSegments, getCustomerChannelMix } from '@/lib/queries'
import CustomersTable from './_components/CustomersTable'
import { ap } from '@/lib/shared/admin-path'
import { getHost } from '@/lib/tenancy/get-host'
import { DataToolbar, Kpi, KpiGrid, PageBody, PageHeader, TableSkeleton } from '@/components/admin/kit'
import CustomerEngagementChart from '@/components/admin/CustomerEngagementChart'
import CustomersOverview from './_components/CustomersOverview'
import OverviewTabs from '../coupons/_components/OverviewTabs'
import { resolveListTab } from '@/lib/overviews/marketing'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const PAGE_SIZE = 25

type SP = { [key: string]: string | undefined }

async function CustomersStats() {
  const [stats, segments, channelMix] = await Promise.all([
    getCustomerStats(),
    getCustomerSegments(),
    getCustomerChannelMix(),
  ])

  return (
    <div className="animate-fade-in space-y-4">
      <KpiGrid>
        <Kpi label="Total customers" value={stats.total.toLocaleString('en-IN')} highlight />
        <Kpi label="Active" value={stats.active.toLocaleString('en-IN')} />
        <Kpi label="Inactive" value={stats.inactive.toLocaleString('en-IN')} />
        <Kpi label="Flagged" value={stats.flagged.toLocaleString('en-IN')} />
      </KpiGrid>
      <CustomerEngagementChart segments={segments} channelMix={channelMix} />
    </div>
  )
}

const LIST_KEYS = ['status', 'segment', 'health', 'tag', 'search', 'page', 'sort', 'dir'] as const

export default async function CustomersPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams
  const tab = resolveListTab(sp, LIST_KEYS)
  const host = await getHost()
  return (
    <PageBody>
      <PageHeader title="Customers" description="View and manage customer accounts" />

      <OverviewTabs basePath={ap('/admin/customers', host)} active={tab} sp={sp} listLabel="Customers" />

      {tab === 'overview' ? (
        <Suspense fallback={null}>
          <CustomersOverview />
        </Suspense>
      ) : (
        <>
          <Suspense fallback={<KpiRowSkeleton />}>
            <CustomersStats />
          </Suspense>

          <DataToolbar
            search={{ placeholder: 'Search by name, email or phone...', param: 'search', suggestType: 'customers' }}
            filters={[
              {
                name: 'status',
                label: 'Status',
                options: [
                  { value: 'active', label: 'Active' },
                  { value: 'inactive', label: 'Inactive' },
                  { value: 'flagged', label: 'Flagged' },
                ],
              },
              {
                name: 'segment',
                label: 'Segment',
                options: [
                  { value: 'vip', label: 'VIP (₹50k+)' },
                  { value: 'loyal', label: 'Loyal' },
                  { value: 'repeat', label: 'Repeat (3+)' },
                  { value: 'one_time', label: 'One-time' },
                  { value: 'new', label: 'New (<30d)' },
                  { value: 'at_risk', label: 'At Risk (90-180d)' },
                  { value: 'dormant', label: 'Dormant (180d+)' },
                  { value: 'b2b', label: 'B2B' },
                  { value: 'lead', label: 'Lead (no orders)' },
                ],
              },
              {
                name: 'health',
                label: 'Health',
                options: [
                  { value: 'healthy', label: 'Healthy (≥70)' },
                  { value: 'at_risk', label: 'At Risk (40-69)' },
                  { value: 'critical', label: 'Critical (<40)' },
                  { value: 'unknown', label: 'Not scored' },
                ],
              },
            ]}
          />

          <CustomersListSection searchParams={searchParams} />
        </>
      )}
    </PageBody>
  )
}

function KpiRowSkeleton() {
  return (
    <div className="grid gap-3 grid-cols-2 sm:grid-cols-[repeat(auto-fit,minmax(150px,1fr))] animate-pulse">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="h-[84px] rounded-xl border border-border-default bg-surface-elevated" />
      ))}
    </div>
  )
}

// Resolves searchParams (no DB — near-instant) then keys the table Suspense
// on the query string so filter/pagination changes re-trigger the shimmer
// while the stats + filters above stay mounted.
async function CustomersListSection({ searchParams }: { searchParams: Promise<SP> }) {
  const resolvedSearchParams = await searchParams
  const key = listKey(resolvedSearchParams)
  return (
    <Suspense key={key} fallback={<TableSkeleton rows={8} cols={7} />}>
      <CustomersListContent resolvedSearchParams={resolvedSearchParams} />
    </Suspense>
  )
}

async function CustomersListContent({ resolvedSearchParams }: { resolvedSearchParams: SP }) {
  const page = Math.max(1, parseInt(resolvedSearchParams.page || '1', 10))
  const sort = resolvedSearchParams.sort
  const dir = resolvedSearchParams.dir as 'asc' | 'desc' | undefined

  const { customers, total } = await getCustomers({
    search: resolvedSearchParams.search,
    status: resolvedSearchParams.status,
    segment: resolvedSearchParams.segment,
    tag: resolvedSearchParams.tag,
    health: resolvedSearchParams.health,
    page,
    limit: PAGE_SIZE,
    sort,
    dir,
  })

  const query = {
    status: resolvedSearchParams.status,
    search: resolvedSearchParams.search,
    segment: resolvedSearchParams.segment,
    tag: resolvedSearchParams.tag,
    health: resolvedSearchParams.health,
    sort,
    dir,
  }

  const currentListUrl = (() => {
    const params = new URLSearchParams({ tab: 'list' })
    for (const k of ['status', 'search', 'segment', 'tag', 'health', 'sort', 'dir'] as const)
      if (query[k]) params.set(k, query[k]!)
    if (page > 1) params.set('page', String(page))
    const qs = params.toString()
    return `/admin/customers${qs ? `?${qs}` : ''}`
  })()

  return (
    <CustomersTable
      customers={customers ?? []}
      total={total}
      page={page}
      pageSize={PAGE_SIZE}
      query={query}
      backUrl={currentListUrl}
    />
  )
}
