export default function Loading() {
  return (
    <div className="bg-surface animate-fade-in">
      {/* Hero skeleton */}
      <section className="bg-gradient-to-br from-primary-600/80 via-primary-500/80 to-primary-700/80 min-h-[calc(100svh-4rem)] md:min-h-[calc(100vh-5rem)] flex items-center">
        <div className="container mx-auto px-4 sm:px-6 py-8 sm:py-12 md:py-16 w-full">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 md:gap-12 lg:gap-20 items-center">
            <div className="md:order-1 space-y-4">
              <div className="h-7 w-44 bg-white/30 rounded-full animate-pulse" />
              <div className="h-16 sm:h-20 md:h-24 w-72 sm:w-96 bg-white/40 rounded-xl animate-pulse" />
              <div className="h-5 w-full max-w-md bg-white/25 rounded animate-pulse" />
              <div className="h-5 w-2/3 max-w-md bg-white/25 rounded animate-pulse" />
              <div className="flex gap-3 pt-4">
                <div className="h-12 w-32 bg-white/40 rounded-xl animate-pulse" />
                <div className="h-12 w-28 bg-white/25 rounded-xl animate-pulse" />
              </div>
              <div className="flex items-center gap-5 sm:gap-8 pt-6 border-t border-white/20">
                {[0, 1, 2].map(i => (
                  <div key={i} className="space-y-2">
                    <div className="h-8 w-16 bg-white/40 rounded animate-pulse" style={{ animationDelay: `${i * 80}ms` }} />
                    <div className="h-3 w-14 bg-white/25 rounded animate-pulse" style={{ animationDelay: `${i * 80}ms` }} />
                  </div>
                ))}
              </div>
            </div>
            <div className="hidden md:flex md:order-2 justify-center md:justify-end">
              <div className="w-80 sm:w-96 md:w-full max-w-xl lg:max-w-2xl aspect-square bg-white/20 rounded-2xl animate-pulse" />
            </div>
          </div>
        </div>
      </section>

      {/* Categories skeleton */}
      <section className="py-8 md:py-20">
        <div className="container mx-auto px-4">
          <div className="flex items-center justify-between mb-5">
            <div className="space-y-2">
              <div className="h-3 w-16 bg-surface-secondary rounded animate-pulse" />
              <div className="h-7 w-48 bg-surface-secondary rounded animate-pulse" />
            </div>
            <div className="h-4 w-16 bg-surface-secondary rounded animate-pulse" />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3 lg:grid-cols-8">
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className="bg-surface-elevated border border-border-default rounded-xl p-3 flex flex-col items-center gap-2 animate-pulse"
                style={{ animationDelay: `${i * 50}ms` }}
              >
                <div className="w-11 h-11 sm:w-14 sm:h-14 rounded-xl bg-surface-secondary" />
                <div className="h-3 w-20 bg-surface-secondary rounded" />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Featured products skeleton */}
      <section className="py-8 md:py-20 bg-surface-secondary">
        <div className="container mx-auto px-4">
          <div className="flex items-center justify-between mb-5">
            <div className="space-y-2">
              <div className="h-3 w-20 bg-surface rounded animate-pulse" />
              <div className="h-7 w-56 bg-surface rounded animate-pulse" />
            </div>
            <div className="h-4 w-16 bg-surface rounded animate-pulse" />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="bg-surface rounded-lg border border-border-default p-3 animate-pulse"
                style={{ animationDelay: `${i * 70}ms` }}
              >
                <div className="aspect-square bg-surface-secondary rounded-lg mb-3" />
                <div className="h-4 bg-surface-secondary rounded mb-2" />
                <div className="h-4 w-3/4 bg-surface-secondary rounded mb-3" />
                <div className="h-6 w-1/3 bg-surface-secondary rounded" />
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}
