import type { ReactNode } from 'react'
import { ChevronLeft } from 'lucide-react'

// Page-shaped loading screens. Each page's loading.tsx composes these with its own real text (title,
// tabs, KPI labels, column headings, section and field labels) so the page appears at once and only
// the data shimmers in. Server-safe: no hooks, so loading.tsx and client components can both use them.

const card = 'rounded-xl border border-border-default bg-surface-elevated'
const widths = ['w-3/4', 'w-1/2', 'w-2/3', 'w-5/6', 'w-2/5', 'w-3/5']

/** A shimmering placeholder block; size it with className (h-*, w-*). */
export function Sk({ className = '' }: { className?: string }) {
  return <span aria-hidden className={`sk block rounded bg-surface-secondary ${className}`} />
}

/** The page frame: real back link, title and description; placeholders for the action buttons. */
export function PageLoading({
  title,
  description,
  back,
  actions = 0,
  children,
}: {
  /** Omit when the title is data (an order number, a customer's name): it shimmers instead. */
  title?: string
  description?: ReactNode
  /** The back link's label, e.g. "Orders". */
  back?: string
  /** How many header buttons the page shows. */
  actions?: number
  children?: ReactNode
}) {
  return (
    <div className="space-y-5 p-4 sm:p-6" role="status" aria-busy="true" aria-label={title ? `Loading ${title}` : 'Loading'}>
      <header className="space-y-1.5">
        {back && (
          <span className="inline-flex items-center gap-1 text-xs text-foreground-muted">
            <ChevronLeft className="h-3.5 w-3.5" />
            {back}
          </span>
        )}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            {title ? <h1 className="min-w-0 break-words text-2xl font-bold text-foreground">{title}</h1> : <Sk className="my-1 h-7 w-56" />}
            {description && <p className="mt-0.5 text-sm text-foreground-muted">{description}</p>}
          </div>
          {actions > 0 && (
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {Array.from({ length: actions }).map((_, i) => (
                <Sk key={i} className={`h-control rounded-lg ${i === actions - 1 ? 'w-32' : 'w-24'}`} />
              ))}
            </div>
          )}
        </div>
      </header>
      {children}
    </div>
  )
}

/** KPI cards with their real labels; the values shimmer. */
export function LoadingKpis({ labels }: { labels: string[] }) {
  return (
    <div className="kpi-grid">
      <div>
        {labels.map(l => (
          <div key={l} className={`flex min-w-0 flex-col gap-1 p-3 sm:p-4 ${card}`}>
            <p className="text-xs font-medium uppercase leading-tight tracking-wide text-foreground-muted">{l}</p>
            <Sk className="mt-1 h-6 w-20" />
          </div>
        ))}
      </div>
    </div>
  )
}

/** The tab strip with its real tab names. */
export function LoadingTabs({ tabs, active = 0 }: { tabs: string[]; active?: number }) {
  return (
    <div className="flex gap-1 overflow-hidden border-b border-border-default">
      {tabs.map((t, i) => (
        <span
          key={t}
          className={`-mb-px shrink-0 whitespace-nowrap border-b-2 px-3 py-2 text-sm ${i === active ? 'border-accent-500 font-medium text-foreground' : 'border-transparent text-foreground-muted'}`}
        >
          {t}
        </span>
      ))}
    </div>
  )
}

/** Search and filter controls above a list. */
export function LoadingToolbar({ filters = 1 }: { filters?: number }) {
  return (
    <div className="flex flex-wrap gap-2">
      <Sk className="h-control min-w-[12rem] flex-1 rounded-lg" />
      {Array.from({ length: filters }).map((_, i) => (
        <Sk key={i} className="h-control w-36 rounded-lg" />
      ))}
    </div>
  )
}

