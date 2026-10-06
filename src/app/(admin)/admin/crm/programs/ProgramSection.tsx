import Link from 'next/link'
import type { ReactNode } from 'react'

export function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="bg-surface-elevated rounded-lg border border-border-default p-4 min-w-0">
      <p className="text-xs font-medium text-foreground-muted uppercase tracking-wide">{label}</p>
      <p className="mt-1 text-2xl font-bold text-foreground truncate">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-foreground-secondary">{hint}</p>}
    </div>
  )
}

export const filterInputClass =
  'px-3 py-1.5 text-sm border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-accent-500'
export const filterButtonClass =
  'px-4 py-1.5 text-sm font-medium border border-border-secondary rounded-lg text-foreground hover:bg-surface-secondary'

// One customer program on the CRM page. A program switched off in Site Controls stays visible but
// greyed out, so admins can see it exists (and still set it up) without mistaking it for live.
export default function ProgramSection({
  id,
  title,
  description,
  on,
  offNote,
  siteControlsHref,
  children,
}: {
  id: string
  title: string
  description: string
  on: boolean
  offNote?: string
  siteControlsHref: string
  children: ReactNode
}) {
  return (
    <section id={id} className="scroll-mt-20 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-foreground">{title}</h2>
          <p className="text-sm text-foreground-secondary">{description}</p>
        </div>
        <span
          className={`self-start shrink-0 px-3 py-1 rounded-full text-xs font-semibold ${
            on
              ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
              : 'bg-surface-secondary text-foreground-secondary'
          }`}
        >
          {on ? 'On' : 'Off'}
        </span>
      </div>

      {!on && (
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 rounded-lg border border-dashed border-border-secondary bg-surface-secondary px-4 py-3 text-sm text-foreground-secondary">
          <span className="flex-1">{offNote || `${title} is switched off. Customers don't see it.`}</span>
          <Link href={siteControlsHref} className="font-medium text-accent-600 hover:text-accent-700 dark:text-accent-400">
            Turn on in Site Controls
          </Link>
        </div>
      )}

      <div className={on ? 'space-y-4' : 'space-y-4 opacity-60 grayscale'}>{children}</div>
    </section>
  )
}
