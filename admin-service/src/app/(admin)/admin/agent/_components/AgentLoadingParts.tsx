import { Sk } from '@/components/admin/kit/skeleton'

// Server-safe placeholders for the agent's log and proposed-tools lists.

/** Tool-log rows: avatar, call count and meta, then the tools line. */
export function LogRowsSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="bg-surface-elevated border border-border-default rounded-lg px-4 py-3 flex items-start gap-3">
          <Sk className="w-8 h-8 rounded-full shrink-0" />
          <div className="flex-1 min-w-0 space-y-2">
            <div className="flex items-center gap-2">
              <Sk className="h-3 w-20" />
              <Sk className="h-3 w-12" />
              <Sk className="h-3 w-16" />
            </div>
            <Sk className={`h-3 ${i % 2 ? 'w-1/2' : 'w-3/4'}`} />
          </div>
        </div>
      ))}
    </div>
  )
}

/** Proposed-tool cards: name, description, meta and the collapsed sections. */
export function ToolCardsSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="bg-surface-elevated border border-border-default rounded-xl p-4 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1 space-y-2">
              <Sk className="h-4 w-48" />
              <Sk className={`h-3.5 ${i % 2 ? 'w-1/2' : 'w-3/4'}`} />
              <Sk className="h-2.5 w-40" />
            </div>
            <Sk className="h-4 w-16 rounded-full shrink-0" />
          </div>
          <p className="text-[11px] text-foreground-muted">Original request</p>
          <p className="text-[11px] text-foreground-muted">Args schema</p>
          <Sk className="h-16 w-full rounded" />
        </div>
      ))}
    </div>
  )
}
