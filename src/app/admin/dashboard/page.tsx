import { getDashboardStats, getRecentOrders } from '@/lib/queries'
import { headers } from 'next/headers'

export default async function AdminDashboard() {
  // Middleware already verified authentication and set user headers
  const headersList = headers()
  const username = headersList.get('x-username') || 'Admin'

  const stats = await getDashboardStats()
  const recentOrders = await getRecentOrders(5)

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="bg-surface-elevated rounded-lg shadow p-4 sm:p-6">
        <h1 className="text-3xl font-bold text-foreground">
          Welcome back, {username}
        </h1>
        <p className="text-foreground-secondary mt-2">
          Here is what is happening with your store today.
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
        {/* Total Products */}
        <div className="bg-surface-elevated rounded-lg shadow p-4 sm:p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-foreground-secondary">Total Products</p>
              <p className="text-3xl font-bold text-foreground mt-2">{stats.totalProducts}</p>
              {stats.lowStockProducts > 0 && (
                <p className="text-xs text-red-600 dark:text-red-400 mt-1">{stats.lowStockProducts} low stock</p>
              )}
            </div>
            <div className="bg-blue-100 dark:bg-blue-900/30 p-3 rounded-full">
              <svg className="w-8 h-8 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
              </svg>
            </div>
          </div>
        </div>

        {/* Total Orders */}
        <div className="bg-surface-elevated rounded-lg shadow p-4 sm:p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-foreground-secondary">Total Orders</p>
              <p className="text-3xl font-bold text-foreground mt-2">{stats.totalOrders}</p>
              {stats.pendingOrders > 0 && (
                <p className="text-xs text-yellow-600 dark:text-yellow-400 mt-1">{stats.pendingOrders} pending</p>
              )}
            </div>
            <div className="bg-green-100 dark:bg-green-900/30 p-3 rounded-full">
              <svg className="w-8 h-8 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
              </svg>
            </div>
          </div>
        </div>

        {/* Revenue */}
        <div className="bg-surface-elevated rounded-lg shadow p-4 sm:p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-foreground-secondary">Total Revenue</p>
              <p className="text-3xl font-bold text-foreground mt-2">
                Rs {stats.totalRevenue.toLocaleString('en-IN')}
              </p>
            </div>
            <div className="bg-yellow-100 dark:bg-yellow-900/30 p-3 rounded-full">
              <svg className="w-8 h-8 text-yellow-600 dark:text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
          </div>
        </div>

        {/* Customers */}
        <div className="bg-surface-elevated rounded-lg shadow p-4 sm:p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-foreground-secondary">Total Customers</p>
              <p className="text-3xl font-bold text-foreground mt-2">{stats.totalCustomers}</p>
            </div>
            <div className="bg-purple-100 dark:bg-purple-900/30 p-3 rounded-full">
              <svg className="w-8 h-8 text-purple-600 dark:text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
            </div>
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="bg-surface-elevated rounded-lg shadow p-4 sm:p-6">
        <h2 className="text-xl font-bold text-foreground mb-4">Quick Actions</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <a
            href="/admin/products/add"
            className="flex items-center gap-3 p-4 border-2 border-dashed border-border-secondary rounded-lg hover:border-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors"
          >
            <svg className="w-6 h-6 text-indigo-600 dark:text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            <span className="font-medium text-foreground-secondary">Add New Product</span>
          </a>

          <a
            href="/admin/categories"
            className="flex items-center gap-3 p-4 border-2 border-dashed border-border-secondary rounded-lg hover:border-green-500 hover:bg-green-50 dark:hover:bg-green-900/20 transition-colors"
          >
            <svg className="w-6 h-6 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
            </svg>
            <span className="font-medium text-foreground-secondary">Manage Categories</span>
          </a>

          <a
            href="/admin/orders"
            className="flex items-center gap-3 p-4 border-2 border-dashed border-border-secondary rounded-lg hover:border-yellow-500 hover:bg-yellow-50 dark:hover:bg-yellow-900/20 transition-colors"
          >
            <svg className="w-6 h-6 text-yellow-600 dark:text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            <span className="font-medium text-foreground-secondary">View Orders</span>
          </a>
        </div>
      </div>

      {/* Recent Orders */}
      <div className="bg-surface-elevated rounded-lg shadow p-4 sm:p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-foreground">Recent Orders</h2>
          <a href="/admin/orders" className="text-primary-600 dark:text-primary-400 hover:text-primary-700 text-sm font-medium">
            View All
          </a>
        </div>
        {recentOrders && recentOrders.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-border-default">
              <thead>
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-foreground-muted uppercase tracking-wider">
                    Order Number
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-foreground-muted uppercase tracking-wider">
                    Customer
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-foreground-muted uppercase tracking-wider">
                    Amount
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-foreground-muted uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-foreground-muted uppercase tracking-wider">
                    Date
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-default">
                {recentOrders.map((order) => (
                  <tr key={order.id} className="hover:bg-surface-secondary">
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-foreground">
                      {order.order_number}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-foreground">
                      {order.customer_name}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-foreground">
                      Rs {Number(order.total_amount).toLocaleString('en-IN')}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full
                        ${order.status === 'delivered' ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300' : ''}
                        ${order.status === 'pending' ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300' : ''}
                        ${order.status === 'processing' ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300' : ''}
                        ${order.status === 'cancelled' ? 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300' : ''}
                      `}>
                        {order.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-foreground-muted">
                      {new Date(order.created_at).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-center py-8 text-foreground-muted">
            <p>No orders yet</p>
            <p className="text-sm mt-2">Orders will appear here when customers place them</p>
          </div>
        )}
      </div>
    </div>
  )
}
