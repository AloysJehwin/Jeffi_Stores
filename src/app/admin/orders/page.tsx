import { Suspense } from 'react'
import Link from 'next/link'
import { getFilteredOrders } from '@/lib/queries'
import AdminFilters from '@/components/admin/AdminFilters'
import Pagination from '@/components/admin/Pagination'
import OrdersTableRows from '@/components/admin/OrdersTableRows'
import SortableHeader from '@/components/admin/SortableHeader'
import { sortOptions } from '@/components/admin/sortOptions'
import { ap } from '@/lib/admin-path'
import { getHost } from '@/lib/get-host'
import AdminSkeleton from '@/components/admin/AdminSkeleton'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const PAGE_SIZE = 25

type SP = { [key: string]: string | string[] | undefined }
function sp(resolvedSearchParams: SP, key: string) {
  const v = resolvedSearchParams[key]
  return Array.isArray(v) ? v[0] : v
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
    page,
    limit: PAGE_SIZE,
    sort,
    dir,
  })

  const buildUrl = (p: number) => {
    const params = new URLSearchParams()
    if (sp(resolvedSearchParams, 'status')) params.set('status', sp(resolvedSearchParams, 'status')!)
    if (sp(resolvedSearchParams, 'payment_status')) params.set('payment_status', sp(resolvedSearchParams, 'payment_status')!)
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
    if (sp(resolvedSearchParams, 'payment_status')) params.set('payment_status', sp(resolvedSearchParams, 'payment_status')!)
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
      <div className="md:hidden space-y-3">
        {orders && orders.length > 0 ? (
          orders.map((order: any) => (
            <div
              key={order.id}
              className="bg-surface-elevated rounded-lg shadow-sm border border-border-default p-4"
            >
              <Link href={ap(`/admin/orders/${order.id}?back=${encodeURIComponent(currentListUrl)}`, host)} className="block">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-foreground">
                      #{order.order_number || order.id.slice(0, 8)}
                    </span>
                    <span className={`px-1.5 py-0.5 text-xs font-medium rounded ${
                      order.source === 'online'
                        ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                        : order.source === 'business'
                          ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
                          : 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300'
                    }`}>
                      {order.source === 'online' ? 'Online' : order.source === 'business' ? 'Business' : 'Offline'}
                    </span>
                  </div>
                  <span className={`px-2 py-0.5 text-xs font-semibold rounded-full ${
                    order.status === 'delivered' ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300'
                    : order.status === 'processing' || order.status === 'shipped' ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300'
                    : order.status === 'out_for_delivery' ? 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-800 dark:text-indigo-300'
                    : order.status === 'cancelled' ? 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300'
                    : order.status === 'cancel_requested' ? 'bg-orange-100 dark:bg-orange-900/30 text-orange-800 dark:text-orange-300'
                    : 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300'
                  }`}>
                    {order.status === 'cancel_requested' ? 'Cancel Req.' : order.status === 'out_for_delivery' ? 'Out for Delivery' : order.status}
                  </span>
                </div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm text-foreground">
                    {order.users ? `${order.users.first_name || ''} ${order.users.last_name || ''}`.trim() || order.customer_name || 'Guest' : order.customer_name || 'Guest'}
                  </span>
                  <span className="text-sm font-semibold text-foreground">
                    Rs. {Number(order.total_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-foreground-muted">
                    {new Date(order.created_at).toLocaleDateString('en-IN')}
                  </span>
                  <span className={`px-2 py-0.5 text-xs font-semibold rounded-full ${
                    order.payment_status === 'paid' ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300'
                    : order.payment_status === 'pending' ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300'
                    : 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300'
                  }`}>
                    {order.payment_status}
                  </span>
                </div>
                {order.estimated_delivery_date && (
                  <div className="text-xs text-foreground-muted mt-1">
                    EDD: <span className="text-foreground">{new Date(order.estimated_delivery_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
                  </div>
                )}
              </Link>
              <div className="flex items-center gap-3 mt-3 pt-3 border-t border-border-default">
                <a
                  href={`/api/admin/packing-slips/${order.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-xs text-foreground-secondary hover:text-foreground transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  Packing Slip
                </a>
                {order.awb_number && (
                  <a
                    href={`/api/admin/orders/${order.id}/shipping-label?size=4R&print=1`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-xs text-foreground-secondary hover:text-foreground transition-colors"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                    </svg>
                    Shipping Label
                  </a>
                )}
                {order.invoice_number && (
                  <a
                    href={`/api/orders/${order.id}/invoice`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-xs text-foreground-secondary hover:text-foreground transition-colors"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                    </svg>
                    Invoice
                  </a>
                )}
              </div>
            </div>
          ))
        ) : (
          <div className="bg-surface-elevated rounded-lg border border-border-default p-8 text-center text-foreground-muted">
            No orders found.
          </div>
        )}
        <Pagination page={page} total={total} pageSize={PAGE_SIZE} buildUrl={buildUrl} />
      </div>

      <div className="hidden md:block bg-surface-elevated rounded-lg shadow-sm border border-border-default overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-border-default">
            <thead className="bg-surface-secondary">
              <tr>
                <SortableHeader label="Order ID" column="order_number" options={sortOptions('text')} currentSort={sort} currentDir={dir} />
                <SortableHeader label="Source" column="source" options={sortOptions('text')} currentSort={sort} currentDir={dir} />
                <SortableHeader label="Customer" column="customer" options={sortOptions('text')} currentSort={sort} currentDir={dir} />
                <SortableHeader label="Date" column="date" options={sortOptions('date')} currentSort={sort} currentDir={dir} />
                <th className="px-6 py-3 text-left text-xs font-medium text-foreground-muted uppercase tracking-wider">EDD</th>
                <SortableHeader label="Total" column="total" options={sortOptions('number')} currentSort={sort} currentDir={dir} />
                <SortableHeader label="Payment" column="payment" options={sortOptions('text')} currentSort={sort} currentDir={dir} />
                <SortableHeader label="Status" column="status" options={sortOptions('text')} currentSort={sort} currentDir={dir} />
                <th className="px-6 py-3 text-right text-xs font-medium text-foreground-muted uppercase tracking-wider">Actions</th>
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

export default async function OrdersPage({ searchParams }: { searchParams: Promise<SP> }) {
  const resolvedSearchParams = await searchParams
  const host = await getHost()
  const allStats = await getFilteredOrders({})

  const totalOrders = allStats.total
  const pendingOrders = allStats.orders?.filter((o: any) => o.status === 'pending').length || 0
  const processingOrders = allStats.orders?.filter((o: any) => o.status === 'processing').length || 0
  const completedOrders = allStats.orders?.filter((o: any) => o.status === 'delivered').length || 0
  const totalRevenue = allStats.orders?.reduce((sum: number, order: any) => {
    return order.payment_status === 'paid' ? sum + Number(order.total_amount) : sum
  }, 0) || 0

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-secondary-500 dark:text-foreground">Orders</h1>
          <p className="text-foreground-secondary mt-1 text-sm">Manage customer orders</p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 sm:gap-6 mb-6">
        <div className="bg-surface-elevated p-4 sm:p-6 rounded-lg shadow-sm border border-border-default">
          <p className="text-foreground-secondary text-sm">Total Orders</p>
          <p className="text-2xl sm:text-3xl font-bold text-secondary-500 dark:text-foreground mt-2">{totalOrders}</p>
        </div>
        <div className="bg-surface-elevated p-4 sm:p-6 rounded-lg shadow-sm border border-border-default">
          <p className="text-foreground-secondary text-sm">Pending</p>
          <p className="text-2xl sm:text-3xl font-bold text-orange-500 mt-2">{pendingOrders}</p>
        </div>
        <div className="bg-surface-elevated p-4 sm:p-6 rounded-lg shadow-sm border border-border-default">
          <p className="text-foreground-secondary text-sm">Processing</p>
          <p className="text-2xl sm:text-3xl font-bold text-blue-500 mt-2">{processingOrders}</p>
        </div>
        <div className="bg-surface-elevated p-4 sm:p-6 rounded-lg shadow-sm border border-border-default">
          <p className="text-foreground-secondary text-sm">Completed</p>
          <p className="text-2xl sm:text-3xl font-bold text-green-500 mt-2">{completedOrders}</p>
        </div>
      </div>

      <div className="bg-gradient-to-r from-primary-500 to-accent-500 p-4 sm:p-6 rounded-lg shadow-sm mb-6">
        <p className="text-white text-sm">Total Revenue</p>
        <p className="text-3xl sm:text-4xl font-bold text-white mt-2">
          Rs. {totalRevenue.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
        </p>
      </div>

      <AdminFilters
        filters={[
          {
            name: 'source',
            label: 'Source',
            options: [
              { value: 'online', label: 'Online' },
            ] },
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
            ] },
          {
            name: 'payment_status',
            label: 'Payment Status',
            options: [
              { value: 'pending', label: 'Pending' },
              { value: 'paid', label: 'Paid' },
              { value: 'failed', label: 'Failed' },
              { value: 'refunded', label: 'Refunded' },
              { value: 'unpaid', label: 'Unpaid' },
            ] },
        ]}
        searchPlaceholder="Search by order number or customer..."
        searchParam="search"
        suggestType="orders"
      />

      <Suspense fallback={<AdminSkeleton variant="list" showStats={false} />}>
        <OrdersListContent resolvedSearchParams={resolvedSearchParams} />
      </Suspense>
    </div>
  )
}
