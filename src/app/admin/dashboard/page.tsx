import { getDashboardMetrics, getDashboardAnalytics } from '@/lib/queries'
import { queryMany } from '@/lib/db'
import { headers, cookies } from 'next/headers'
import { verifyToken } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import Link from 'next/link'
import SupportRequestsAlert from '@/components/admin/SupportRequestsAlert'
import AnalyticsDashboardClient from './_components/AnalyticsDashboardClient'
import QuickActionBar from './_components/QuickActionBar'
import PendingTasksCard from './_components/PendingTasksCard'
import CollapsibleSection from '@/components/admin/CollapsibleSection'
import { ap } from '@/lib/admin-path'
import { getHost } from '@/lib/get-host'
import { adminCookieName } from '@/lib/admin-cookie'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// `icon` is a NAV_ICONS key shared with the sidebar; `scope` gates each tile like the sidebar does.
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

type Tone = 'amber' | 'red'
interface Alert {
  label: string
  count: number
  tone: Tone
  path: string
  scope?: string
  group: string
}

function AlertChip({ label, count, tone, href }: { label: string; count: number; tone: Tone; href: string }) {
  const tones = {
    amber: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 hover:bg-amber-500/15',
    red: 'bg-red-500/10 text-red-700 dark:text-red-400 hover:bg-red-500/15',
  }
  const dots = { amber: 'bg-amber-500', red: 'bg-red-500' }
  return (
    <Link
      href={href}
      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium shrink-0 transition-colors ${tones[tone]}`}
    >
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

// Overdue first, then urgent to low, then soonest due.
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
               ct.created_at DESC`,
    [adminId]
  )
}

