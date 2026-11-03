interface AdminTableSkeletonProps {
  /** Number of shimmer rows to render (default 8) */
  rows?: number
  /** Number of cells per row on desktop (default 5) */
  cols?: number
}

/**
 * Shimmer placeholder for an admin list/table while its data streams in.
 * Renders a mobile card list + desktop table, mirroring the real list layout
 * so the swap-in is visually stable. Use as a <Suspense fallback>.
 */
export default function AdminTableSkeleton({ rows = 8, cols = 5 }: AdminTableSkeletonProps) {
  return (
    <div className="animate-fade-in">
      {/* Mobile: shimmer cards */}
      <div className="md:hidden space-y-3">
        {Array.from({ length: rows }).map((_, i) => (
          <div
            key={i}
            className="bg-surface-elevated rounded-lg shadow-sm border border-border-default p-4 animate-pulse"
            style={{ animationDelay: `${i * 50}ms` }}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="h-4 w-24 bg-surface-secondary rounded" />
              <div className="h-5 w-16 bg-surface-secondary rounded-full" />
            </div>
            <div className="flex items-center justify-between mb-1">
              <div className="h-4 w-32 bg-surface-secondary rounded" />
              <div className="h-4 w-20 bg-surface-secondary rounded" />
            </div>
            <div className="h-3 w-28 bg-surface-secondary rounded opacity-60" />
          </div>
        ))}
      </div>

      {/* Desktop: shimmer table */}
      <div className="hidden md:block bg-surface-elevated rounded-lg shadow-sm border border-border-default overflow-hidden">
        <div className="h-12 bg-surface-secondary border-b border-border-default animate-pulse" />
        {Array.from({ length: rows }).map((_, i) => (
          <div
            key={i}
            className="h-14 border-b border-border-default last:border-b-0 flex items-center px-6 gap-4 animate-pulse"
            style={{ animationDelay: `${i * 50}ms` }}
          >
            <div className="h-4 flex-1 bg-surface-secondary rounded" />
            {Array.from({ length: Math.max(0, cols - 2) }).map((_, c) => (
              <div key={c} className="h-4 w-24 bg-surface-secondary rounded hidden lg:block" />
            ))}
            <div className="h-4 w-20 bg-surface-secondary rounded" />
          </div>
        ))}
      </div>
    </div>
  )
}
