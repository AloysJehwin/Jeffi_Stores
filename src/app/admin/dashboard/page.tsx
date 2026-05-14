import { getDashboardStats, getDashboardMetrics } from '@/lib/queries'
import { headers } from 'next/headers'
import Link from 'next/link'
import SupportRequestsAlert from '@/components/admin/SupportRequestsAlert'

export const dynamic = 'force-dynamic'
export const revalidate = 0

function PctBadge({ value }: { value: number | null }) {
  if (value === null) return <span className="text-xs text-foreground-muted">—</span>
  const up = value >= 0
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-semibold ${up ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'}`}>
      <svg className={`w-3 h-3 ${up ? '' : 'rotate-180'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 10l7-7m0 0l7 7m-7-7v18" />
      </svg>
      {Math.abs(value)}%
    </span>
  )
}

function StatCard({ label, value, sub, pct, icon, color }: {
  label: string
  value: string
  sub?: string
  pct?: number | null
  icon: React.ReactNode
  color: string
}) {
  return (
    <div className="bg-surface-elevated rounded-xl border border-border-default p-5 flex flex-col gap-3">
      <div className="flex items-start justify-between">
        <div className={`p-2.5 rounded-lg ${color}`}>{icon}</div>
        {pct !== undefined && <PctBadge value={pct ?? null} />}
      </div>
      <div>
        <p className="text-xs text-foreground-muted uppercase tracking-wide font-medium">{label}</p>
        <p className="text-2xl sm:text-3xl font-bold text-foreground mt-1 leading-none">{value}</p>
        {sub && <p className="text-xs text-foreground-muted mt-1">{sub}</p>}
      </div>
    </div>
  )
}

function statusBadgeClass(status: string) {
  if (status === 'delivered') return 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
  if (status === 'processing' || status === 'confirmed') return 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
  if (status === 'shipped') return 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300'
  if (status === 'out_for_delivery') return 'bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300'
  if (status === 'cancelled') return 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'
  if (status === 'cancel_requested') return 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300'
  return 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300'
}

function statusLabel(s: string) {
  if (s === 'out_for_delivery') return 'Out for Delivery'
  if (s === 'cancel_requested') return 'Cancel Req.'
  return s.replace(/_/g, ' ')
}

export default async function AdminDashboard() {
  const headersList = headers()
  const username = headersList.get('x-username') || 'Admin'

  const [stats, metrics] = await Promise.all([
    getDashboardStats(),
    getDashboardMetrics(),
  ])

  const totalRevenue = metrics.revenue.total
  const onlinePct = totalRevenue > 0 ? Math.round((metrics.revenue.online / totalRevenue) * 100) : 0
  const offlinePct = 100 - onlinePct

  const funnelTotal = metrics.funnel.pending + metrics.funnel.processing + metrics.funnel.shipped + metrics.funnel.outForDelivery + metrics.funnel.delivered + metrics.funnel.cancelled
  const funnelSteps = [
    { label: 'Pending', value: metrics.funnel.pending, color: 'bg-yellow-400 dark:bg-yellow-500' },
    { label: 'Processing', value: metrics.funnel.processing, color: 'bg-blue-400 dark:bg-blue-500' },
    { label: 'Shipped', value: metrics.funnel.shipped, color: 'bg-indigo-400 dark:bg-indigo-500' },
    { label: 'Out for Delivery', value: metrics.funnel.outForDelivery, color: 'bg-violet-400 dark:bg-violet-500' },
    { label: 'Delivered', value: metrics.funnel.delivered, color: 'bg-green-400 dark:bg-green-500' },
    { label: 'Cancelled', value: metrics.funnel.cancelled, color: 'bg-red-400 dark:bg-red-500' },
  ]

  const topProductsMax = metrics.topProducts.reduce((m, p) => Math.max(m, p.qty), 1)

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Welcome back, {username}</h1>
          <p className="text-sm text-foreground-muted mt-0.5">Here is what is happening this month.</p>
        </div>
        <Link href="/admin/orders/new" className="hidden sm:inline-flex items-center gap-2 px-4 py-2 bg-accent-500 hover:bg-accent-600 text-white text-sm font-medium rounded-lg transition-colors">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          New Invoice
        </Link>
      </div>

      <SupportRequestsAlert />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Revenue (This Month)"
          value={`Rs ${metrics.revenue.thisMonth.toLocaleString('en-IN')}`}
          sub={`Last month: Rs ${metrics.revenue.lastMonth.toLocaleString('en-IN')}`}
          pct={metrics.revenue.pctChange}
          color="bg-emerald-100 dark:bg-emerald-900/30"
          icon={
            <svg className="w-5 h-5 text-emerald-600 dark:text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
        />
        <StatCard
          label="Today's Revenue"
          value={`Rs ${metrics.revenue.today.toLocaleString('en-IN')}`}
          sub={`Yesterday: Rs ${metrics.revenue.yesterday.toLocaleString('en-IN')}`}
          pct={metrics.revenue.todayPct}
          color="bg-blue-100 dark:bg-blue-900/30"
          icon={
            <svg className="w-5 h-5 text-blue-600 dark:text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
            </svg>
          }
        />
        <StatCard
          label="Orders (This Month)"
          value={metrics.orders.thisMonth.toString()}
          sub={`Last month: ${metrics.orders.lastMonth}`}
          pct={metrics.orders.pctChange}
          color="bg-violet-100 dark:bg-violet-900/30"
          icon={
            <svg className="w-5 h-5 text-violet-600 dark:text-violet-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
            </svg>
          }
        />
        <StatCard
          label="Total Customers"
          value={stats.totalCustomers.toString()}
          sub={stats.lowStockProducts > 0 ? `${stats.lowStockProducts} products low stock` : `${stats.totalProducts} products active`}
          color="bg-orange-100 dark:bg-orange-900/30"
          icon={
            <svg className="w-5 h-5 text-orange-600 dark:text-orange-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          }
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="bg-surface-elevated rounded-xl border border-border-default p-5 space-y-4">
          <h2 className="text-sm font-semibold text-foreground uppercase tracking-wide">Revenue Split</h2>
          <div>
            <div className="flex justify-between text-xs text-foreground-muted mb-1.5">
              <span>Online</span>
              <span>Offline</span>
            </div>
            <div className="flex h-3 rounded-full overflow-hidden bg-surface-secondary gap-0.5">
              <div className="bg-blue-500 rounded-l-full transition-all" style={{ width: `${onlinePct}%` }} />
              <div className="bg-purple-500 rounded-r-full transition-all" style={{ width: `${offlinePct}%` }} />
            </div>
            <div className="flex justify-between mt-2">
              <div>
                <p className="text-xs text-foreground-muted">Online</p>
                <p className="text-base font-bold text-foreground">Rs {metrics.revenue.online.toLocaleString('en-IN')}</p>
                <p className="text-xs text-blue-600 dark:text-blue-400 font-medium">{onlinePct}%</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-foreground-muted">Offline</p>
                <p className="text-base font-bold text-foreground">Rs {metrics.revenue.offline.toLocaleString('en-IN')}</p>
                <p className="text-xs text-purple-600 dark:text-purple-400 font-medium">{offlinePct}%</p>
              </div>
            </div>
          </div>
          <div className="pt-3 border-t border-border-default">
            <div className="flex items-baseline justify-between">
              <p className="text-xs text-foreground-muted">Total collected</p>
              <p className="text-lg font-bold text-foreground">Rs {totalRevenue.toLocaleString('en-IN')}</p>
            </div>
          </div>
        </div>

        <div className="bg-surface-elevated rounded-xl border border-border-default p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground uppercase tracking-wide">Order Funnel</h2>
            <span className="text-xs text-foreground-muted">{funnelTotal} total</span>
          </div>
          <div className="space-y-2.5">
            {funnelSteps.map(step => {
              const pct = funnelTotal > 0 ? Math.max(4, Math.round((step.value / funnelTotal) * 100)) : 4
              return (
                <div key={step.label} className="flex items-center gap-3">
                  <span className="text-xs text-foreground-muted w-28 shrink-0">{step.label}</span>
                  <div className="flex-1 h-2 bg-surface-secondary rounded-full overflow-hidden">
                    <div className={`h-full rounded-full transition-all ${step.color}`} style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-xs font-semibold text-foreground w-7 text-right">{step.value}</span>
                </div>
              )
            })}
          </div>
          <div className="pt-2 border-t border-border-default">
            <Link href="/admin/orders" className="text-xs text-accent-500 font-medium hover:text-accent-600">
              View all orders →
            </Link>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="bg-surface-elevated rounded-xl border border-border-default p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground uppercase tracking-wide">Top Products</h2>
            <span className="text-xs text-foreground-muted">This month</span>
          </div>
          {metrics.topProducts.length > 0 ? (
            <div className="space-y-3">
              {metrics.topProducts.map((p, i) => (
                <div key={p.id} className="flex items-center gap-3">
                  <span className="text-xs font-bold text-foreground-muted w-4 shrink-0">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-foreground truncate">{p.name}</p>
                    <div className="mt-1 h-1.5 bg-surface-secondary rounded-full overflow-hidden">
                      <div
                        className="h-full bg-accent-500 rounded-full"
                        style={{ width: `${Math.round((p.qty / topProductsMax) * 100)}%` }}
                      />
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs font-semibold text-foreground">{p.qty} units</p>
                    <p className="text-xs text-foreground-muted">Rs {p.revenue.toLocaleString('en-IN')}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-foreground-muted">No sales this month yet.</p>
          )}
        </div>

        <div className="lg:col-span-2 bg-surface-elevated rounded-xl border border-border-default p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-foreground uppercase tracking-wide">Recent Orders</h2>
            <Link href="/admin/orders" className="text-xs text-accent-500 font-medium hover:text-accent-600">View all →</Link>
          </div>
          {metrics.recentOrders.length > 0 ? (
            <>
              <div className="hidden md:block overflow-x-auto">
                <table className="min-w-full">
                  <thead>
                    <tr className="border-b border-border-default">
                      <th className="pb-2 text-left text-xs font-medium text-foreground-muted">Order</th>
                      <th className="pb-2 text-left text-xs font-medium text-foreground-muted">Customer</th>
                      <th className="pb-2 text-left text-xs font-medium text-foreground-muted">Amount</th>
                      <th className="pb-2 text-left text-xs font-medium text-foreground-muted">Status</th>
                      <th className="pb-2 text-left text-xs font-medium text-foreground-muted">Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-default">
                    {metrics.recentOrders.map((order: any) => (
                      <tr key={order.id} className="hover:bg-surface-secondary">
                        <td className="py-2.5 pr-3">
                          <Link href={`/admin/orders/${order.id}`} className="text-xs font-medium text-accent-500 hover:text-accent-600">
                            #{order.order_number || order.id.slice(0, 8)}
                          </Link>
                        </td>
                        <td className="py-2.5 pr-3 text-xs text-foreground truncate max-w-[120px]">
                          {order.users?.first_name
                            ? `${order.users.first_name} ${order.users.last_name || ''}`.trim()
                            : order.customer_name || 'Guest'}
                        </td>
                        <td className="py-2.5 pr-3 text-xs font-semibold text-foreground">
                          Rs {Number(order.total_amount).toLocaleString('en-IN')}
                        </td>
                        <td className="py-2.5 pr-3">
                          <span className={`px-2 py-0.5 text-xs font-semibold rounded-full ${statusBadgeClass(order.status)}`}>
                            {statusLabel(order.status)}
                          </span>
                        </td>
                        <td className="py-2.5 text-xs text-foreground-muted">
                          {new Date(order.created_at).toLocaleDateString('en-IN')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="md:hidden space-y-2">
                {metrics.recentOrders.map((order: any) => (
                  <Link
                    key={order.id}
                    href={`/admin/orders/${order.id}`}
                    className="block p-3 rounded-lg border border-border-default hover:bg-surface-secondary transition-colors"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium text-foreground">#{order.order_number || order.id.slice(0, 8)}</span>
                      <span className={`px-2 py-0.5 text-xs font-semibold rounded-full ${statusBadgeClass(order.status)}`}>
                        {statusLabel(order.status)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-foreground-muted">{order.customer_name || 'Guest'}</span>
                      <span className="text-xs font-semibold text-foreground">Rs {Number(order.total_amount).toLocaleString('en-IN')}</span>
                    </div>
                  </Link>
                ))}
              </div>
            </>
          ) : (
            <p className="text-xs text-foreground-muted py-4 text-center">No orders yet.</p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { href: '/admin/products/add', label: 'Add Product', color: 'text-indigo-600 dark:text-indigo-400', bg: 'hover:bg-indigo-50 dark:hover:bg-indigo-900/20 hover:border-indigo-400', icon: <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /> },
          { href: '/admin/categories', label: 'Categories', color: 'text-green-600 dark:text-green-400', bg: 'hover:bg-green-50 dark:hover:bg-green-900/20 hover:border-green-400', icon: <path strokeLinecap="round" strokeLinejoin="round" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" /> },
          { href: '/admin/orders', label: 'All Orders', color: 'text-yellow-600 dark:text-yellow-400', bg: 'hover:bg-yellow-50 dark:hover:bg-yellow-900/20 hover:border-yellow-400', icon: <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /> },
          { href: '/admin/orders/new', label: 'Offline Invoice', color: 'text-purple-600 dark:text-purple-400', bg: 'hover:bg-purple-50 dark:hover:bg-purple-900/20 hover:border-purple-400', icon: <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /> },
        ].map(action => (
          <Link
            key={action.href}
            href={action.href}
            className={`flex items-center gap-2.5 p-3.5 border border-border-default rounded-xl transition-colors ${action.bg}`}
          >
            <svg className={`w-5 h-5 shrink-0 ${action.color}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              {action.icon}
            </svg>
            <span className="text-sm font-medium text-foreground">{action.label}</span>
          </Link>
        ))}
      </div>
    </div>
  )
}
