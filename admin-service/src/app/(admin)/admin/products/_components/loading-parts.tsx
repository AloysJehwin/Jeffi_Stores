import type { ReactNode } from 'react'
import { PERIOD_PRESETS } from '@/lib/overview/period'
import { LoadingKpis, LoadingLines, LoadingTable, LoadingTabs, LoadingToolbar, Sk } from '@/components/admin/kit/skeleton'

// Server-safe loading pieces shared by the catalogue and marketing pages, composed from the kit skeleton.

const card = 'rounded-xl border border-border-default bg-surface-elevated'

/** TabLinks with its action buttons at the right of the strip. */
export function LoadingTabBar({ tabs, active = 0, actions = 0 }: { tabs: string[]; active?: number; actions?: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="min-w-0 flex-1">
        <LoadingTabs tabs={tabs} active={active} />
      </div>
      {Array.from({ length: actions }).map((_, i) => (
        <Sk key={i} className={`h-control shrink-0 rounded-lg ${i === actions - 1 ? 'w-28' : 'w-9 sm:w-24'}`} />
      ))}
    </div>
  )
}

/** The overview period bar: real presets (30 days selected) and shimmering date fields. */
export function LoadingPeriodBar() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex h-control max-w-full gap-0.5 overflow-x-auto rounded-lg border border-border-default bg-surface-elevated p-0.5">
        {PERIOD_PRESETS.map(p => (
          <span key={p.id} className={`flex items-center whitespace-nowrap rounded-md px-2.5 text-xs font-medium ${p.id === '30d' ? 'bg-accent-500 text-white' : 'text-foreground-muted'}`}>
            {p.label}
          </span>
        ))}
      </div>
      <div className="flex items-center gap-1 text-xs">
        <Sk className="h-control w-32 rounded-lg" />
        <span className="text-foreground-muted">to</span>
        <Sk className="h-control w-32 rounded-lg" />
      </div>
    </div>
  )
}

/** The "Needs attention" card of an overview. */
export function LoadingAttention({ title = 'Needs attention' }: { title?: string }) {
  return (
    <div className={`p-4 ${card}`}>
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-foreground-muted">{title}</h3>
      <LoadingLines lines={4} />
    </div>
  )
}

/** A titled card (kit Section / Card) holding a table with its real headings. */
export function LoadingTableCard({ title, columns, rows = 5 }: { title: string; columns: string[]; rows?: number }) {
  return (
    <div className={`min-w-0 ${card}`}>
      <h2 className="px-5 pb-3 pt-4 text-sm font-semibold uppercase tracking-wide text-foreground">{title}</h2>
      <LoadingTable columns={columns} rows={rows} bare />
    </div>
  )
}

/** Overview body: KPIs, then attention beside one panel (OverviewTab's layout). */
export function LoadingOverviewBody({ kpis, panel }: { kpis: string[]; panel?: ReactNode }) {
  return (
    <div className="space-y-4">
      <LoadingKpis labels={kpis} />
      <div className={panel ? 'grid grid-cols-1 gap-4 lg:grid-cols-2' : ''}>
        <LoadingAttention />
        {panel}
      </div>
    </div>
  )
}

/** A whole overview tab: period bar, the list's filters, then the body. */
export function LoadingOverview({ kpis, panel, filters = true }: { kpis: string[]; panel?: ReactNode; filters?: boolean }) {
  return (
    <div className="space-y-4">
      <LoadingPeriodBar />
      {filters && <LoadingToolbar filters={1} />}
      <LoadingOverviewBody kpis={kpis} panel={panel} />
    </div>
  )
}

/** EntityPage's main + aside columns (aside is a quarter on xl). */
export function LoadingEntitySplit({ main, aside }: { main: ReactNode; aside: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 xl:grid-cols-4">
      <div className="min-w-0 space-y-4 lg:col-span-2 xl:col-span-3">{main}</div>
      <div className="min-w-0 space-y-4">{aside}</div>
    </div>
  )
}

/** Field / value grid (kit Fields) with real labels. */
export function LoadingFields({ labels, cols = 2 }: { labels: string[]; cols?: 1 | 2 | 3 }) {
  const grid = { 1: 'grid-cols-1', 2: 'grid-cols-1 sm:grid-cols-2', 3: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3' }
  return (
    <dl className={`grid gap-x-6 gap-y-3 ${grid[cols]}`}>
      {labels.map((l, i) => (
        <div key={l} className="min-w-0">
          <dt className="text-xs text-foreground-muted">{l}</dt>
          <dd className="mt-1">
            <Sk className={`h-3.5 ${i % 2 ? 'w-24' : 'w-32'}`} />
          </dd>
        </div>
      ))}
    </dl>
  )
}

/** A titled card (kit Card) around custom placeholders. */
export function LoadingCard({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className={`min-w-0 ${card}`}>
      <div className="px-5 pb-3 pt-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground">{title}</h2>
        {hint && <p className="mt-0.5 text-xs text-foreground-muted">{hint}</p>}
      </div>
      <div className="px-5 pb-5">{children}</div>
    </section>
  )
}

/** The "Recent changes" card ChangeLog renders in an aside. */
export function LoadingRecentChanges() {
  return (
    <LoadingCard title="Recent changes">
      <LoadingLines lines={3} />
    </LoadingCard>
  )
}
