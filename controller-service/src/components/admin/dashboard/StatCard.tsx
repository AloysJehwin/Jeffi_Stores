import Link from 'next/link'
import type { ReactNode } from 'react'

/** Up/down trend chip with an SVG arrow. Renders — when value is null. */
export function PctBadge({ value, invert = false }: { value: number | null; invert?: boolean }) {
  if (value === null) return <span className="text-xs text-foreground-muted">—</span>
  const up = value >= 0
  const good = invert ? !up : up
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-xs font-semibold ${good ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'}`}
    >
      <svg
        className={`w-3 h-3 ${up ? '' : 'rotate-180'}`}
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2.5}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 10l7-7m0 0l7 7m-7-7v18" />
      </svg>
      {Math.abs(value)}%
    </span>
  )
}

/**
 * Canonical KPI tile — icon chip + value + optional trend badge, optionally
 * wrapped in a link. Extracted from the dashboard page so both the server page
 * and the client analytics shell share one implementation.
 */
export function StatCard({
  label,
  value,
  sub,
  pct,
  invert,
  icon,
  color,
  href,
}: {
  label: string
  value: string
  sub?: string
  pct?: number | null
  invert?: boolean
  icon: ReactNode
  color: string
  href?: string
}) {
  const inner = (
    <>
      <div className="flex items-start justify-between">
        <div className={`p-2.5 rounded-lg ${color}`}>{icon}</div>
        {pct !== undefined && <PctBadge value={pct ?? null} invert={invert} />}
      </div>
      <div>
        <p className="text-xs text-foreground-muted uppercase tracking-wide font-medium">{label}</p>
        <p className="text-2xl sm:text-3xl font-bold text-foreground mt-1 leading-none tabular-nums">{value}</p>
        {sub && <p className="text-xs text-foreground-muted mt-1">{sub}</p>}
      </div>
    </>
  )

  if (href) {
    return (
      <Link
        href={href}
        className="bg-surface-elevated rounded-xl border border-border-default p-5 flex flex-col gap-3 hover:border-accent-400 transition-colors"
      >
        {inner}
      </Link>
    )
  }
  return (
    <div className="bg-surface-elevated rounded-xl border border-border-default p-5 flex flex-col gap-3">{inner}</div>
  )
}
