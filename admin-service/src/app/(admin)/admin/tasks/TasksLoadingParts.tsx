import { LoadingKpis, LoadingSection, LoadingTable, Sk } from '@/components/admin/kit/skeleton'
import { LoadingAttention } from '../products/_components/loading-parts'

// Server-safe placeholders for the tasks overview and list.

/** Overview body: KPIs, then attention beside the by-assignee table. */
export function TasksOverviewSkeleton() {
  return (
    <>
      <LoadingKpis labels={['Open', 'Overdue', 'Created', 'Completed', 'Avg time to complete', 'Unassigned']} />
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <LoadingAttention />
        <LoadingSection title="By assignee">
          <LoadingTable columns={['Assignee', 'Open', 'Overdue', 'Done', 'Avg time']} rows={5} bare />
        </LoadingSection>
      </div>
    </>
  )
}

/** A due-date bucket card with task rows: checkbox, title and badges, then customer and assignee. */
export function TaskRowsSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="bg-surface-elevated rounded-xl border border-border-default overflow-hidden">
      <div className="px-4 sm:px-5 py-3 border-b border-border-default flex items-center justify-between">
        <Sk className="h-4 w-24" />
        <Sk className="h-3 w-6" />
      </div>
      <div className="divide-y divide-border-default">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="px-4 sm:px-5 py-3 flex items-start gap-2 sm:gap-3">
            <Sk className="mt-0.5 w-4 h-4 rounded shrink-0" />
            <div className="flex-1 min-w-0 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <Sk className={`h-3.5 ${i % 2 ? 'w-1/2' : 'w-2/3'}`} />
                <Sk className="h-3.5 w-16 rounded-full" />
              </div>
              <Sk className="h-3 w-40" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
