export default function Loading() {
  return (
    <div className="bg-surface animate-pulse">

      {/* Hero carousel skeleton */}
      <div className="px-3 sm:px-6 md:px-8 pt-3 pb-0 md:pt-6 h-[calc(100svh-4rem-392px)] sm:h-[calc(100svh-4rem-360px)] lg:h-[calc(100svh-5rem-300px)]">
        <div className="w-full h-full rounded-2xl bg-surface-secondary" />
      </div>

      {/* Shop by Category skeleton */}
      <section className="pt-8 pb-12 md:py-20 bg-surface">
        <div className="container mx-auto px-4">
          <div className="flex items-end justify-between mb-7">
            <div className="space-y-2">
              <div className="h-2.5 w-14 rounded bg-surface-secondary" />
              <div className="h-7 w-44 rounded bg-surface-secondary" />
            </div>
            <div className="hidden sm:block h-4 w-16 rounded bg-surface-secondary" />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 lg:grid-cols-8">
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className="flex flex-col items-center gap-2.5 p-4 rounded-2xl bg-surface-elevated border border-border-default"
                style={{ animationDelay: `${i * 40}ms` }}
              >
                <div className="w-12 h-12 rounded-xl bg-surface-secondary" />
                <div className="h-3 w-20 rounded bg-surface-secondary" />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Featured products skeleton */}
      <section className="py-12 md:py-20 bg-surface-secondary">
        <div className="container mx-auto px-4">
          <div className="flex items-end justify-between mb-7">
            <div className="space-y-2">
              <div className="h-2.5 w-16 rounded bg-surface" />
              <div className="h-7 w-48 rounded bg-surface" />
            </div>
            <div className="hidden sm:block h-4 w-16 rounded bg-surface" />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-5">
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className="bg-surface rounded-xl border border-border-default p-3"
                style={{ animationDelay: `${i * 50}ms` }}
              >
                <div className="aspect-square rounded-lg bg-surface-secondary mb-3" />
                <div className="h-3.5 w-full rounded bg-surface-secondary mb-2" />
                <div className="h-3.5 w-3/4 rounded bg-surface-secondary mb-3" />
                <div className="h-5 w-1/3 rounded bg-surface-secondary" />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* New arrivals skeleton */}
      <section className="py-12 md:py-20 bg-surface">
        <div className="container mx-auto px-4">
          <div className="flex items-end justify-between mb-7">
            <div className="space-y-2">
              <div className="h-2.5 w-20 rounded bg-surface-secondary" />
              <div className="h-7 w-40 rounded bg-surface-secondary" />
            </div>
            <div className="hidden sm:block h-4 w-16 rounded bg-surface-secondary" />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-5">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="bg-surface-elevated rounded-xl border border-border-default p-3"
                style={{ animationDelay: `${i * 60}ms` }}
              >
                <div className="aspect-square rounded-lg bg-surface-secondary mb-3" />
                <div className="h-3.5 w-full rounded bg-surface-secondary mb-2" />
                <div className="h-3.5 w-2/3 rounded bg-surface-secondary mb-3" />
                <div className="h-5 w-1/3 rounded bg-surface-secondary" />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Business CTA skeleton */}
      <div className="px-3 sm:px-6 md:px-8 py-3 md:py-6 bg-surface">
        <div className="rounded-2xl bg-surface-secondary min-h-[340px] md:min-h-[400px]" />
      </div>

    </div>
  )
}
