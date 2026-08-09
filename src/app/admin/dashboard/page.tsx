import { getDashboardStats, getDashboardMetrics, getDashboardAnalytics } from '@/lib/queries'
import { queryMany } from '@/lib/db'
import { headers, cookies } from 'next/headers'
import { verifyToken } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import Link from 'next/link'
import SupportRequestsAlert from '@/components/admin/SupportRequestsAlert'
import AnalyticsDashboardClient from '@/components/admin/dashboard/AnalyticsDashboardClient'
import QuickActionBar from '@/components/admin/dashboard/QuickActionBar'
import { ap } from '@/lib/admin-path'
import { getHost } from '@/lib/get-host'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// Quick-action command bar. `icon` is a key into NAV_ICONS (shared with the
// sidebar) so the tiles use the same iconography. `primary` = accent chip.
// `scope` gates each action to the admin's permissions (same model as the
// sidebar). `icon` is a NAV_ICONS key shared with the sidebar; `primary` = accent.
const QUICK_ACTIONS: { label: string; icon: string; path: string; scope: string; primary?: boolean }[] = [
  { label: 'New Product', path: '/admin/products/add', icon: 'Products', scope: 'products:write', primary: true },
  { label: 'Cash Sale', path: '/admin/cash-sale', icon: 'Cash Sale', scope: 'invoices:write' },
  { label: 'Quotation', path: '/admin/quotations', icon: 'Quotations', scope: 'quotations:read' },
  { label: 'New PO', path: '/admin/inventory/po/new', icon: 'Inventory', scope: 'inventory:write' },
  { label: 'Orders', path: '/admin/orders', icon: 'Orders', scope: 'orders:read' },
  { label: 'Packing Slips', path: '/admin/packing-slips', icon: 'Packing Slips', scope: 'packing_slips:read' },
  { label: 'Returns', path: '/admin/returns', icon: 'Returns', scope: 'orders:read' },
  { label: 'GST', path: '/admin/gst', icon: 'GST Compliance', scope: 'gst:read' },
]

const MORE_ACTIONS: { label: string; path: string; icon: string; scope: string }[] = [
  { label: 'Labels', path: '/admin/labels', icon: 'Labels', scope: 'labels:read' },
  { label: 'Inventory', path: '/admin/inventory', icon: 'Inventory', scope: 'inventory:read' },
  { label: 'Coupons', path: '/admin/coupons/add', icon: 'Coupons', scope: 'coupons:write' },
  { label: 'Campaign', path: '/admin/campaigns/new', icon: 'Campaigns', scope: 'mailer:write' },
  { label: 'Financial', path: '/admin/financial', icon: 'Financial', scope: 'financial:read' },
  { label: 'Customers', path: '/admin/customers', icon: 'Customers', scope: 'customers:read' },
  { label: 'CRM', path: '/admin/crm', icon: 'CRM', scope: 'customers:read' },
  { label: 'Reviews', path: '/admin/reviews', icon: 'Reviews', scope: 'reviews:read' },
  { label: 'AI Agent', path: '/admin/agent', icon: 'AI Agent', scope: 'agent:read' },
  { label: 'Traffic', path: '/admin/traffic', icon: 'Traffic', scope: 'dashboard:read' },
  { label: 'RFQs', path: '/admin/business/rfqs', icon: 'Business RFQs', scope: 'business_rfqs:read' },
  { label: 'Delhivery', path: '/admin/delhivery', icon: 'Pickup Request', scope: 'orders:read' },
  { label: 'Settings', path: '/admin/settings', icon: 'Settings', scope: 'settings:read' },
]

