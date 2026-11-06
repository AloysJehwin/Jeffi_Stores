import Link from 'next/link'
import { TabLinks } from '@/components/admin/channels/ui'
import { StatusBadge, type StatusMap } from '@/components/admin/kit/status'
import { MONEY_STATUS, TENANT_STATUS } from './cells'

// Two tiles a row on a phone; four from sm (three when there are 3, 5 or 6).
const tileCols = (n: number) => (n <= 2 ? 'grid-cols-2' : n === 4 ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-2 sm:grid-cols-3')

// Headline stat card: one highlighted value and a few tiles. Server component.
export function EcomHero({
  label,
  value,
  tiles,
  note,
}: {
  label: string
  value: string
  tiles: { value: string | number; label: string }[]
  /** Small muted line under the value (e.g. why a figure is unavailable). */
  note?: string
}) {
  return (
    <div className="bg-surface-elevated rounded-xl border border-accent-500/50 p-4 sm:p-5 flex flex-col justify-between lg:min-h-[14rem] min-w-0">
      <div className="min-w-0">
        <p className="text-xs text-foreground-muted uppercase tracking-wide font-medium">{label}</p>
        <p className="text-2xl sm:text-3xl font-bold text-accent-500 tabular-nums mt-1 break-words">{value}</p>
        {note && <p className="text-xs text-foreground-muted mt-1">{note}</p>}
      </div>
      <div className={`grid ${tileCols(tiles.length)} gap-2 sm:gap-3 mt-4`}>
        {tiles.map((t, i) => (
          <div key={i} className="rounded-lg bg-surface-secondary/60 px-2.5 py-2 sm:px-3 sm:py-2.5 min-w-0">
            <p className="text-base sm:text-xl font-bold leading-tight tabular-nums text-foreground truncate">{t.value}</p>
            <p className="text-[11px] sm:text-xs text-foreground-muted mt-1 truncate">{t.label}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

// Plan-mix horizontal bar (hand-rolled, no chart lib — matches house style).
export function PlanMixChart({ mix }: { mix: { plan: string; count: number }[] }) {
  const total = mix.reduce((s, m) => s + m.count, 0) || 1
  const colors: Record<string, string> = {
    starter: 'bg-teal-500',
    basic: 'bg-sky-500',
    growth: 'bg-emerald-500',
    pro: 'bg-violet-500',
    enterprise: 'bg-amber-500',
  }
  return (
    <div className="bg-surface-elevated rounded-xl border border-border-default p-4 sm:p-5 lg:min-h-[14rem] flex flex-col min-w-0">
      <p className="text-sm font-semibold uppercase tracking-wide text-foreground mb-4">Plan mix</p>
      <div className="flex-1 flex flex-col justify-center gap-3">
        {mix.length === 0 && <p className="text-sm text-foreground-muted">No tenants yet.</p>}
        {mix.map(m => (
          <div key={m.plan}>
            <div className="flex justify-between text-xs mb-1">
              <span className="capitalize text-foreground-secondary">{m.plan}</span>
              <span className="text-foreground-muted">{m.count}</span>
            </div>
            <div className="h-2.5 rounded-full bg-surface-secondary overflow-hidden">
              <div
                className={`h-full rounded-full ${colors[m.plan] || 'bg-foreground-muted'}`}
                style={{ width: `${(m.count / total) * 100}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// Status/plan/search filter bar (client, URL-param driven).
export { default as EcomFilters } from './EcomFilters'

// Tenant, KYC, money and domain/bank statuses on one map; unknown ones fall back to a muted humanised chip.
const PILL_STATUS: StatusMap = {
  ...MONEY_STATUS,
  ...TENANT_STATUS,
  approved: { label: 'Approved', tone: 'green' },
  verified: { label: 'Verified', tone: 'green' },
}

/** Status chip for statuses reused across pages (kit StatusBadge). */
export function StatusPill({ status, map }: { status: string; map?: StatusMap }) {
  return <StatusBadge status={status} map={map ?? PILL_STATUS} />
}

export function DetailLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="text-accent-600 hover:underline">
      {children}
    </Link>
  )
}

/** Label/value pair used by every tenant detail section. */
export function Field({ label, value, wide }: { label: string; value: React.ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? 'col-span-full sm:col-span-2' : undefined}>
      <dt className="text-xs text-foreground-muted">{label}</dt>
      <dd className="text-sm text-foreground mt-0.5 min-w-0 break-words">{value ?? '-'}</dd>
    </div>
  )
}

export function Mono({ children }: { children: React.ReactNode }) {
  return <span className="font-mono text-xs break-all">{children}</span>
}

export const NOT_PROVISIONED = <span className="text-amber-500">not provisioned</span>

export function Section({
  title,
  action,
  children,
  className = '',
}: {
  title: string
  action?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={`rounded-xl border border-border-default p-4 sm:p-5 bg-surface-elevated min-w-0 ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 mb-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}

export function FieldGrid({ children }: { children: React.ReactNode }) {
  return <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 min-w-0">{children}</dl>
}

export const TENANT_TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'provisioning', label: 'Provisioning' },
  { key: 'infrastructure', label: 'Infrastructure' },
  { key: 'commerce', label: 'Commerce' },
  { key: 'shipments', label: 'Shipments' },
  { key: 'access', label: 'Access' },
  { key: 'certificates', label: 'Certificates' },
  { key: 'kyc', label: 'KYC' },
  { key: 'messaging', label: 'Messaging' },
] as const

export type TenantTab = (typeof TENANT_TABS)[number]['key']

export function isTenantTab(v: string | undefined): v is TenantTab {
  return !!v && TENANT_TABS.some(t => t.key === v)
}

/**
 * Tab strip for the tenant object page. Plain links rather than client state so each tab is
 * a real URL — an alert email can point straight at ?tab=provisioning.
 *
 * Lives under /admin/ecom/customers/[id] because the sidebar marks a group active with
 * startsWith(href + '/'), so an object page on its own path would never expand its nav group.
 */
export function TenantTabNav({
  tenantId,
  active,
  badges,
  hidden = [],
}: {
  tenantId: string
  active: TenantTab
  badges?: Partial<Record<TenantTab, React.ReactNode>>
  hidden?: TenantTab[]
}) {
  return (
    <TabLinks
      tabs={TENANT_TABS.filter(t => !hidden.includes(t.key)).map(({ key, label }) => ({
        id: key,
        label: (
          <>
            {label}
            {badges?.[key] ? <span className="ml-0.5">{badges[key]}</span> : null}
          </>
        ),
        href: `/admin/ecom/customers/${tenantId}/view?tab=${key}`,
      }))}
      value={active}
    />
  )
}

/** Side card of label/value rows next to an EcomHero. Server component. */
export function EcomStatCard({
  title,
  rows,
  note,
}: {
  title: string
  rows: { label: string; value: string | number; tone?: string }[]
  note?: string
}) {
  return (
    <div className="bg-surface-elevated rounded-xl border border-border-default p-4 sm:p-5 lg:min-h-[14rem] flex flex-col min-w-0">
      <p className="text-sm font-semibold uppercase tracking-wide text-foreground mb-3">{title}</p>
      <div className="flex-1 flex flex-col justify-center divide-y divide-border-default/60">
        {rows.map(r => (
          <div key={r.label} className="flex items-center justify-between gap-3 py-2">
            <span className="text-sm text-foreground-muted min-w-0 truncate">{r.label}</span>
            <span className={`text-sm font-semibold tabular-nums shrink-0 ${r.tone || 'text-foreground'}`}>{r.value}</span>
          </div>
        ))}
      </div>
      {note && <p className="text-xs text-foreground-muted mt-3">{note}</p>}
    </div>
  )
}
