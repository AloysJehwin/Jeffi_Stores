import { Suspense } from 'react'
import { getFilteredOrders, getRevenueTrendBySource } from '@/lib/queries'
import AdvancedFilterPanel from '@/components/admin/AdvancedFilterPanel'
import { ap } from '@/lib/shared/admin-path'
import { isFulfilledStatus } from '@/lib/orders/fulfilled-status'
import { getHost } from '@/lib/tenancy/get-host'
import RevenueTrendChart from '@/components/admin/RevenueTrendChart'
import { Kpi, ListSkeleton, PageBody, PageHeader, TabLinks, TableSkeleton } from '@/components/admin/kit'
import OrdersTable from './_components/OrdersTable'
import OrdersFilters from './_components/OrdersFilters'
import OrdersOverview from './_components/OrdersOverview'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const PAGE_SIZE = 25

// Params that belong to the list; a URL carrying any of them (old links, filters) opens the list tab.
const LIST_PARAMS = [
  'status',
  'payment_status',
  'source',
  'search',
  'sort',
  'dir',
  'page',
  'date_from',
  'date_to',
  'amount_min',
  'amount_max',
  'awb',
  'shipment_status',
  'payment_mode',
  'coupon_code',
  'cod_pending',
  '_adv',
]

type SP = { [key: string]: string | string[] | undefined }
function sp(resolvedSearchParams: SP, key: string) {
  const v = resolvedSearchParams[key]
  return Array.isArray(v) ? v[0] : v
}

