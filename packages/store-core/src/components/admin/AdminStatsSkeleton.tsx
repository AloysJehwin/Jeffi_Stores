interface AdminStatsSkeletonProps {
  /** Number of stat cards (default 4) */
  cards?: number
  /** Render a wide banner (e.g. Total Revenue) below the cards */
  banner?: boolean
  /**
   * Exact grid column classes to match the real stats layout, e.g. "grid-cols-3"
   * or "grid-cols-2 md:grid-cols-4". If omitted, derived from `cards`.
   * Must be a verbatim class string (Tailwind JIT can't see interpolation).
   */
  gridClass?: string
}

// Static class map — Tailwind JIT cannot detect interpolated class names,
// so the grid-cols variants must appear verbatim in source.
const GRID_COLS: Record<number, string> = {
  2: 'grid-cols-2',
  3: 'grid-cols-2 md:grid-cols-3',
  4: 'grid-cols-2 md:grid-cols-4',
}

/**
 * Shimmer placeholder for the stat cards row (and optional revenue banner)
 * while the stats query streams in. Use as a <Suspense fallback>.
 */
export default function AdminStatsSkeleton({ cards = 4, banner = false, gridClass }: AdminStatsSkeletonProps) {
  const cols = gridClass ?? GRID_COLS[cards] ?? GRID_COLS[4]
  return (
    <div className="animate-fade-in">
      <div className={`grid ${cols} gap-4 sm:gap-6 mb-6`}>
        {Array.from({ length: cards }).map((_, i) => (
          <div
            key={i}
            className="bg-surface-elevated p-4 sm:p-6 rounded-lg shadow-sm border border-border-default animate-pulse"
            style={{ animationDelay: `${i * 60}ms` }}
          >
            <div className="h-3 w-1/2 bg-surface-secondary rounded mb-3" />
            <div className="h-8 w-1/3 bg-surface-secondary rounded" />
          </div>
        ))}
      </div>
      {banner && (
        <div className="bg-surface-elevated p-4 sm:p-6 rounded-lg shadow-sm border border-border-default mb-6 animate-pulse">
          <div className="h-3 w-24 bg-surface-secondary rounded mb-3" />
          <div className="h-9 w-48 bg-surface-secondary rounded" />
        </div>
      )}
    </div>
  )
}
