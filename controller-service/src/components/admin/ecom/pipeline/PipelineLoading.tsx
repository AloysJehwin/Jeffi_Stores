import { Sk } from '@/components/admin/kit/skeleton'

const JOBS = ['w-3/4', 'w-1/2', 'w-2/3', 'w-3/5', 'w-1/2']

/** The run's shape while it loads: the summary card, then the job rail beside the shown job's steps. */
export function PipelineLoading() {
  return (
    <div className="space-y-5 min-w-0" aria-busy="true">
      <div className="min-w-0 rounded-xl border border-border-default bg-surface-elevated p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Sk className="h-5 w-20 rounded-full" />
          <Sk className="h-3.5 w-40" />
          <Sk className="h-3.5 w-24" />
        </div>
        <Sk className="mt-3.5 h-1.5 w-full rounded-full" />
      </div>
      <div className="grid gap-5 items-start lg:grid-cols-[16rem_minmax(0,1fr)]">
        <div className="hidden lg:block rounded-xl border border-border-default bg-surface-elevated p-2 space-y-0.5">
          {JOBS.map((w, i) => (
            <div key={i} className="flex items-center gap-2.5 px-2.5 py-2">
              <Sk className="h-4 w-4 shrink-0 rounded-full" />
              <Sk className={`h-3.5 ${w}`} />
            </div>
          ))}
        </div>
        <section className="min-w-0 rounded-xl border border-border-default bg-surface-elevated overflow-hidden">
          <div className="flex items-center gap-3 px-5 py-3.5 border-b border-border-default">
            <Sk className="h-4 w-40" />
            <Sk className="ml-auto h-5 w-20 rounded-full" />
          </div>
          <div className="space-y-0.5 p-3">
            {JOBS.map((w, i) => (
              <div key={i} className="flex items-center gap-3 px-2 py-2.5">
                <Sk className="h-4 w-4 shrink-0 rounded-full" />
                <Sk className={`h-3.5 ${w}`} />
                <Sk className="ml-auto h-3 w-10 shrink-0" />
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}

/** The Refresh button and Live switch above the run. */
export function PipelineToolbarLoading() {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Sk className="h-control w-24 rounded-lg" />
      <span className="flex items-center gap-2 text-sm text-foreground-muted">
        <span className="h-4 w-4 rounded border border-border-default" />
        Live
      </span>
    </div>
  )
}
