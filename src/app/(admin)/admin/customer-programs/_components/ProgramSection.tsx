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
  'field-sm border border-border-secondary bg-surface text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-accent-500'
export const PROGRAMS_PATH = '/admin/customer-programs'
export const filterButtonClass =
  'control-sm font-medium border border-border-secondary text-foreground hover:bg-surface-secondary'

// One customer program tab. A program switched off in Site Controls stays visible but greyed out,
// so admins can see it exists (and still set it up) without mistaking it for live.
export default function ProgramSection({
  title,
  description,
  on,
  offNote,
  siteControlsHref,
  children,
}: {
  title: string
  description: string
  on: boolean
  offNote?: string
  siteControlsHref: string
  children: ReactNode
}) {
  return (
    <section className="space-y-4">
      <p className="text-sm text-foreground-secondary">{description}</p>

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
