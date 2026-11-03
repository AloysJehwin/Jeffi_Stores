import { StatusBadge, type StatusMap } from '@/components/admin/kit/status'
import type { EcomRow } from '@controller/lib/ecom/rows'
import type { TenantFleet } from '@controller/lib/ecom/fleet'

// Formatters and cells shared by every Ecom Store list and detail page (server or client).

const n = (v: unknown) => (v == null || v === '' ? null : Number(v))

export const inr = (v: unknown, digits = 0) => {
  const x = n(v)
  if (x == null || Number.isNaN(x)) return '—'
  return (x < 0 ? '−₹' : '₹') + Math.abs(x).toLocaleString('en-IN', { maximumFractionDigits: digits, minimumFractionDigits: digits })
}
export const inrHr = (v: unknown) => (n(v) == null ? '—' : `${inr(v, 2)}/h`)

export const bytes = (v: unknown) => {
  const x = n(v)
  if (!x) return '—'
  const u = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(u.length - 1, Math.floor(Math.log(x) / Math.log(1024)))
  return `${(x / 1024 ** i).toFixed(i ? 1 : 0)} ${u[i]}`
}

export const dateIN = (v: string | null | undefined) => (v ? new Date(v).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—')
export const dateTimeIN = (v: string | null | undefined) =>
  v ? new Date(v).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'

export const TENANT_STATUS: StatusMap = {
  active: { label: 'Active', tone: 'green' },
  provisioning: { label: 'Provisioning', tone: 'amber' },
  pending_approval: { label: 'Pending approval', tone: 'amber' },
  awaiting_payment: { label: 'Awaiting payment', tone: 'blue' },
  suspended: { label: 'Suspended', tone: 'red' },
  rejected: { label: 'Rejected', tone: 'red' },
  terminated: { label: 'Terminated', tone: 'muted' },
}

export const KYC_STATUS: StatusMap = {
  pending: { label: 'KYC pending', tone: 'amber' },
  approved: { label: 'KYC approved', tone: 'green' },
  rejected: { label: 'KYC rejected', tone: 'red' },
}

export const JOB_STATUS: StatusMap = {
  pending: { label: 'Queued', tone: 'blue' },
  running: { label: 'Running', tone: 'amber' },
  done: { label: 'Done', tone: 'green' },
  failed: { label: 'Failed', tone: 'red' },
}

export const MONEY_STATUS: StatusMap = {
  settled: { label: 'Settled', tone: 'green' },
  captured: { label: 'Captured', tone: 'blue' },
  split: { label: 'Split', tone: 'blue' },
  refunded: { label: 'Refunded', tone: 'red' },
  pending: { label: 'Pending', tone: 'amber' },
  failed: { label: 'Failed', tone: 'red' },
}

export function TenantStatus({ status }: { status: string }) {
  return <StatusBadge status={status} map={TENANT_STATUS} />
}

export const storeHost = (t: Pick<EcomRow, 'slug' | 'custom_domain'>) => t.custom_domain?.split(', ')[0] || `${t.slug}.jeffistores.in`

/** Name, host (custom domain first) and owner email. */
export function StoreCell({ t }: { t: Pick<EcomRow, 'display_name' | 'slug' | 'custom_domain' | 'owner_email' | 'isStore' | 'service_types'> }) {
  return (
    <div className="min-w-0">
      <p className="font-medium text-foreground truncate">{t.display_name}</p>
      <p className="text-xs text-foreground-muted truncate">
        {t.isStore ? storeHost(t) : `API workspace · ${(t.service_types ?? []).filter(x => x !== 'store').join(' + ') || 'none'}`}
      </p>
      {t.owner_email && <p className="text-xs text-foreground-muted truncate">{t.owner_email}</p>}
    </div>
  )
}

/** "2 servers · 7/7 pods"; amber when pods aren't all ready, "—" when the fleet is unknown. */
export function RunningCell({ fleet, known, servers }: { fleet: TenantFleet | null; known: boolean; servers: number | null }) {
  if (!known) return <span className="text-foreground-muted">—</span>
  if (!fleet || (!fleet.pods.total && !servers)) return <span className="text-foreground-muted">Nothing running</span>
  const ok = fleet.pods.ready === fleet.pods.total
  const where = fleet.placement === 'pool' ? 'shared pool' : `${servers ?? 0} server${servers === 1 ? '' : 's'}`
  return (
    <span className={ok ? 'text-foreground-secondary' : 'text-amber-600 dark:text-amber-400'}>
      {where} · {fleet.pods.ready}/{fleet.pods.total} pods
    </span>
  )
}

/** Monthly price with AWS's cost under it. */
export function CostCell({ price, aws }: { price: number | null; aws: number | null }) {
  return (
    <div className="tabular-nums">
      <p className="text-foreground-secondary">{price == null ? '—' : `${inr(price)}/mo`}</p>
      {aws != null && <p className="text-xs text-foreground-muted">AWS {inr(aws)}</p>}
    </div>
  )
}

/** This month's infra so far (estimate). */
export function SpendCell({ mtd }: { mtd: number | null }) {
  return <span className="tabular-nums text-foreground-secondary">{mtd == null ? '—' : `${inr(mtd)} est.`}</span>
}

export function PlacementCell({ fleet, known }: { fleet: TenantFleet | null; known: boolean }) {
  if (!known) return <span className="text-foreground-muted">—</span>
  if (!fleet?.placement) return <span className="text-foreground-muted">None</span>
  return <span className="text-foreground-secondary">{fleet.placement === 'pool' ? 'Shared pool' : 'Own server'}</span>
}

/** Server types grouped, e.g. "t4g.medium × 2 · running". */
export function ServersCell({ fleet, known }: { fleet: TenantFleet | null; known: boolean }) {
  if (!known) return <span className="text-foreground-muted">—</span>
  const servers = fleet?.servers ?? []
  if (!servers.length) return <span className="text-foreground-muted">{fleet?.placement === 'pool' ? 'Pool' : 'None'}</span>
  const byType = new Map<string, number>()
  for (const s of servers) byType.set(s.type, (byType.get(s.type) ?? 0) + 1)
  const states = [...new Set(servers.map(s => s.state))].join(', ')
  return (
    <span className="text-foreground-secondary">
      {[...byType].map(([t, c]) => (c > 1 ? `${t} × ${c}` : t)).join(', ')} · {states}
    </span>
  )
}

/** Placeholder note shown where live fleet data would be (outside the cluster). */
export const FLEET_UNKNOWN = 'Live servers and pods are read from the cluster; unavailable here.'
