import { Sk } from '@/components/admin/kit/skeleton'

// Server-safe placeholders for the controls page.

/** Operation history rows: chevron, operation and its meta line, the Rollback button. */
export function HistoryRowsSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="divide-y divide-border-default">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-2.5">
          <Sk className="w-3.5 h-3.5 shrink-0" />
          <div className="flex-1 min-w-0 space-y-1.5">
            <Sk className={`h-3.5 ${i % 2 ? 'w-1/3' : 'w-1/2'}`} />
            <Sk className="h-3 w-2/3" />
          </div>
          <Sk className="h-6 w-16 rounded shrink-0" />
        </div>
      ))}
    </div>
  )
}

/** Product checklist rows: checkbox, name, category and price. */
export function ProductRowsSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="divide-y divide-border-default">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-2.5">
          <Sk className="w-4 h-4 rounded shrink-0" />
          <Sk className="h-3.5 flex-1" />
          <Sk className="h-3 w-24" />
        </div>
      ))}
    </div>
  )
}
