import { Suspense } from 'react'
import { canonicalQuery, filterScope, normalizeQuery, type FilterQuery } from '@jeffi/list-filters'
import { listKey } from '@/lib/admin/list-key'
import { isListUrl, tabHref } from '@/lib/admin/filter-url'
import { getCustomerChannelMix, getCustomerSegments, getCustomersSummary, queryCustomers } from '@/lib/queries'
import { CUSTOMERS_ENTITY } from '@/lib/filters/entities/customers'
import { CUSTOMER_FIELDS, CUSTOMER_SEARCH } from '@/lib/filters/fields/customers'
import CustomersTable from './_components/CustomersTable'
import { ap } from '@/lib/shared/admin-path'
import { getHost } from '@/lib/tenancy/get-host'
import { Kpi, KpiGrid, ListFilters, PageBody, PageHeader } from '@/components/admin/kit'
import { LoadingKpis, LoadingTable } from '@/components/admin/kit/skeleton'
import CustomerEngagementChart from '@/components/admin/CustomerEngagementChart'
import CustomersOverview from './_components/CustomersOverview'
import OverviewTabs from '../coupons/_components/OverviewTabs'
import { requireListAccess } from '@/lib/admin/list-access'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const PAGE_SIZE = 25

type SP = { [key: string]: string | undefined }

/** KPIs and the engagement chart over every customer the filters match. */
async function CustomersStats({ q }: { q: FilterQuery }) {
  const scope = filterScope(CUSTOMERS_ENTITY, q)
  const [stats, segments, channelMix] = await Promise.all([
    getCustomersSummary(q),
    getCustomerSegments(scope),
    getCustomerChannelMix(scope),
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

export default async function CustomersPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams
  const tab = isListUrl(sp, CUSTOMER_FIELDS) ? 'list' : 'overview'
  const host = await getHost()
  const href = (t: string) => ap(tabHref('/admin/customers', t, sp, CUSTOMER_FIELDS), host)
  const q = normalizeQuery(CUSTOMERS_ENTITY, sp)
  return (
    <PageBody>
      <PageHeader title="Customers" description="View and manage customer accounts" />

      <OverviewTabs
        basePath={ap('/admin/customers', host)}
        active={tab}
        sp={sp}
        listLabel="Customers"
        hrefs={{ overview: href('overview'), list: href('list') }}
      />

      {tab === 'overview' ? (
        <Suspense fallback={null}>
          <CustomersOverview />
        </Suspense>
      ) : (
        <>
          <Suspense key={JSON.stringify(q)} fallback={<KpiRowSkeleton />}>
            <CustomersStats q={q} />
          </Suspense>

          <ListFilters
            entity="customers"
            fields={CUSTOMER_FIELDS}
            search={CUSTOMER_SEARCH}
            noun="Customers"
            tab="list"
            exportable
          />

          <CustomersListSection resolvedSearchParams={sp} />
        </>
      )}
    </PageBody>
  )
}

function KpiRowSkeleton() {
  return <LoadingKpis labels={['Total customers', 'Active', 'Inactive', 'Flagged']} />
}

// Keys the table Suspense on the query string so filter/pagination changes re-trigger the shimmer
// while the stats + filters above stay mounted.
function CustomersListSection({ resolvedSearchParams }: { resolvedSearchParams: SP }) {
  const key = listKey(resolvedSearchParams)
  return (
    <Suspense key={key} fallback={<LoadingTable columns={['Name', 'Email', 'Phone', 'Joined', 'Orders', 'Health', 'Status']} />}>
      <CustomersListContent resolvedSearchParams={resolvedSearchParams} />
    </Suspense>
  )
}

async function CustomersListContent({ resolvedSearchParams }: { resolvedSearchParams: SP }) {
  const page = Math.max(1, parseInt(resolvedSearchParams.page || '1', 10))
  const sort = resolvedSearchParams.sort
  const dir = resolvedSearchParams.dir as 'asc' | 'desc' | undefined
  const q = normalizeQuery(CUSTOMERS_ENTITY, resolvedSearchParams)

  const { customers, total } = await queryCustomers(q, { page, limit: PAGE_SIZE, sort, dir })
  async function loadPage(p: number) {
    'use server'
    await requireListAccess('/admin/customers')
    const res = await queryCustomers(normalizeQuery(CUSTOMERS_ENTITY, resolvedSearchParams), { page: p, limit: PAGE_SIZE, sort, dir })
    return { rows: res.customers ?? [], total: res.total }
  }

  const currentListUrl = (() => {
    const params = new URLSearchParams(`tab=list&${canonicalQuery(q, CUSTOMER_FIELDS)}`)
    if (sort) params.set('sort', sort)
    if (dir) params.set('dir', dir)
    if (page > 1) params.set('page', String(page))
    return `/admin/customers?${params}`
  })()

  return (
    <CustomersTable
      customers={customers ?? []}
      total={total}
      page={page}
      pageSize={PAGE_SIZE}
      query={{ ...q, sort, dir }}
      backUrl={currentListUrl}
      loadPage={loadPage}
    />
  )
}
