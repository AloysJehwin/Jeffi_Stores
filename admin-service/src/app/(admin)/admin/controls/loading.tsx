import { Clock } from 'lucide-react'
import { EmptyState } from '@/components/admin/kit/states'
import { LoadingToolbar, PageLoading } from '@/components/admin/kit/skeleton'
import { HistoryRowsSkeleton } from './_components/ControlsLoadingParts'

const head = 'flex items-center gap-3 px-4 py-3 border-b border-border-default bg-surface-secondary/50'

export default function Loading() {
  return (
    <PageLoading
      title="Product Controls"
      description="Filter products, select a subset, then apply a bulk operation. Every change is logged and can be undone from History. Price changes derive from MRP (Ex-GST); GST, selling price and discount recalculate automatically."
    >
      <section className="bg-surface-elevated rounded-xl border border-border-default overflow-hidden">
        <div className={head}>
          <span className="flex items-center justify-center w-6 h-6 rounded-full bg-accent-500 text-white text-xs font-bold shrink-0">1</span>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground flex-1">Filter products</h2>
        </div>
        <div className="p-4">
          <LoadingToolbar filters={4} />
        </div>
      </section>
      <EmptyState
        title="Add one or more filters above to load products."
        body={
          <>
            Example: filter by <strong>Grade = 12.9</strong>, select all, then apply <strong>Inflate Price +5%</strong>.
          </>
        }
      />
      <div className="bg-surface-elevated rounded-xl border border-border-default overflow-hidden">
        <div className={`${head} justify-between`}>
          <div className="flex items-center gap-3">
            <span className="flex items-center justify-center w-6 h-6 rounded-full bg-surface-secondary text-foreground-secondary shrink-0">
              <Clock className="w-3.5 h-3.5" />
            </span>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground">Operation History</h2>
          </div>
          <span className="text-xs text-foreground-muted">Refresh</span>
        </div>
        <HistoryRowsSkeleton />
      </div>
    </PageLoading>
  )
}
