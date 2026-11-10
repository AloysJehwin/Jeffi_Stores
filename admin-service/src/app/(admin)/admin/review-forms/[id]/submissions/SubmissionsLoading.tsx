import { Sk } from '@/components/admin/kit/skeleton'

/** Submission cards (screenshot, email, status, date) while they load. */
export function SubmissionCardsLoading() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="overflow-hidden rounded-xl border border-border-default bg-surface-elevated">
          <Sk className="aspect-video rounded-none" />
          <div className="space-y-2 p-3">
            <div className="flex items-center justify-between gap-2">
              <Sk className="h-4 w-32" />
              <Sk className="h-5 w-16 rounded-full" />
            </div>
            <Sk className="h-3 w-24" />
            <Sk className="h-3 w-28" />
          </div>
        </div>
      ))}
    </div>
  )
}

/** The status filter with "All" selected. */
export function SubmissionFilterLoading() {
  return (
    <div className="flex h-control w-fit max-w-full gap-1 overflow-x-auto rounded-lg border border-border-default bg-surface-elevated p-0.5">
      {['All', 'Pending', 'Approved', 'Rejected'].map((s, i) => (
        <span key={s} className={`flex h-full items-center rounded-md px-3 text-xs font-medium ${i === 0 ? 'bg-accent-500 text-white' : 'text-foreground-muted'}`}>
          {s}
        </span>
      ))}
    </div>
  )
}
