import { Suspense } from 'react'
import { canonicalQuery, filterScope, normalizeQuery, type FilterQuery } from '@jeffi/list-filters'
import { listKey } from '@/lib/admin/list-key'
import { pageUrls } from '@/lib/admin/page-urls'
import { isListUrl, tabHref } from '@/lib/admin/filter-url'
import { getOrdersSummary, getRevenueTrendBySource, queryOrders } from '@/lib/queries'
import { ORDERS_ENTITY } from '@/lib/filters/entities/orders'
import { ORDER_ALIASES, ORDER_FIELDS, ORDER_SEARCH } from '@/lib/filters/fields/orders'
import { ap } from '@/lib/shared/admin-path'
import { getHost } from '@/lib/tenancy/get-host'
import RevenueTrendChart from '@/components/admin/RevenueTrendChart'
import { Kpi, ListFilters, ListSkeleton, PageBody, PageHeader, TabLinks, TableSkeleton } from '@/components/admin/kit'
import OrdersTable from './_components/OrdersTable'
import OrdersOverview from './_components/OrdersOverview'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const PAGE_SIZE = 25

type SP = { [key: string]: string | string[] | undefined }
function sp(resolvedSearchParams: SP, key: string) {
  const v = resolvedSearchParams[key]
  return Array.isArray(v) ? v[0] : v
}

/** KPIs over every order the filters match; the trend keeps its own window. */
async function OrdersStats({ q }: { q: FilterQuery }) {
  const ctx = (await ORDERS_ENTITY.context?.(q)) ?? {}
  const [summary, revenueTrend] = await Promise.all([
    getOrdersSummary(q, ctx),
    getRevenueTrendBySource('12m', filterScope(ORDERS_ENTITY, q, { omit: ['created'], ctx })),
  ])

  const money = (v: number) => `Rs. ${v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  return (
    <div className="animate-fade-in grid grid-cols-1 gap-4 xl:grid-cols-3">
      <div className="grid grid-cols-2 content-start gap-3">
        <div className="col-span-2">
          <Kpi label="Total revenue" value={money(summary.paidRevenue)} sub="Paid orders" highlight />
        </div>
        <Kpi label="Total" value={summary.total.toLocaleString('en-IN')} />
        <Kpi label="Pending" value={summary.pending.toLocaleString('en-IN')} />
        <Kpi label="Processing" value={summary.processing.toLocaleString('en-IN')} />
        <Kpi label="Completed" value={summary.completed.toLocaleString('en-IN')} />
      </div>
      <div className="xl:col-span-2">
        <RevenueTrendChart data={revenueTrend} query={canonicalQuery(q, ORDER_FIELDS, { omit: ['from', 'to'] })} />
      </div>
    </div>
  )
}

async function OrdersListContent({ resolvedSearchParams }: { resolvedSearchParams: SP }) {
  const host = await getHost()
  const page = Math.max(1, parseInt(sp(resolvedSearchParams, 'page') || '1', 10))
  const sort = sp(resolvedSearchParams, 'sort')
  const dir = sp(resolvedSearchParams, 'dir') as 'asc' | 'desc' | undefined

  const { orders, total } = await queryOrders(normalizeQuery(ORDERS_ENTITY, resolvedSearchParams), {
    page,
    limit: PAGE_SIZE,
    sort,
    dir,
  })

  // Clone every param except `page` so advancing a page never drops ?tab=list or any filter.
  const listParams = (p: number) => {
    const params = new URLSearchParams()
    for (const [k, v] of Object.entries(resolvedSearchParams)) {
      if (k !== 'page' && typeof v === 'string' && v) params.set(k, v)
    }
    if (p > 1) params.set('page', String(p))
    return params.toString()
  }
  const buildUrl = (p: number) => ap(`/admin/orders${listParams(p) ? `?${listParams(p)}` : ''}`, host)
  const currentListUrl = `/admin/orders${listParams(page) ? `?${listParams(page)}` : ''}`

  return <OrdersTable orders={orders ?? []} total={total} page={page} pageSize={PAGE_SIZE} backUrl={currentListUrl} pageUrls={pageUrls(buildUrl)} />
}

export default async function OrdersPage({ searchParams }: { searchParams: Promise<SP> }) {
  const resolved = await searchParams
  const host = await getHost()
  const tab = isListUrl(resolved, ORDER_FIELDS, { aliases: ORDER_ALIASES }) ? 'list' : 'overview'
  const href = (t: string) => ap(tabHref('/admin/orders', t, resolved, ORDER_FIELDS, { aliases: ORDER_ALIASES }), host)

  return (
    <PageBody>
      <PageHeader title="Orders" description="Manage customer orders" />

      <TabLinks
        tabs={[
          { id: 'overview', label: 'Overview', href: href('overview') },
          { id: 'list', label: 'All orders', href: href('list') },
        ]}
        value={tab}
      />

      {tab === 'overview' ? (
        <Suspense fallback={null}>
          <OrdersOverview />
        </Suspense>
      ) : (
        <OrdersList resolved={resolved} />
      )}
    </PageBody>
  )
}

function OrdersList({ resolved }: { resolved: SP }) {
  const q = normalizeQuery(ORDERS_ENTITY, resolved)
  return (
    <>
      <Suspense key={JSON.stringify(q)} fallback={<ListSkeleton header={false} kpis={3} rows={0} />}>
        <OrdersStats q={q} />
      </Suspense>

      <ListFilters entity="orders" fields={ORDER_FIELDS} aliases={ORDER_ALIASES} search={ORDER_SEARCH} noun="Orders" tab="list" />

      <OrdersListSection resolvedSearchParams={resolved} />
    </>
  )
}

// Keys the table Suspense on the query string so filter/pagination changes re-trigger the shimmer
// while the stats + filters above stay mounted.
function OrdersListSection({ resolvedSearchParams }: { resolvedSearchParams: SP }) {
  const key = listKey(resolvedSearchParams)
  return (
    <Suspense key={key} fallback={<TableSkeleton rows={8} cols={6} />}>
      <OrdersListContent resolvedSearchParams={resolvedSearchParams} />
    </Suspense>
  )
}