// Renders a status chip only when count > 0; returns null otherwise.
function AlertChip({ label, count, tone, href }: { label: string; count: number; tone: 'amber' | 'red'; href: string }) {
  if (!count) return null
  const tones = {
    amber: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 hover:bg-amber-500/15',
    red: 'bg-red-500/10 text-red-700 dark:text-red-400 hover:bg-red-500/15',
  }
  const dots = { amber: 'bg-amber-500', red: 'bg-red-500' }
  return (
    <Link href={href} className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium shrink-0 transition-colors ${tones[tone]}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${dots[tone]}`} />
      <span className="tabular-nums font-semibold">{count}</span>
      <span>{label}</span>
    </Link>
  )
}

interface PendingTask {
  id: string
  title: string
  priority: string
  due_date: string | null
  overdue: boolean
  customer_name: string | null
}

// Top open tasks assigned to the current admin — overdue first, then by
// priority (urgent→low), then soonest due. Used for the dashboard widget.
async function getMyPendingTasks(adminId: string): Promise<PendingTask[]> {
  if (!adminId) return []
  return queryMany<PendingTask>(
    `SELECT ct.id::text, ct.title, ct.priority,
            ct.due_date::text,
            (ct.due_date IS NOT NULL AND ct.due_date < CURRENT_DATE) AS overdue,
            NULLIF(TRIM(COALESCE(u.first_name,'') || ' ' || COALESCE(u.last_name,'')), '') AS customer_name
       FROM customer_tasks ct
       LEFT JOIN users u ON u.id = ct.user_id
      WHERE ct.assigned_to = $1::uuid
        AND ct.status IN ('pending', 'in_progress')
      ORDER BY (ct.due_date IS NOT NULL AND ct.due_date < CURRENT_DATE) DESC,
               CASE ct.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
               ct.due_date ASC NULLS LAST,
               ct.created_at DESC
      LIMIT 5`,
    [adminId]
  )
}

export default async function AdminDashboard() {
  const headersList = await headers()
  // Prefer the admin's full name (first + last) over the username for the greeting.
  const cookieStore = await cookies()
  const token = cookieStore.get('admin_sid')?.value
  let displayName = headersList.get('x-username') || 'Admin'
  // Role + scopes gate which quick actions are shown (same as the sidebar nav).
  // Prefer the middleware-injected, verified headers; fall back to the JWT.
  let role = headersList.get('x-user-role') || ''
  let adminId = headersList.get('x-user-id') || ''
  let scopes: string[] = []
  try { scopes = JSON.parse(headersList.get('x-user-scopes') || '[]') } catch { scopes = [] }
  if (token) {
    try {
      const payload = await verifyToken(token) as { adminId?: string; first_name?: string; last_name?: string; email?: string; role?: string; scopes?: string[] } | null
      const full = [payload?.first_name, payload?.last_name].filter(Boolean).join(' ').trim()
      if (full) displayName = full
      else displayName = displayName || 'Admin'
      if (!role && payload?.role) role = payload.role
      if (!adminId && payload?.adminId) adminId = payload.adminId
      if (scopes.length === 0 && Array.isArray(payload?.scopes)) scopes = payload!.scopes as string[]
    } catch { /* fall back to x-username */ }
  }
  const username = displayName
  const host = await getHost()
  const [stats, metrics, analytics] = await Promise.all([
    getDashboardStats(),
    getDashboardMetrics(),
    getDashboardAnalytics('30d'),
  ])

  const hasAlerts =
    metrics.funnel.pending > 0 ||
    analytics.inventory.lowStock > 0 ||
    analytics.inventory.outOfStock > 0 ||
    analytics.returns.total > 0 ||
    analytics.returns.rtoInTransit > 0

  // Only show quick actions the current admin can actually use (super_admin sees all).
  const visibleQuick = QUICK_ACTIONS.filter(a => hasScope(role, scopes, a.scope))
  const visibleMore = MORE_ACTIONS.filter(a => hasScope(role, scopes, a.scope))

  // My pending tasks — only if the admin can access the tasks/CRM area.
  const canSeeTasks = hasScope(role, scopes, 'customers:read')
  const myTasks = canSeeTasks ? await getMyPendingTasks(adminId) : []

  // B/C/D — server-static ops block, passed into the client island as children
  // so it renders between the range header and the KPIs without refetch coupling.
  const opsBlock = (
    <div className="space-y-4">
      <SupportRequestsAlert />

      {/* C. Command Bar */}
      <QuickActionBar primary={visibleQuick} more={visibleMore} host={host} />

      {/* C2. My Pending Tasks — assigned to this admin (only when they can access tasks) */}
      {canSeeTasks && (
        <div className="bg-surface-elevated rounded-xl ring-1 ring-border-default/70 dark:ring-white/5 shadow-sm dark:shadow-none p-5">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs uppercase tracking-wide text-foreground-muted font-medium">My Pending Tasks</p>
            <Link href={ap('/admin/tasks', host)} className="text-xs font-medium text-accent-600 hover:text-accent-500 transition-colors">View all</Link>
          </div>
          {myTasks.length > 0 ? (
            <ul className="divide-y divide-border-default/70">
              {myTasks.map(t => (
                <li key={t.id}>
                  <Link href={ap('/admin/tasks', host)} className="flex items-center gap-3 py-2.5 group">
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${t.priority === 'urgent' ? 'bg-red-500' : t.priority === 'high' ? 'bg-amber-500' : 'bg-foreground-muted/50'}`} />
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm text-foreground group-hover:text-accent-600 transition-colors truncate">{t.title}</span>
                      {t.customer_name && <span className="block text-xs text-foreground-muted truncate">{t.customer_name}</span>}
                    </span>
                    {t.due_date && (
                      <span className={`text-xs font-medium shrink-0 ${t.overdue ? 'text-red-600 dark:text-red-400' : 'text-foreground-muted'}`}>
                        {t.overdue ? 'Overdue' : new Date(t.due_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                      </span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <div className="flex items-center gap-2.5 py-1 text-foreground-muted">
              <span className="w-8 h-8 rounded-lg flex items-center justify-center bg-green-500/10 text-green-600 dark:text-green-400 shrink-0">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </span>
              <span className="text-sm">No pending tasks assigned to you.</span>
            </div>
          )}
        </div>
      )}

      {/* D. Needs-Attention card — always shown; empty/cleared state when nothing pending */}
      <div className="bg-surface-elevated rounded-xl ring-1 ring-border-default/70 dark:ring-white/5 shadow-sm dark:shadow-none p-5">
        <p className="text-xs uppercase tracking-wide text-foreground-muted font-medium mb-3">Needs Attention</p>
        {hasAlerts ? (
          <div className="flex gap-2 overflow-x-auto pb-1 snap-x">
            <AlertChip label="pending orders" count={metrics.funnel.pending} tone="amber" href={ap('/admin/orders?status=pending', host)} />
            <AlertChip label="low stock" count={analytics.inventory.lowStock} tone="amber" href={ap('/admin/inventory', host)} />
            <AlertChip label="out of stock" count={analytics.inventory.outOfStock} tone="red" href={ap('/admin/inventory', host)} />
            <AlertChip label="open returns" count={analytics.returns.total} tone="red" href={ap('/admin/returns', host)} />
            <AlertChip label="RTO in transit" count={analytics.returns.rtoInTransit} tone="amber" href={ap('/admin/returns', host)} />
          </div>
        ) : (
          <div className="flex items-center gap-2.5 py-1 text-foreground-muted">
            <span className="w-8 h-8 rounded-lg flex items-center justify-center bg-green-500/10 text-green-600 dark:text-green-400 shrink-0">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </span>
            <span className="text-sm">All clear — nothing needs your attention right now.</span>
          </div>
        )}
      </div>
    </div>
  )

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <AnalyticsDashboardClient initial={analytics} metrics={metrics} host={host} username={username}>
        {opsBlock}
      </AnalyticsDashboardClient>
    </div>
  )
}