export default async function AdminDashboard() {
  const headersList = await headers()
  const cookieStore = await cookies()
  const token = cookieStore.get(await adminCookieName())?.value
  let displayName = headersList.get('x-username') || 'Admin'
  let role = headersList.get('x-user-role') || ''
  let adminId = headersList.get('x-user-id') || ''
  let scopes: string[] = []
  try {
    scopes = JSON.parse(headersList.get('x-user-scopes') || '[]')
  } catch {
    scopes = []
  }
  if (token) {
    try {
      const payload = (await verifyToken(token)) as {
        adminId?: string
        displayName?: string
        role?: string
        scopes?: string[]
      } | null
      if (payload?.displayName) displayName = payload.displayName
      if (!role && payload?.role) role = payload.role
      if (!adminId && payload?.adminId) adminId = payload.adminId
      if (scopes.length === 0 && Array.isArray(payload?.scopes)) scopes = payload!.scopes as string[]
    } catch {
      /* fall back to x-username */
    }
  }
  const host = await getHost()
  const can = (scope: string) => hasScope(role, scopes, scope)
  const [metrics, analytics] = await Promise.all([getDashboardMetrics(), getDashboardAnalytics('30d')])
  const a = analytics.insights.attention

  const visibleQuick = QUICK_ACTIONS.filter(x => can(x.scope))
  const visibleMore = MORE_ACTIONS.filter(x => can(x.scope))

  const canSeeTasks = can('tasks:read')
  const myTasks = canSeeTasks ? await getMyPendingTasks(adminId) : []

  // Session scopes are already narrowed to the plan, so a chip never links into a module this admin cannot open.
  const candidates: Alert[] = [
    {
      group: 'Orders',
      label: 'pending orders',
      count: metrics.funnel.pending,
      tone: 'amber',
      path: '/admin/orders?status=pending',
    },
    {
      group: 'Orders',
      label: 'pending over 24 h',
      count: a.pendingOver24h,
      tone: 'red',
      path: '/admin/orders?status=pending',
    },
    {
      group: 'Orders',
      label: 'unshipped over 48 h',
      count: a.unshippedOver48h,
      tone: 'red',
      path: '/admin/orders?status=processing',
    },
    {
      group: 'Orders',
      label: 'cancel requests',
      count: a.cancelRequested,
      tone: 'amber',
      path: '/admin/orders?status=cancel_requested',
    },
    {
      group: 'Orders',
      label: 'delivery attempted',
      count: a.deliveryAttempted,
      tone: 'amber',
      path: '/admin/orders?status=out_for_delivery',
    },
    { group: 'Orders', label: 'unpaid online orders', count: a.unpaidOnline, tone: 'amber', path: '/admin/orders' },
    {
      group: 'Stock',
      label: 'low stock',
      count: analytics.inventory.lowStock,
      tone: 'amber',
      path: '/admin/inventory',
      scope: 'inventory:read',
    },
    {
      group: 'Stock',
      label: 'out of stock',
      count: analytics.inventory.outOfStock,
      tone: 'red',
      path: '/admin/inventory',
      scope: 'inventory:read',
    },
    {
      group: 'Stock',
      label: 'selling but out of stock',
      count: a.sellingButOut,
      tone: 'red',
      path: '/admin/inventory',
      scope: 'inventory:read',
    },
    {
      group: 'Stock',
      label: 'restock within 7 days',
      count: a.restockSoon,
      tone: 'amber',
      path: '/admin/inventory',
      scope: 'inventory:read',
    },
    {
      group: 'Stock',
      label: 'batches expiring in 30 days',
      count: a.expiringBatches,
      tone: 'amber',
      path: '/admin/inventory',
      scope: 'inventory:read',
    },
    {
      group: 'Stock',
      label: 'expired batches',
      count: a.expiredBatches,
      tone: 'red',
      path: '/admin/inventory',
      scope: 'inventory:read',
    },
    {
      group: 'Stock',
      label: 'back-in-stock requests',
      count: a.backInStockWaitlist,
      tone: 'amber',
      path: '/admin/inventory',
      scope: 'inventory:read',
    },
    {
      group: 'Returns',
      label: 'open returns',
      count: a.openReturns,
      tone: 'red',
      path: '/admin/returns',
      scope: 'returns:read',
    },
    {
      group: 'Returns',
      label: 'RTO in transit',
      count: analytics.returns.rtoInTransit,
      tone: 'amber',
      path: '/admin/returns',
      scope: 'returns:read',
    },
    {
      group: 'Customers',
      label: 'open support chats',
      count: a.supportOpen,
      tone: 'amber',
      path: '/admin/crm',
      scope: 'crm:read',
    },
    {
      group: 'Customers',
      label: 'reviews awaiting approval',
      count: a.pendingReviews,
      tone: 'amber',
      path: '/admin/reviews',
      scope: 'reviews:read',
    },
    {
      group: 'Customers',
      label: 'overdue tasks',
      count: a.overdueTasks,
      tone: 'red',
      path: '/admin/tasks',
      scope: 'tasks:read',
    },
    {
      group: 'Customers',
      label: 'high churn risk',
      count: a.churnHigh,
      tone: 'amber',
      path: '/admin/crm',
      scope: 'crm:read',
    },
    {
      group: 'Business',
      label: 'pending RFQs',
      count: a.pendingRfqs,
      tone: 'amber',
      path: '/admin/business/rfqs',
      scope: 'business_rfqs:read',
    },
    {
      group: 'Business',
      label: 'overdue bills',
      count: a.overdueBills,
      tone: 'red',
      path: '/admin/financial',
      scope: 'financial:read',
    },
  ]
  const alerts = candidates.filter(x => x.count > 0 && (!x.scope || can(x.scope)))
  const groups = Array.from(new Set(alerts.map(x => x.group)))

  const opsBlock = (
    <div className="space-y-4">
      <SupportRequestsAlert />
      <QuickActionBar primary={visibleQuick} more={visibleMore} host={host} />
    </div>
  )

  const footerBlock = (
    <div className="space-y-4">
      {canSeeTasks && <PendingTasksCard tasks={myTasks} viewAllHref={ap('/admin/tasks', host)} />}

      <CollapsibleSection
        title="Needs Attention"
        count={alerts.length}
        className="bg-surface-elevated rounded-xl ring-1 ring-border-default/70 dark:ring-white/5 shadow-sm dark:shadow-none p-5"
      >
        {alerts.length > 0 ? (
          <div className="space-y-3">
            {groups.map(g => (
              <div key={g} className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-foreground-muted w-20 shrink-0">
                  {g}
                </span>
                {alerts
                  .filter(x => x.group === g)
                  .map(x => (
                    <AlertChip key={x.label} label={x.label} count={x.count} tone={x.tone} href={ap(x.path, host)} />
                  ))}
              </div>
            ))}
          </div>
        ) : (
          <div className="flex items-center gap-2.5 py-1 text-foreground-muted">
            <span className="w-8 h-8 rounded-lg flex items-center justify-center bg-green-500/10 text-green-600 dark:text-green-400 shrink-0">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </span>
            <span className="text-sm">All clear. Nothing needs your attention right now.</span>
          </div>
        )}
      </CollapsibleSection>
    </div>
  )

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <AnalyticsDashboardClient
        initial={analytics}
        metrics={metrics}
        host={host}
        username={displayName}
        ops={opsBlock}
        footer={footerBlock}
      />
    </div>
  )
}
