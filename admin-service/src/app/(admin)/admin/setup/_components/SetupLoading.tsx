import { LoadingLines, Sk } from '@/components/admin/kit/skeleton'
import { SECTIONS } from '@/lib/setup-guide/registry'

const FILTERS = ['All', 'To do', 'Waiting', 'Needs attention', 'Done']

/** The "N of M done" card with its bar. */
export function ProgressLoading() {
  return (
    <div className="space-y-2 rounded-xl border border-border-default bg-surface-elevated p-4">
      <Sk className="h-6 w-32" />
      <Sk className="h-2 w-full rounded-full" />
    </div>
  )
}

function StepsLoading() {
  return (
    <ul className="mt-4">
      {Array.from({ length: 3 }).map((_, i) => (
        <li key={i} className="space-y-2 border-t border-border-default py-3 first:border-t-0 first:pt-0">
          <div className="flex items-center gap-2">
            <Sk className="h-5 w-16 rounded-full" />
            <Sk className={`h-4 ${i % 2 ? 'w-1/3' : 'w-1/2'}`} />
          </div>
          <Sk className="h-3.5 w-3/4" />
        </li>
      ))}
    </ul>
  )
}

/** The store tab (progress, filters and sections) while the guide loads. */
export default function SetupGuideLoading() {
  return (
    <div className="space-y-4">
      <ProgressLoading />
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f, i) => (
          <span key={f} className={`rounded-full border px-3 py-1 text-xs font-medium ${i === 0 ? 'border-accent-500 bg-accent-500/10 text-accent-700 dark:text-accent-300' : 'border-border-default text-foreground-secondary'}`}>
            {f}
          </span>
        ))}
      </div>
      {SECTIONS.map((sec, i) => (
        <div key={sec.id} className="rounded-xl border border-border-default bg-surface-elevated p-5">
          <span className="text-xs font-semibold uppercase tracking-widest text-foreground-muted">{sec.title}</span>
          {i < 2 && <StepsLoading />}
        </div>
      ))}
    </div>
  )
}

/** The platform apps tab while it loads. */
export function PlatformAppsLoading() {
  return (
    <div className="space-y-4">
      <ProgressLoading />
      <div className="rounded-xl border border-border-default bg-surface-elevated p-4 sm:p-5">
        <LoadingLines lines={6} />
      </div>
    </div>
  )
}