async function OrdersStats() {
  const [allStats, revenueTrend] = await Promise.all([getFilteredOrders({}), getRevenueTrendBySource()])

  const totalOrders = allStats.total
  const pendingOrders = allStats.orders?.filter((o: any) => o.status === 'pending').length || 0
  const processingOrders = allStats.orders?.filter((o: any) => o.status === 'processing').length || 0
  const completedOrders = allStats.orders?.filter((o: any) => isFulfilledStatus(o.status)).length || 0
  const totalRevenue =
    allStats.orders?.reduce((sum: number, order: any) => {
      return order.payment_status === 'paid' ? sum + Number(order.total_amount) : sum
    }, 0) || 0

  const money = (v: number) => `Rs. ${v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  return (
    <div className="animate-fade-in grid grid-cols-1 gap-4 xl:grid-cols-3">
      <div className="grid grid-cols-2 content-start gap-3">
        <div className="col-span-2">
          <Kpi label="Total revenue" value={money(totalRevenue)} sub="Paid orders" highlight />
        </div>
        <Kpi label="Total" value={totalOrders.toLocaleString('en-IN')} />
        <Kpi label="Pending" value={pendingOrders.toLocaleString('en-IN')} />
        <Kpi label="Processing" value={processingOrders.toLocaleString('en-IN')} />
        <Kpi label="Completed" value={completedOrders.toLocaleString('en-IN')} />
      </div>
      <div className="xl:col-span-2">
        <RevenueTrendChart data={revenueTrend} />
      </div>
    </div>
  )
}

async function OrdersListContent({ resolvedSearchParams }: { resolvedSearchParams: SP }) {
  const host = await getHost()
  const page = Math.max(1, parseInt(sp(resolvedSearchParams, 'page') || '1', 10))
  const sort = sp(resolvedSearchParams, 'sort')
  const dir = sp(resolvedSearchParams, 'dir') as 'asc' | 'desc' | undefined

  const { orders, total } = await getFilteredOrders({
    status: sp(resolvedSearchParams, 'status'),
    payment_status: sp(resolvedSearchParams, 'payment_status'),
    source: sp(resolvedSearchParams, 'source'),
    search: sp(resolvedSearchParams, 'search'),
    date_from: sp(resolvedSearchParams, 'date_from'),
    date_to: sp(resolvedSearchParams, 'date_to'),
    amount_min: sp(resolvedSearchParams, 'amount_min'),
    amount_max: sp(resolvedSearchParams, 'amount_max'),
    awb: sp(resolvedSearchParams, 'awb'),
    shipment_status: sp(resolvedSearchParams, 'shipment_status'),
    payment_mode: sp(resolvedSearchParams, 'payment_mode'),
    coupon_code: sp(resolvedSearchParams, 'coupon_code'),
    cod_pending: sp(resolvedSearchParams, 'cod_pending'),
    page,
    limit: PAGE_SIZE,
    sort,
    dir,
  })

  const buildUrl = (p: number) => {
    const params = new URLSearchParams()
    if (sp(resolvedSearchParams, 'status')) params.set('status', sp(resolvedSearchParams, 'status')!)
    if (sp(resolvedSearchParams, 'payment_status'))
      params.set('payment_status', sp(resolvedSearchParams, 'payment_status')!)
    if (sp(resolvedSearchParams, 'source')) params.set('source', sp(resolvedSearchParams, 'source')!)
    if (sp(resolvedSearchParams, 'search')) params.set('search', sp(resolvedSearchParams, 'search')!)
    if (sort) params.set('sort', sort)
    if (dir) params.set('dir', dir)
    if (p > 1) params.set('page', String(p))
    params.set('tab', 'list')
    const qs = params.toString()
    return ap(`/admin/orders${qs ? `?${qs}` : ''}`, host)
  }

  const currentListUrl = (() => {
    const params = new URLSearchParams()
    if (sp(resolvedSearchParams, 'status')) params.set('status', sp(resolvedSearchParams, 'status')!)
    if (sp(resolvedSearchParams, 'payment_status'))
      params.set('payment_status', sp(resolvedSearchParams, 'payment_status')!)
    if (sp(resolvedSearchParams, 'source')) params.set('source', sp(resolvedSearchParams, 'source')!)
    if (sp(resolvedSearchParams, 'search')) params.set('search', sp(resolvedSearchParams, 'search')!)
    if (sort) params.set('sort', sort)
    if (dir) params.set('dir', dir)
    if (page > 1) params.set('page', String(page))
    params.set('tab', 'list')
    const qs = params.toString()
    return `/admin/orders${qs ? `?${qs}` : ''}`
  })()

  return <OrdersTable orders={orders ?? []} total={total} page={page} pageSize={PAGE_SIZE} backUrl={currentListUrl} pageHref={buildUrl} />
}

export default async function OrdersPage({ searchParams }: { searchParams: Promise<SP> }) {
  const resolved = await searchParams
  const host = await getHost()
  const tabParam = sp(resolved, 'tab')
  const tab =
    tabParam === 'list' || (tabParam !== 'overview' && LIST_PARAMS.some(k => sp(resolved, k))) ? 'list' : 'overview'

  return (
    <PageBody>
      <PageHeader title="Orders" description="Manage customer orders" />

      <TabLinks
        tabs={[
          { id: 'overview', label: 'Overview', href: ap('/admin/orders?tab=overview', host) },
          { id: 'list', label: 'All orders', href: ap('/admin/orders?tab=list', host) },
        ]}
        value={tab}
      />

      {tab === 'overview' ? (
        <Suspense fallback={null}>
          <OrdersOverview />
        </Suspense>
      ) : (
        <OrdersList searchParams={searchParams} />
      )}
    </PageBody>
  )
}

function OrdersList({ searchParams }: { searchParams: Promise<SP> }) {
  return (
    <>
      <Suspense fallback={<ListSkeleton header={false} kpis={3} rows={0} />}>
        <OrdersStats />
      </Suspense>

      <OrdersFilters
        filters={[
          {
            name: 'source',
            label: 'Source',
            options: [
              { value: 'online', label: 'Online' },
              { value: 'business', label: 'Business' },
              { value: 'offline', label: 'Offline' },
              { value: 'cash_sale', label: 'Cash Sale' },
            ],
          },
          {
            name: 'status',
            label: 'Order Status',
            options: [
              { value: 'pending', label: 'Pending' },
              { value: 'confirmed', label: 'Confirmed' },
              { value: 'processing', label: 'Processing' },
              { value: 'shipped', label: 'Shipped' },
              { value: 'out_for_delivery', label: 'Out for Delivery' },
              { value: 'delivered', label: 'Delivered' },
              { value: 'granted', label: 'Access granted' },
              { value: 'cancel_requested', label: 'Cancel Requested' },
              { value: 'cancelled', label: 'Cancelled' },
              { value: 'return_requested', label: 'Return Requested' },
              { value: 'return_approved', label: 'Return Approved' },
              { value: 'return_received', label: 'Return Received' },
              { value: 'return_rejected', label: 'Return Rejected' },
              { value: 'returned', label: 'Returned' },
            ],
          },
          {
            name: 'payment_status',
            label: 'Payment Status',
            options: [
              { value: 'pending', label: 'Pending' },
              { value: 'paid', label: 'Paid' },
              { value: 'failed', label: 'Failed' },
              { value: 'refunded', label: 'Refunded' },
              { value: 'unpaid', label: 'Unpaid' },
              { value: 'cancelled', label: 'Cancelled' },
            ],
          },
        ]}
        advanced={
          <AdvancedFilterPanel
            fields={[
              { name: ['date_from', 'date_to'], label: 'Order Date', type: 'date-range', section: 'Date & Amount' },
              {
                name: ['amount_min', 'amount_max'],
                label: 'Order Amount',
                type: 'range',
                section: 'Date & Amount',
                unit: '₹',
              },
              {
                name: 'shipment_status',
                label: 'Shipment Status',
                type: 'multi-select',
                section: 'Shipment',
                options: [
                  { value: 'created', label: 'Created' },
                  { value: 'in_transit', label: 'In Transit' },
                  { value: 'out_for_delivery', label: 'Out for Delivery' },
                  { value: 'delivered', label: 'Delivered' },
                  { value: 'rto_initiated', label: 'RTO Initiated' },
                  { value: 'rto_delivered', label: 'RTO Delivered' },
                ],
              },
              {
                name: 'awb',
                label: 'AWB / Tracking No.',
                type: 'text',
                section: 'Shipment',
                placeholder: 'Search by AWB number',
              },
              {
                name: 'payment_mode',
                label: 'Payment Mode',
                type: 'multi-select',
                section: 'Payment',
                options: [
                  { value: 'cod', label: 'Cash on Delivery' },
                  { value: 'prepaid', label: 'Prepaid' },
                ],
              },
              {
                name: 'coupon_code',
                label: 'Coupon Code',
                type: 'text',
                section: 'Payment',
                placeholder: 'Search by coupon code',
              },
              { name: 'cod_pending', label: 'COD pending remittance', type: 'boolean', section: 'Payment' },
            ]}
            mode="content"
            forceExpanded
          />
        }
      />

      <OrdersListSection searchParams={searchParams} />
    </>
  )
}

// Resolves searchParams (no DB — near-instant) then keys the table Suspense
// on the query string so filter/pagination changes re-trigger the shimmer
// while the stats + filters above stay mounted.
async function OrdersListSection({ searchParams }: { searchParams: Promise<SP> }) {
  const resolvedSearchParams = await searchParams
  const key = JSON.stringify(resolvedSearchParams)
  return (
    <Suspense key={key} fallback={<TableSkeleton rows={8} cols={6} />}>
      <OrdersListContent resolvedSearchParams={resolvedSearchParams} />
    </Suspense>
  )
}
