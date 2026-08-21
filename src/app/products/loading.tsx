export default function Loading() {
  return (
    <div className="container mx-auto px-4 py-6 animate-fade-in">
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <div className="hidden lg:block">
          <div className="h-12 bg-surface-secondary rounded-lg animate-pulse mb-4" />
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-10 bg-surface-secondary rounded-lg animate-pulse" style={{ animationDelay: `${i * 60}ms` }} />
            ))}
          </div>
        </div>
        <div className="lg:col-span-3">
          <div className="h-10 w-48 bg-surface-secondary rounded-lg animate-pulse mb-6" />
          <div className="grid grid-cols-2 md:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-6">
            {Array.from({ length: 9 }).map((_, i) => (
              <div
                key={i}
                className="bg-surface-elevated rounded-lg border border-border-default p-3 animate-pulse"
                style={{ animationDelay: `${i * 80}ms` }}
              >
                <div className="aspect-[5/3] bg-surface-secondary rounded-lg mb-4" />
                <div className="h-4 bg-surface-secondary rounded mb-2" />
                <div className="h-4 bg-surface-secondary rounded w-3/4 mb-3" />
                <div className="h-6 bg-surface-secondary rounded w-1/3" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
