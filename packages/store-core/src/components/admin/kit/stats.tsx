import Link from 'next/link'
import type { ReactNode } from 'react'

// Small stat rows and tiles used inside cards (dashboard insight cards, CRM). Server-safe.

/** Up/down trend chip for a whole-percent change; renders a dash when null. */
export function PctBadge({ value, invert = false }: { value: number | null; invert?: boolean }) {
  if (value === null) return <span className="text-xs text-foreground-muted">-</span>
  const up = value >= 0
  const good = invert ? !up : up
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-semibold ${good ? 'text-green-600 dark:text-green-400' : 'text-red-500'}`}>
      <svg className={`w-3 h-3 ${up ? '' : 'rotate-180'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 10l7-7m0 0l7 7m-7-7v18" />
      </svg>
      {Math.abs(value)}%
    </span>
  )
}

/** Uppercase group label between blocks of cards. */
export function GroupLabel({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex items-baseline gap-2 pt-2">
      <p className="text-xs uppercase tracking-wide text-foreground-muted font-semibold">{title}</p>
      {hint && <p className="text-xs text-foreground-muted">{hint}</p>}
    </div>
  )
}

/** One label/value row; links when `href` is given. */
export function MiniStat({ label, value, tone, href, sub }: { label: string; value: string; tone?: string; href?: string; sub?: string }) {
  const inner = (
    <>
      <span className="text-xs text-foreground-muted min-w-0 truncate">{label}</span>
      <span className="text-right shrink-0">
        <span className={`text-sm font-bold tabular-nums ${tone || 'text-foreground'}`}>{value}</span>
        {sub && <span className="block text-[11px] leading-tight text-foreground-muted tabular-nums">{sub}</span>}
      </span>
    </>
  )
  if (href) {
    return (
      <Link href={href} className="flex items-center justify-between gap-3 rounded-md px-1 -mx-1 h-control-sm hover:bg-surface-secondary transition-colors">
        {inner}
      </Link>
    )
  }
  return <div className="flex items-center justify-between gap-3 py-1">{inner}</div>
}

/** Small KPI tile for a 2-up grid inside a card. */
export function CompactStat({
  label,
  value,
  sub,
  pct,
  invert,
  tone,
  href,
}: {
  label: string
  value: string
  sub?: string
  pct?: number | null
  invert?: boolean
  tone?: string
  href?: string
}) {
  const inner = (
    <>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] uppercase tracking-wide text-foreground-muted font-medium truncate">{label}</p>
        {pct !== undefined && <PctBadge value={pct ?? null} invert={invert} />}
      </div>
      <p className={`text-lg font-bold tabular-nums leading-tight mt-1 ${tone || 'text-foreground'}`}>{value}</p>
      {sub && <p className="text-[11px] text-foreground-muted mt-0.5 truncate">{sub}</p>}
    </>
  )
  const cls = 'rounded-lg bg-surface-secondary/60 px-3 py-2.5 min-w-0'
  if (href)
    return (
      <Link href={href} className={`${cls} block hover:bg-surface-secondary transition-colors`}>
        {inner}
      </Link>
    )
  return <div className={cls}>{inner}</div>
}

/** Linked rows with a primary line, optional secondary line, badge and value. */
export function ListRows({ rows }: { rows: { key: string; primary: string; secondary?: string; value?: string; badge?: ReactNode; href: string }[] }) {
  if (!rows.length) return <p className="text-xs text-foreground-muted py-4 text-center">No data yet.</p>
  return (
    <div className="divide-y divide-border-default">
      {rows.map(r => (
        <Link key={r.key} href={r.href} className="flex items-center gap-3 py-2.5 group hover:bg-surface-secondary rounded-md px-1 -mx-1 transition-colors">
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-foreground truncate group-hover:text-accent-600 transition-colors">{r.primary}</p>
            {r.secondary && <p className="text-xs text-foreground-muted truncate mt-0.5">{r.secondary}</p>}
          </div>
          <div className="text-right shrink-0 flex flex-col items-end gap-1">
            {r.badge}
            {r.value && <span className="text-xs font-semibold text-foreground tabular-nums">{r.value}</span>}
          </div>
        </Link>
      ))}
    </div>
  )
}
