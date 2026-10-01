import { Suspense } from 'react'
import { getFilteredOrders, getRevenueTrendBySource } from '@/lib/queries'
import AdminFilters from '@/components/admin/AdminFilters'
import AdvancedFilterPanel from '@/components/admin/AdvancedFilterPanel'
import Pagination from '@/components/admin/Pagination'
import OrdersTableRows from '@/components/admin/OrdersTableRows'
import SortableHeader from '@/components/admin/SortableHeader'
import { sortOptions } from '@/components/admin/sortOptions'
import { ap } from '@/lib/shared/admin-path'
import { getHost } from '@/lib/tenancy/get-host'
import AdminStatsSkeleton from '@/components/admin/AdminStatsSkeleton'
import AdminTableSkeleton from '@/components/admin/AdminTableSkeleton'
import RevenueTrendChart from '@/components/admin/RevenueTrendChart'
import OrdersMobileList from './_components/OrdersMobileList'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const PAGE_SIZE = 25

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
  const completedOrders = allStats.orders?.filter((o: any) => o.status === 'delivered').length || 0
  const totalRevenue =
    allStats.orders?.reduce((sum: number, order: any) => {
      return order.payment_status === 'paid' ? sum + Number(order.total_amount) : sum
    }, 0) || 0

  return (
    <div className="animate-fade-in">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 mb-6 lg:h-56">
        {/* Left: Total Revenue + the 4 order stats as tiles */}
        <div className="bg-gradient-to-r from-primary-500 to-accent-500 p-4 sm:p-6 rounded-lg shadow-sm flex flex-col justify-between text-white">
          <div>
            <p className="text-white/80 text-sm">Total Revenue</p>
            <p className="text-3xl sm:text-4xl font-bold mt-1">
              Rs. {totalRevenue.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </p>
          </div>
          <div className="grid grid-cols-4 gap-2 sm:gap-3 mt-4">
            <div className="rounded-lg bg-white/15 backdrop-blur-sm px-2 py-2 sm:px-3 sm:py-2.5">
              <p className="text-lg sm:text-2xl font-bold leading-none">{totalOrders}</p>
              <p className="text-[10px] sm:text-xs text-white/80 mt-1">Total</p>
            </div>
            <div className="rounded-lg bg-white/15 backdrop-blur-sm px-2 py-2 sm:px-3 sm:py-2.5">
              <p className="text-lg sm:text-2xl font-bold leading-none">{pendingOrders}</p>
              <p className="text-[10px] sm:text-xs text-white/80 mt-1">Pending</p>
            </div>
            <div className="rounded-lg bg-white/15 backdrop-blur-sm px-2 py-2 sm:px-3 sm:py-2.5">
              <p className="text-lg sm:text-2xl font-bold leading-none">{processingOrders}</p>
              <p className="text-[10px] sm:text-xs text-white/80 mt-1">Processing</p>
            </div>
            <div className="rounded-lg bg-white/15 backdrop-blur-sm px-2 py-2 sm:px-3 sm:py-2.5">
              <p className="text-lg sm:text-2xl font-bold leading-none">{completedOrders}</p>
              <p className="text-[10px] sm:text-xs text-white/80 mt-1">Completed</p>
            </div>
          </div>
        </div>
        {/* Right: revenue trend chart */}
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
    const qs = params.toString()
    return `/admin/orders${qs ? `?${qs}` : ''}`
  })()

  return (
    <>
      <OrdersMobileList
        orders={orders ?? []}
        backUrl={currentListUrl}
        pagination={<Pagination page={page} total={total} pageSize={PAGE_SIZE} buildUrl={buildUrl} />}
      />

      <div className="hidden md:block bg-surface-elevated rounded-lg shadow-sm border border-border-default overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-border-default">
            <thead className="bg-surface-secondary">
              <tr>
                <SortableHeader
                  label="Order ID"
                  column="order_number"
                  options={sortOptions('text')}
                  currentSort={sort}
                  currentDir={dir}
                />
                <SortableHeader
                  label="Source"
                  column="source"
                  options={sortOptions('text')}
                  currentSort={sort}
                  currentDir={dir}
                />
                <SortableHeader
                  label="Customer"
                  column="customer"
                  options={sortOptions('text')}
                  currentSort={sort}
                  currentDir={dir}
                />
                <SortableHeader
                  label="Date"
                  column="date"
                  options={sortOptions('date')}
                  currentSort={sort}
                  currentDir={dir}
                />
                <th className="px-6 py-3 text-left text-xs font-medium text-foreground-muted uppercase tracking-wider">
                  EDD
                </th>
                <SortableHeader
                  label="Total"
                  column="total"
                  options={sortOptions('number')}
                  currentSort={sort}
                  currentDir={dir}
                />
                <SortableHeader
                  label="Payment"
                  column="payment"
                  options={sortOptions('text')}
                  currentSort={sort}
                  currentDir={dir}
                />
                <SortableHeader
                  label="Status"
                  column="status"
                  options={sortOptions('text')}
                  currentSort={sort}
                  currentDir={dir}
                />
                <th className="px-6 py-3 text-right text-xs font-medium text-foreground-muted uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-default">
              <OrdersTableRows orders={orders ?? []} backUrl={currentListUrl} />
            </tbody>
          </table>
        </div>
      </div>

      <div className="hidden md:block px-6 py-3 border border-border-default border-t-0 rounded-b-lg bg-surface-elevated">
        <Pagination page={page} total={total} pageSize={PAGE_SIZE} buildUrl={buildUrl} />
      </div>
    </>
  )
}

export default function OrdersPage({ searchParams }: { searchParams: Promise<SP> }) {
  return (
    <div className="p-4 sm:p-6">
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-secondary-500 dark:text-foreground">Orders</h1>
          <p className="text-foreground-secondary mt-1 text-sm">Manage customer orders</p>
        </div>
      </div>

      <Suspense fallback={<AdminStatsSkeleton cards={4} banner />}>
        <OrdersStats />
      </Suspense>

      <AdminFilters
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
        searchPlaceholder="Search by order number or customer..."
        searchParam="search"
        suggestType="orders"
        advancedContent={
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
    </div>
  )
}

// Resolves searchParams (no DB — near-instant) then keys the table Suspense
// on the query string so filter/pagination changes re-trigger the shimmer
// while the stats + filters above stay mounted.
async function OrdersListSection({ searchParams }: { searchParams: Promise<SP> }) {
  const resolvedSearchParams = await searchParams
  const key = JSON.stringify(resolvedSearchParams)
  return (
    <Suspense key={key} fallback={<AdminTableSkeleton rows={8} cols={9} />}>
      <OrdersListContent resolvedSearchParams={resolvedSearchParams} />
    </Suspense>
  )
}
