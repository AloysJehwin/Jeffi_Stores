import type { ReactNode } from 'react'

/** The console's card. `title` is its eyebrow heading; `action` sits on the heading's right (a link or button). */
export function Card({ title, action, children, className = '' }: { title?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-border-default bg-surface-elevated p-6 ${className}`}>
      {(title || action) && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          {title && <h2 className="text-xs font-semibold text-foreground-muted uppercase tracking-widest">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  )
}

export function Row({ label, value, mono = false }: { label: string; value: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-foreground-secondary flex-shrink-0">{label}</span>
      <span className={`min-w-0 break-words text-foreground text-right ${mono ? 'font-mono text-xs break-all' : 'font-medium'}`}>{value}</span>
    </div>
  )
}

/** The console's one KPI tile (Overview, Ledger, Wallet): a label over a figure. */
export function StatTile({ label, value, accent = false }: { label: string; value: ReactNode; accent?: boolean }) {
  return (
    <div className="rounded-2xl border border-border-default bg-surface-elevated p-4 sm:p-5">
      <div className="text-xs text-foreground-muted uppercase tracking-widest mb-2">{label}</div>
      <div className={`font-display text-lg sm:text-2xl lg:text-3xl font-black tabular-nums [overflow-wrap:anywhere] sm:[overflow-wrap:normal] ${accent ? 'ecom-accent-text' : 'text-foreground'}`}>
        {value}
      </div>
    </div>
  )
}
