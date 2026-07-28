import { getDashboardStats, getDashboardMetrics, getDashboardAnalytics } from '@/lib/queries'
import { headers } from 'next/headers'
import Link from 'next/link'
import SupportRequestsAlert from '@/components/admin/SupportRequestsAlert'
import AnalyticsDashboardClient from '@/components/admin/dashboard/AnalyticsDashboardClient'
import { ap } from '@/lib/admin-path'
import { getHost } from '@/lib/get-host'

export const dynamic = 'force-dynamic'
export const revalidate = 0

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
  const headersList = await headers()
  const username = headersList.get('x-username') || 'Admin'
  const host = await getHost()
  const [stats, metrics, analytics] = await Promise.all([
    getDashboardStats(),
    getDashboardMetrics(),
    getDashboardAnalytics('30d'),
  ])

  const funnelTotal = metrics.funnel.pending + metrics.funnel.processing + metrics.funnel.shipped + metrics.funnel.outForDelivery + metrics.funnel.delivered + metrics.funnel.cancelled
  const funnelSteps = [
    { label: 'Pending', value: metrics.funnel.pending, color: 'bg-yellow-400 dark:bg-yellow-500', status: 'pending' },
    { label: 'Processing', value: metrics.funnel.processing, color: 'bg-blue-400 dark:bg-blue-500', status: 'processing' },
    { label: 'Shipped', value: metrics.funnel.shipped, color: 'bg-indigo-400 dark:bg-indigo-500', status: 'shipped' },
    { label: 'Out for Delivery', value: metrics.funnel.outForDelivery, color: 'bg-violet-400 dark:bg-violet-500', status: 'out_for_delivery' },
    { label: 'Delivered', value: metrics.funnel.delivered, color: 'bg-green-400 dark:bg-green-500', status: 'delivered' },
    { label: 'Cancelled', value: metrics.funnel.cancelled, color: 'bg-red-400 dark:bg-red-500', status: 'cancelled' },
  ]

  const topProductsMax = metrics.topProducts.reduce((m, p) => Math.max(m, p.qty), 1)

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Welcome back, {username}</h1>
          <p className="text-sm text-foreground-muted mt-0.5">Store analytics at a glance.</p>
        </div>
      </div>

      <SupportRequestsAlert />

      {/* Interactive commerce analytics (range-aware KPIs, trend, splits, inventory) */}
      <AnalyticsDashboardClient initial={analytics} />

      {/* Order funnel + Top products (all-time snapshot) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="bg-surface-elevated rounded-xl border border-border-default p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground uppercase tracking-wide">Order Funnel</h2>
            <span className="text-xs text-foreground-muted">{funnelTotal} total</span>
          </div>
          <div className="space-y-2.5">
            {funnelSteps.map(step => {
              const pct = funnelTotal > 0 ? Math.max(4, Math.round((step.value / funnelTotal) * 100)) : 4
              return (
                <Link
                  key={step.label}
                  href={ap(`/admin/orders?status=${step.status}`, host)}
                  className="flex items-center gap-3 group rounded-md px-1 -mx-1 hover:bg-surface-secondary transition-colors"
                >
                  <span className="text-xs text-foreground-muted w-28 shrink-0 group-hover:text-foreground transition-colors">{step.label}</span>
                  <div className="flex-1 h-2 bg-surface-secondary rounded-full overflow-hidden">
                    <div className={`h-full rounded-full transition-all ${step.color}`} style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-xs font-semibold text-foreground w-7 text-right group-hover:text-accent-500 transition-colors">{step.value}</span>
                </Link>
              )
            })}
          </div>
          <div className="pt-2 border-t border-border-default">
            <Link href={ap('/admin/orders', host)} className="text-xs text-accent-500 font-medium hover:text-accent-600">
              View all orders →
            </Link>
          </div>
        </div>

        <div className="bg-surface-elevated rounded-xl border border-border-default p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground uppercase tracking-wide">Top Products</h2>
            <Link href={ap('/admin/products', host)} className="text-xs text-accent-500 font-medium hover:text-accent-600">View all →</Link>
          </div>
          {metrics.topProducts.length > 0 ? (
            <div className="space-y-3">
              {metrics.topProducts.map((p, i) => (
                <Link key={p.id} href={ap(`/admin/products/edit/${p.id}`, host)} className="flex items-center gap-3 group rounded-md px-1 -mx-1 hover:bg-surface-secondary transition-colors">
                  <span className="text-xs font-bold text-foreground-muted w-4 shrink-0">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-foreground truncate group-hover:text-accent-500 transition-colors">{p.name}</p>
                    <div className="mt-1 h-1.5 bg-surface-secondary rounded-full overflow-hidden">
                      <div className="h-full bg-accent-500 rounded-full" style={{ width: `${Math.round((p.qty / topProductsMax) * 100)}%` }} />
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs font-semibold text-foreground">{p.qty} units</p>
                    <p className="text-xs text-foreground-muted">Rs {p.revenue.toLocaleString('en-IN')}</p>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <p className="text-xs text-foreground-muted">No sales this month yet.</p>
          )}
        </div>

        <div className="bg-surface-elevated rounded-xl border border-border-default p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-foreground uppercase tracking-wide">Recent Orders</h2>
            <Link href={ap('/admin/orders', host)} className="text-xs text-accent-500 font-medium hover:text-accent-600">View all →</Link>
          </div>
          {metrics.recentOrders.length > 0 ? (
            <div className="space-y-2">
              {metrics.recentOrders.map((order: any) => (
                <Link
                  key={order.id}
                  href={ap(`/admin/orders/${order.id}`, host)}
                  className="block p-2.5 rounded-lg border border-border-default hover:bg-surface-secondary transition-colors"
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium text-accent-500">#{order.order_number || order.id.slice(0, 8)}</span>
                    <span className={`px-2 py-0.5 text-xs font-semibold rounded-full ${statusBadgeClass(order.status)}`}>
                      {statusLabel(order.status)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-foreground-muted truncate max-w-[120px]">
                      {order.users?.first_name ? `${order.users.first_name} ${order.users.last_name || ''}`.trim() : order.customer_name || 'Guest'}
                    </span>
                    <span className="text-xs font-semibold text-foreground">Rs {Number(order.total_amount).toLocaleString('en-IN')}</span>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <p className="text-xs text-foreground-muted py-4 text-center">No orders yet.</p>
          )}
        </div>
      </div>
    </div>
  )
}
