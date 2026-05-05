import Link from 'next/link'
import { getFilteredOrders } from '@/lib/queries'
import AdminFilters from '@/components/admin/AdminFilters'
import Pagination from '@/components/admin/Pagination'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const PAGE_SIZE = 25

export default async function OrdersPage({ searchParams }: { searchParams: { [key: string]: string | undefined } }) {
  const page = Math.max(1, parseInt(searchParams.page || '1', 10))

  const [{ orders, total }, allStats] = await Promise.all([
    getFilteredOrders({
      status: searchParams.status,
      payment_status: searchParams.payment_status,
      search: searchParams.search,
      page,
      limit: PAGE_SIZE,
    }),
    getFilteredOrders({}),
  ])

  const totalOrders = allStats.total
  const pendingOrders = allStats.orders?.filter((o: any) => o.status === 'pending').length || 0
  const processingOrders = allStats.orders?.filter((o: any) => o.status === 'processing').length || 0
  const completedOrders = allStats.orders?.filter((o: any) => o.status === 'delivered').length || 0
  const totalRevenue = allStats.orders?.reduce((sum: number, order: any) => {
    return order.payment_status === 'paid' ? sum + Number(order.total_amount) : sum
  }, 0) || 0

  const buildUrl = (p: number) => {
    const params = new URLSearchParams()
    if (searchParams.status) params.set('status', searchParams.status)
    if (searchParams.payment_status) params.set('payment_status', searchParams.payment_status)
    if (searchParams.search) params.set('search', searchParams.search)
    if (p > 1) params.set('page', String(p))
    const qs = params.toString()
    return `/admin/orders${qs ? `?${qs}` : ''}`
  }

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold text-secondary-500 dark:text-foreground">Orders</h1>
        <p className="text-foreground-secondary mt-1 text-sm">Manage customer orders</p>
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
            ],
          },
        ]}
        searchPlaceholder="Search by order number or customer..."
        searchParam="search"
      />

      <div className="md:hidden space-y-3">
        {orders && orders.length > 0 ? (
          orders.map((order: any) => (
            <Link
              key={order.id}
              href={`/admin/orders/${order.id}`}
              className="block bg-surface-elevated rounded-lg shadow-sm border border-border-default p-4 active:bg-surface-secondary transition-colors"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-semibold text-foreground">
                  #{order.order_number || order.id.slice(0, 8)}
                </span>
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
                  {order.users ? `${order.users.first_name || ''} ${order.users.last_name || ''}`.trim() || 'Guest' : 'Guest'}
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
            </Link>
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
                <th className="px-6 py-3 text-left text-xs font-medium text-foreground-muted uppercase tracking-wider">Order ID</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-foreground-muted uppercase tracking-wider">Customer</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-foreground-muted uppercase tracking-wider">Date</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-foreground-muted uppercase tracking-wider">Total</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-foreground-muted uppercase tracking-wider">Payment</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-foreground-muted uppercase tracking-wider">Status</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-foreground-muted uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-default">
              {orders && orders.length > 0 ? (
                orders.map((order: any) => (
                  <tr key={order.id} className="hover:bg-surface-secondary">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-medium text-foreground">#{order.order_number || order.id.slice(0, 8)}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-foreground">
                        {order.users ? `${order.users.first_name || ''} ${order.users.last_name || ''}`.trim() || 'Guest' : 'Guest'}
                      </div>
                      <div className="text-xs text-foreground-muted">{order.users?.email || order.billing_email}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-foreground">{new Date(order.created_at).toLocaleDateString('en-IN')}</div>
                      <div className="text-xs text-foreground-muted">{new Date(order.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-semibold text-foreground">
                        Rs. {Number(order.total_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                        order.payment_status === 'paid' ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300'
                        : order.payment_status === 'pending' ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300'
                        : 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300'
                      }`}>
                        {order.payment_status}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                        order.status === 'delivered' ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300'
                        : order.status === 'processing' || order.status === 'shipped' ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300'
                        : order.status === 'out_for_delivery' ? 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-800 dark:text-indigo-300'
                        : order.status === 'cancelled' ? 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300'
                        : order.status === 'cancel_requested' ? 'bg-orange-100 dark:bg-orange-900/30 text-orange-800 dark:text-orange-300'
                        : 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300'
                      }`}>
                        {order.status === 'cancel_requested' ? 'Cancel Requested' : order.status === 'out_for_delivery' ? 'Out for Delivery' : order.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <Link href={`/admin/orders/${order.id}`} className="text-accent-500 hover:text-accent-600">View Details</Link>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-foreground-muted">No orders found.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="px-6 py-3 border-t border-border-default">
          <Pagination page={page} total={total} pageSize={PAGE_SIZE} buildUrl={buildUrl} />
        </div>
      </div>
    </div>
  )
}
