import type { ComponentType, ReactNode } from 'react'
import { Sk } from '@/components/admin/kit/skeleton'

// Page-shaped loading pieces in the console's own frame (PageHeader, Card, sand tables): real headings,
// labels and column names at once, shimmer only where data goes. Server-safe.

export { Sk }

const widths = ['w-3/4', 'w-1/2', 'w-2/3', 'w-5/6', 'w-2/5', 'w-3/5']

/** The console PageHeader with its real text; omit `title` when it is data so it shimmers. */
export function ConsoleLoading({ eyebrow, title, description, actions, children }: { eyebrow?: string; title?: string; description?: string; actions?: ReactNode; children?: ReactNode }) {
  return (
    <div role="status" aria-busy="true" aria-label={title ? `Loading ${title}` : 'Loading'}>
      <ConsoleHeaderLoading eyebrow={eyebrow} title={title} description={description} actions={actions} />
      {children}
    </div>
  )
}

export function ConsoleHeaderLoading({ eyebrow, title, description, actions }: { eyebrow?: string; title?: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 mb-8">
      <div className="min-w-0">
        {eyebrow && <div className="text-xs font-semibold uppercase tracking-widest text-foreground-muted mb-1">{eyebrow}</div>}
        {title ? <h1 className="font-display text-3xl sm:text-4xl font-black text-foreground leading-tight break-words">{title}</h1> : <Sk className="my-1 h-9 w-64 max-w-full" />}
        {description && <p className="text-sm text-foreground-secondary mt-2 max-w-2xl">{description}</p>}
      </div>
      {actions && <div className="flex max-w-full flex-wrap items-center gap-2 flex-shrink-0">{actions}</div>}
    </div>
  )
}

/** A Card with its real title; placeholder lines unless you pass your own. */
export function CardLoading({ title, className = '', children }: { title?: string; className?: string; children?: ReactNode }) {
  return (
    <section className={`rounded-2xl border border-border-default bg-surface-elevated p-6 ${className}`}>
      {title && <h2 className="text-xs font-semibold text-foreground-muted uppercase tracking-widest mb-4">{title}</h2>}
      {children ?? <LinesLoading />}
    </section>
  )
}

export function LinesLoading({ lines = 3 }: { lines?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: lines }).map((_, i) => (
        <Sk key={i} className={`h-3.5 ${widths[i % widths.length]}`} />
      ))}
    </div>
  )
}

/** Card label/value Rows: real labels, shimmering values. */
export function RowsLoading({ labels }: { labels: string[] }) {
  return (
    <div className="space-y-2.5">
      {labels.map((l, i) => (
        <div key={l} className="flex items-center justify-between gap-3 text-sm">
          <span className="text-foreground-secondary flex-shrink-0">{l}</span>
          <Sk className={`h-3.5 ${i % 2 ? 'w-20' : 'w-28'}`} />
        </div>
      ))}
    </div>
  )
}

/** A label over a shimmering input. */
export function FieldLoading({ label, className = '' }: { label: string; className?: string }) {
  return (
    <div className={className}>
      <span className="block text-xs text-foreground-muted mb-1">{label}</span>
      <Sk className="h-10 w-full rounded-xl" />
    </div>
  )
}

/** A table inside a Card (sand heading row) with its real column names; `edge` undoes the card padding. */
export function SandTableLoading({ columns, rows = 5, minWidth = 'min-w-[640px]', edge = '-mx-6 -mb-6' }: { columns: string[]; rows?: number; minWidth?: string; edge?: string }) {
  return (
    <div className={`${edge} overflow-x-auto`} aria-busy="true">
      <table className={`w-full text-sm ${minWidth}`}>
        <thead className="org-sand text-foreground-secondary">
          <tr>{columns.map((h, i) => <th key={h || i} className="px-6 py-2 text-left text-xs font-semibold">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-border-default">
          {Array.from({ length: rows }).map((_, r) => (
            <tr key={r}>
              {columns.map((h, c) => (
                <td key={h || c} className="px-6 py-3">
                  <Sk className={`h-3.5 ${c === 0 ? widths[r % widths.length] : h ? 'w-16' : 'ml-auto w-10'}`} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** The finance tables (bordered card, uppercase headings). */
export function FinanceTableLoading({ columns, rows = 8, minWidth = 'min-w-[700px]' }: { columns: string[]; rows?: number; minWidth?: string }) {
  return (
    <div className="rounded-2xl border border-border-default bg-surface-elevated overflow-x-auto">
      <table className={`w-full text-sm ${minWidth}`}>
        <thead>
          <tr className="bg-surface-secondary text-left">
            {columns.map(h => <th key={h} className="px-4 py-3 text-xs font-semibold text-foreground-muted uppercase tracking-widest">{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }).map((_, r) => (
            <tr key={r} className="border-t border-border-default/60">
              {columns.map((h, c) => (
                <td key={h} className="px-4 py-3.5">
                  <Sk className={`h-3.5 ${c === 0 ? 'w-24' : 'w-16'}`} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Money tiles (MoneyTiles, the wallet's sand tiles) with their real labels. */
export function TilesLoading({ labels, sand = false, cols = 'grid-cols-2 lg:grid-cols-4' }: { labels: string[]; sand?: boolean; cols?: string }) {
  return (
    <div className={`grid gap-4 ${cols}`}>
      {labels.map(l => (
        <div key={l} className={sand ? 'rounded-2xl org-sand p-4 last:col-span-2 sm:p-5 sm:last:col-span-1' : 'rounded-2xl border border-border-default bg-surface-elevated p-4 sm:p-5'}>
          <div className="text-xs text-foreground-muted uppercase tracking-widest mb-2">{l}</div>
          <Sk className="h-7 w-28 sm:h-8" />
        </div>
      ))}
    </div>
  )
}

/** The Segmented control with its real options; the default one is on. */
export function SegmentedLoading({ labels, active = 0, icons }: { labels: string[]; active?: number; icons?: ComponentType<{ className?: string }>[] }) {
  return (
    <div className="inline-flex max-w-full gap-0.5 overflow-hidden rounded-full org-sand p-1">
      {labels.map((l, i) => {
        const Icon = icons?.[i]
        return (
          <span key={l} className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-semibold ${i === active ? 'ecom-sel shadow-sm' : 'text-foreground-secondary'}`}>
            {Icon && <Icon className="h-4 w-4" />}
            {l}
          </span>
        )
      })}
    </div>
  )
}

/** A status pill or small badge whose text is data. */
export function PillLoading({ className = 'w-20' }: { className?: string }) {
  return <Sk className={`h-6 rounded-full ${className}`} />
}

/** Rows of an untitled in-card list. */
export function SkeletonRows({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="divide-y divide-border-default" aria-busy="true">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex items-center gap-4 py-3">
          {Array.from({ length: cols }).map((_, c) => (
            <span key={c} style={{ width: `${c === 0 ? 28 : 100 / (cols + 1)}%` }}>
              <Sk className="h-3.5 w-full" />
            </span>
          ))}
        </div>
      ))}
    </div>
  )
}
