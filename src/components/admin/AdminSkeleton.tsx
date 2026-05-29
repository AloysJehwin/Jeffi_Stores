type Variant = 'list' | 'detail' | 'form' | 'dashboard'

interface AdminSkeletonProps {
  variant?: Variant
  rows?: number
  showStats?: boolean
}

export default function AdminSkeleton({
  variant = 'list',
  rows = 6,
  showStats = true,
}: AdminSkeletonProps) {
  return (
    <div className="p-4 sm:p-6 animate-fade-in">
      <div className="h-8 w-48 bg-surface-secondary rounded animate-pulse mb-2" />
      <div className="h-4 w-72 bg-surface-secondary rounded animate-pulse mb-6 opacity-60" />

      {variant === 'list' && (
        <>
          {showStats && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              {Array.from({ length: 4 }).map((_, i) => (
                <div
                  key={i}
                  className="bg-surface-elevated rounded-lg border border-border-default p-4 animate-pulse"
                  style={{ animationDelay: `${i * 60}ms` }}
                >
                  <div className="h-3 w-1/3 bg-surface-secondary rounded mb-2" />
                  <div className="h-8 w-1/2 bg-surface-secondary rounded" />
                </div>
              ))}
            </div>
          )}

          <div className="h-10 bg-surface-elevated rounded-lg border border-border-default mb-4 animate-pulse" />

          <div className="bg-surface-elevated rounded-lg border border-border-default overflow-hidden">
            <div className="h-12 bg-surface-secondary border-b border-border-default animate-pulse" />
            {Array.from({ length: rows }).map((_, i) => (
              <div
                key={i}
                className="h-14 border-b border-border-default last:border-b-0 flex items-center px-4 gap-4 animate-pulse"
                style={{ animationDelay: `${i * 50}ms` }}
              >
                <div className="h-4 flex-1 bg-surface-secondary rounded" />
                <div className="h-4 w-32 bg-surface-secondary rounded hidden sm:block" />
                <div className="h-4 w-24 bg-surface-secondary rounded hidden md:block" />
                <div className="h-4 w-20 bg-surface-secondary rounded" />
                <div className="h-4 w-16 bg-surface-secondary rounded" />
              </div>
            ))}
          </div>
        </>
      )}

      {variant === 'detail' && (
        <div className="space-y-5">
          <div className="bg-zinc-800 dark:bg-zinc-900 rounded-2xl p-6 animate-pulse">
            <div className="flex items-start gap-4">
              <div className="w-14 h-14 rounded-xl bg-zinc-600/40 shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="h-6 w-48 bg-zinc-600/40 rounded" />
                <div className="h-4 w-64 bg-zinc-600/30 rounded" />
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="bg-white/5 rounded-xl p-3.5">
                  <div className="h-2 w-1/2 bg-zinc-600/30 rounded mb-2" />
                  <div className="h-7 w-2/3 bg-zinc-600/40 rounded" />
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            <div className="space-y-5">
              {Array.from({ length: 3 }).map((_, i) => (
                <div
                  key={i}
                  className="bg-surface-elevated rounded-xl border border-border-default p-5 animate-pulse"
                  style={{ animationDelay: `${i * 80}ms` }}
                >
                  <div className="h-3 w-1/3 bg-surface-secondary rounded mb-3" />
                  <div className="h-4 w-full bg-surface-secondary rounded mb-2" />
                  <div className="h-4 w-3/4 bg-surface-secondary rounded" />
                </div>
              ))}
            </div>
            <div className="lg:col-span-2 space-y-5">
              <div className="bg-surface-elevated rounded-xl border border-border-default p-5 animate-pulse">
                <div className="h-3 w-1/4 bg-surface-secondary rounded mb-4" />
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="flex gap-3 mb-3" style={{ animationDelay: `${i * 50}ms` }}>
                    <div className="w-8 h-8 rounded-full bg-surface-secondary shrink-0" />
                    <div className="flex-1 space-y-1.5">
                      <div className="h-3 w-3/4 bg-surface-secondary rounded" />
                      <div className="h-2 w-1/3 bg-surface-secondary rounded opacity-60" />
                    </div>
                  </div>
                ))}
              </div>
              <div className="bg-surface-elevated rounded-xl border border-border-default p-5 animate-pulse">
                <div className="h-12 bg-surface-secondary rounded mb-3" />
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="h-12 border-t border-border-default" />
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {variant === 'form' && (
        <div className="bg-surface-elevated rounded-xl border border-border-default p-6 max-w-3xl space-y-5 animate-pulse">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} style={{ animationDelay: `${i * 60}ms` }}>
              <div className="h-3 w-32 bg-surface-secondary rounded mb-2" />
              <div className="h-10 bg-surface-secondary rounded" />
            </div>
          ))}
          <div className="flex gap-3 pt-2">
            <div className="h-10 w-24 bg-surface-secondary rounded" />
            <div className="h-10 w-24 bg-surface-secondary rounded" />
          </div>
        </div>
      )}

      {variant === 'dashboard' && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="bg-surface-elevated rounded-lg border border-border-default p-4 animate-pulse"
                style={{ animationDelay: `${i * 60}ms` }}
              >
                <div className="h-3 w-1/3 bg-surface-secondary rounded mb-2" />
                <div className="h-8 w-1/2 bg-surface-secondary rounded" />
              </div>
            ))}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            <div className="lg:col-span-2 bg-surface-elevated rounded-xl border border-border-default p-5 animate-pulse h-72" />
            <div className="bg-surface-elevated rounded-xl border border-border-default p-5 animate-pulse h-72" />
          </div>
        </>
      )}
    </div>
  )
}
