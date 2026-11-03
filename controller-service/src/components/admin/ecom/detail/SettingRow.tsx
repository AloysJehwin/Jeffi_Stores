import type { ReactNode } from 'react'

/** One setting or operator action: what it is and does on the left, its control on the right (stacks on a phone). */
export default function SettingRow({ title, value, hint, children }: { title: string; value?: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between sm:gap-4 min-w-0">
      <div className="min-w-0">
        <p className="text-xs uppercase tracking-wide text-foreground-muted font-medium">{title}</p>
        {value && <p className="text-sm font-semibold text-foreground mt-0.5 break-words">{value}</p>}
        {hint && <p className="text-xs text-foreground-muted mt-0.5">{hint}</p>}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">{children}</div>
    </div>
  )
}
