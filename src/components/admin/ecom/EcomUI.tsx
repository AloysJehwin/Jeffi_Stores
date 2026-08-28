import Link from 'next/link'

// Gradient hero stat card — matches the Orders page house style (gradient panel +
// backdrop-blur stat tiles). Server component; pass a headline value + up to 4 tiles.
export function EcomHero({
  label,
  value,
  tiles,
}: {
  label: string
  value: string
  tiles: { value: string | number; label: string }[]
}) {
  return (
    <div className="bg-gradient-to-r from-primary-500 to-accent-500 p-4 sm:p-6 rounded-lg shadow-sm flex flex-col justify-between text-white lg:h-56">
      <div>
        <p className="text-white/80 text-sm">{label}</p>
        <p className="text-3xl sm:text-4xl font-bold mt-1">{value}</p>
      </div>
      <div className={`grid grid-cols-${Math.min(tiles.length, 4)} gap-2 sm:gap-3 mt-4`}>
        {tiles.map((t, i) => (
          <div key={i} className="rounded-lg bg-white/15 backdrop-blur-sm px-2 py-2 sm:px-3 sm:py-2.5">
            <p className="text-lg sm:text-2xl font-bold leading-none">{t.value}</p>
            <p className="text-[10px] sm:text-xs text-white/80 mt-1">{t.label}</p>
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
    basic: 'bg-sky-500', growth: 'bg-emerald-500', pro: 'bg-violet-500', enterprise: 'bg-amber-500',
  }
  return (
    <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default p-4 sm:p-6 lg:h-56 flex flex-col">
      <p className="font-semibold text-foreground mb-4">Plan mix</p>
      <div className="flex-1 flex flex-col justify-center gap-3">
        {mix.length === 0 && <p className="text-sm text-foreground-muted">No tenants yet.</p>}
        {mix.map((m) => (
          <div key={m.plan}>
            <div className="flex justify-between text-xs mb-1">
              <span className="capitalize text-foreground-secondary">{m.plan}</span>
              <span className="text-foreground-muted">{m.count}</span>
            </div>
            <div className="h-2.5 rounded-full bg-surface-secondary overflow-hidden">
              <div className={`h-full rounded-full ${colors[m.plan] || 'bg-foreground-muted'}`} style={{ width: `${(m.count / total) * 100}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// Status/plan/search filter bar (client, URL-param driven).
export { default as EcomFilters } from './EcomFilters'

// Small pill for statuses reused across pages.
export function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    active: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300',
    provisioning: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300',
    suspended: 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400',
    terminated: 'bg-surface-secondary text-foreground-secondary',
    settled: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300',
    captured: 'bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-300',
    split: 'bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300',
    refunded: 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400',
  }
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${map[status] || map.terminated}`}>
      {status}
    </span>
  )
}

export function DetailLink({ href, children }: { href: string; children: React.ReactNode }) {
  return <Link href={href} className="text-accent-600 dark:text-accent-400 hover:underline">{children}</Link>
}

/** Label/value pair used by every tenant detail section. */
export function Field({ label, value, wide }: { label: string; value: React.ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? 'col-span-2' : undefined}>
      <dt className="text-xs uppercase tracking-wide text-foreground-muted">{label}</dt>
      <dd className="text-sm text-foreground mt-0.5 min-w-0 break-words">{value ?? '—'}</dd>
    </div>
  )
}

export function Mono({ children }: { children: React.ReactNode }) {
  return <span className="font-mono text-xs break-all">{children}</span>
}

export const NOT_PROVISIONED = <span className="text-amber-500">not provisioned</span>

export function Section({ title, action, children, className = '' }: {
  title: string; action?: React.ReactNode; children: React.ReactNode; className?: string
}) {
  return (
    <section className={`rounded-xl border border-border-default p-5 bg-surface-elevated min-w-0 ${className}`}>
      <div className="flex items-center justify-between gap-3 mb-4">
        <h2 className="font-semibold text-foreground">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}

export function FieldGrid({ children }: { children: React.ReactNode }) {
  return <dl className="grid grid-cols-2 gap-4 min-w-0">{children}</dl>
}

export const TENANT_TABS = [
  { key: 'overview',       label: 'Overview' },
  { key: 'provisioning',   label: 'Provisioning' },
  { key: 'infrastructure', label: 'Infrastructure' },
  { key: 'commerce',       label: 'Commerce' },
  { key: 'access',         label: 'Access' },
  { key: 'kyc',            label: 'KYC' },
] as const

export type TenantTab = typeof TENANT_TABS[number]['key']

export function isTenantTab(v: string | undefined): v is TenantTab {
  return !!v && TENANT_TABS.some(t => t.key === v)
}

/**
 * Tab strip for the tenant object page. Plain links rather than client state so each tab is
 * a real URL — an alert email can point straight at ?tab=provisioning.
 */
export function TenantTabNav({ tenantId, active, badges }: {
  tenantId: string; active: TenantTab; badges?: Partial<Record<TenantTab, React.ReactNode>>
}) {
  return (
    <div className="border-b border-border-default -mx-6 px-6 overflow-x-auto">
      <nav className="flex gap-1 min-w-max">
        {TENANT_TABS.map(({ key, label }) => {
          const on = key === active
          return (
            <Link
              key={key}
              href={`/admin/ecom/tenants/${tenantId}?tab=${key}`}
              className={`px-3.5 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${
                on
                  ? 'border-accent-500 text-foreground'
                  : 'border-transparent text-foreground-muted hover:text-foreground hover:border-border-default'
              }`}
            >
              {label}
              {badges?.[key] ? <span className="ml-1.5">{badges[key]}</span> : null}
            </Link>
          )
        })}
      </nav>
    </div>
  )
}