/** A table with its real column headings and shimmering rows. Columns after the second hide on phones. */
export function LoadingTable({
  columns,
  rows = 8,
  toolbar,
  title,
  bare,
}: {
  columns: string[]
  rows?: number
  /** Number of filter controls beside the search box; omit for no toolbar. */
  toolbar?: number
  /** A section heading above the table (an embedded list). */
  title?: string
  /** No card around it (inside a section that already has one). */
  bare?: boolean
}) {
  const table = (
    <div className={bare ? 'overflow-hidden' : `overflow-hidden ${card}`}>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border-default bg-surface-secondary/50 text-left text-xs text-foreground-muted">
            {columns.map((c, j) => (
              <th key={c || j} className={`px-3 py-2.5 font-medium ${j > 1 ? 'hidden sm:table-cell' : ''}`}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }).map((_, i) => (
            <tr key={i} className="border-b border-border-default/60 last:border-0">
              {columns.map((c, j) => (
                <td key={c || j} className={`px-3 py-3.5 ${j > 1 ? 'hidden sm:table-cell' : ''}`}>
                  <Sk className={`h-3.5 ${j === 0 ? widths[i % widths.length] : 'w-16'}`} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
  if (!title && toolbar == null) return table
  return (
    <div className="space-y-3">
      {title && <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground">{title}</h2>}
      {toolbar != null && <LoadingToolbar filters={toolbar} />}
      {table}
    </div>
  )
}

/** A titled card (kit Section) with placeholder lines, or your own placeholders as children. */
export function LoadingSection({ title, lines = 4, children, className = '' }: { title: string; lines?: number; children?: ReactNode; className?: string }) {
  return (
    <div className={`min-w-0 p-4 sm:p-5 ${card} ${className}`}>
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-foreground">{title}</h2>
      {children ?? <LoadingLines lines={lines} />}
    </div>
  )
}

/** Stacked text lines of varying length. */
export function LoadingLines({ lines = 4 }: { lines?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: lines }).map((_, i) => (
        <Sk key={i} className={`h-3.5 ${widths[i % widths.length]}`} />
      ))}
    </div>
  )
}

/** Label / value rows, as on a detail page's summary card; the labels are real. */
export function LoadingFacts({ labels }: { labels: string[] }) {
  return (
    <dl className="space-y-3 text-sm">
      {labels.map((l, i) => (
        <div key={l} className="flex items-center justify-between gap-4">
          <dt className="text-foreground-muted">{l}</dt>
          <dd>
            <Sk className={`h-3.5 ${i % 2 ? 'w-24' : 'w-32'}`} />
          </dd>
        </div>
      ))}
    </dl>
  )
}

/** A chart card: real title, shimmering bars. */
export function LoadingChart({ title, height = 'h-56' }: { title: string; height?: string }) {
  const bars = [45, 70, 55, 85, 60, 75, 40, 90, 65, 50, 80, 58]
  return (
    <LoadingSection title={title}>
      <div className={`flex items-end gap-2 ${height}`}>
        {bars.map((h, i) => (
          <div key={i} className="w-full" style={{ height: `${h}%` }}>
            <Sk className="h-full w-full rounded-b-none rounded-t-md" />
          </div>
        ))}
      </div>
    </LoadingSection>
  )
}

/** A form: real section titles and field labels, shimmering inputs, then the action bar. */
export function LoadingForm({
  sections,
  footer = true,
}: {
  sections: { title: string; description?: string; fields: string[]; cols?: 1 | 2 | 3 }[]
  footer?: boolean
}) {
  const grid = { 1: 'grid-cols-1', 2: 'grid-cols-1 md:grid-cols-2', 3: 'grid-cols-1 md:grid-cols-3' }
  return (
    <div className="space-y-5">
      {sections.map(s => (
        <section key={s.title} className={`p-5 ${card}`}>
          <div className="mb-4">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground">{s.title}</h2>
            {s.description && <p className="mt-0.5 text-xs text-foreground-muted">{s.description}</p>}
          </div>
          <div className={`grid gap-4 ${grid[s.cols ?? 2]}`}>
            {s.fields.map(f => (
              <div key={f} className="space-y-1.5">
                <p className="text-sm font-medium text-foreground-secondary">{f}</p>
                <Sk className="h-control rounded-lg" />
              </div>
            ))}
          </div>
        </section>
      ))}
      {footer && (
        <div className={`flex items-center justify-between gap-3 px-4 py-3 ${card}`}>
          <Sk className="h-5 w-20 rounded-full" />
          <div className="flex gap-2">
            <Sk className="h-control w-20 rounded-lg" />
            <Sk className="h-control w-28 rounded-lg" />
          </div>
        </div>
      )}
    </div>
  )
}

/** A grid of cards (tiles, templates, integrations). */
export function LoadingCards({ count = 6, cols = 3, height = 'h-36' }: { count?: number; cols?: 2 | 3 | 4; height?: string }) {
  const grid = { 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-2 xl:grid-cols-3', 4: 'sm:grid-cols-2 xl:grid-cols-4' }
  return (
    <div className={`grid grid-cols-1 gap-4 ${grid[cols]}`}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className={`space-y-3 p-4 ${card} ${height}`}>
          <Sk className="h-4 w-1/2" />
          <Sk className={`h-3 ${widths[i % widths.length]}`} />
          <Sk className="h-3 w-1/3" />
        </div>
      ))}
    </div>
  )
}

/** Main column (two thirds) beside an aside, as on detail pages. */
export function LoadingSplit({ main, aside }: { main: ReactNode; aside: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
      <div className="min-w-0 space-y-4 xl:col-span-2">{main}</div>
      <div className="min-w-0 space-y-4">{aside}</div>
    </div>
  )
}
