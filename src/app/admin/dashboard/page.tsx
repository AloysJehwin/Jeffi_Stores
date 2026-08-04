import { getDashboardStats, getDashboardMetrics, getDashboardAnalytics } from '@/lib/queries'
import { headers } from 'next/headers'
import Link from 'next/link'
import SupportRequestsAlert from '@/components/admin/SupportRequestsAlert'
import AnalyticsDashboardClient from '@/components/admin/dashboard/AnalyticsDashboardClient'
import MoreActionsMenu from '@/components/admin/dashboard/MoreActionsMenu'
import { ap } from '@/lib/admin-path'
import { getHost } from '@/lib/get-host'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// Quick-action command bar. `d` is an inline SVG path (no icon lib, no emoji).
// `primary` marks the two creation actions that get the accent chip treatment.
const QUICK_ACTIONS: { label: string; d: string; path: string; primary?: boolean }[] = [
  { label: 'New Product', path: '/admin/products/add', primary: true, d: 'M12 4v16m8-8H4' },
  { label: 'Cash Sale', path: '/admin/cash-sale', d: 'M9 7h6m-6 4h6m-6 4h4M6 3h12a1 1 0 011 1v17l-3-2-3 2-3-2-3 2V4a1 1 0 011-1z' },
  { label: 'Inventory', path: '/admin/inventory', d: 'M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4' },
  { label: 'New PO', path: '/admin/inventory/po/new', d: 'M3 7h11v8H3zM14 10h4l3 3v2h-7M7 18a2 2 0 100-4 2 2 0 000 4zm10 0a2 2 0 100-4 2 2 0 000 4z' },
  { label: 'Quotation', path: '/admin/quotations', d: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z' },
]

const MORE_ACTIONS: { label: string; path: string }[] = [
  { label: 'Packing Slips', path: '/admin/packing-slips' },
  { label: 'Labels', path: '/admin/labels' },
  { label: 'Campaigns', path: '/admin/campaigns' },
  { label: 'GST', path: '/admin/gst' },
  { label: 'Financial', path: '/admin/financial' },
  { label: 'CRM', path: '/admin/crm' },
  { label: 'RFQs', path: '/admin/business/rfqs' },
  { label: 'Delhivery', path: '/admin/delhivery' },
  { label: 'Settings', path: '/admin/settings' },
]

function ActionTile({ label, d, path, primary, host }: { label: string; d: string; path: string; primary?: boolean; host: string }) {
  return (
    <Link
      href={ap(path, host)}
      className="group flex flex-col items-center justify-center gap-1.5 py-3 rounded-lg text-xs font-medium text-foreground-secondary hover:bg-surface-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-elevated transition-colors duration-200"
    >
      <span className={`w-9 h-9 rounded-lg flex items-center justify-center transition-colors ${primary ? 'bg-accent-500/10 text-accent-600 group-hover:bg-accent-500 group-hover:text-white' : 'bg-surface-secondary text-foreground-secondary group-hover:text-foreground'}`}>
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d={d} />
        </svg>
      </span>
      <span className="text-center leading-tight">{label}</span>
    </Link>
  )
}

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

export default async function AdminDashboard() {
  const headersList = await headers()
  const username = headersList.get('x-username') || 'Admin'
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

  // B/C/D — server-static ops block, passed into the client island as children
  // so it renders between the range header and the KPIs without refetch coupling.
  const opsBlock = (
    <div className="space-y-4">
      <SupportRequestsAlert />

      {/* C. Command Bar */}
      <div className="bg-surface-elevated rounded-xl ring-1 ring-border-default/70 dark:ring-white/5 shadow-sm dark:shadow-none p-2">
        <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-8 gap-1">
          {QUICK_ACTIONS.map(a => (
            <ActionTile key={a.label} label={a.label} d={a.d} path={a.path} primary={a.primary} host={host} />
          ))}
          <MoreActionsMenu actions={MORE_ACTIONS} host={host} />
        </div>
      </div>

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
