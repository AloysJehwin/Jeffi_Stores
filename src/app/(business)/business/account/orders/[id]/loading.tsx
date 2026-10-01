export default function Loading() {
  return (
    <div className="container mx-auto px-4 py-6 animate-fade-in">
      <div className="h-4 w-40 bg-surface-secondary rounded animate-pulse mb-4" />
      <div className="h-8 w-64 bg-surface-secondary rounded animate-pulse mb-6" />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default p-6 space-y-3 animate-pulse">
            <div className="h-6 w-1/3 bg-surface-secondary rounded" />
            <div className="grid grid-cols-1 sm:grid-cols-5 gap-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-12 bg-surface-secondary rounded" style={{ animationDelay: `${i * 80}ms` }} />
              ))}
            </div>
          </div>
          <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default p-6 space-y-3 animate-pulse">
            <div className="h-6 w-1/4 bg-surface-secondary rounded" />
            {Array.from({ length: 2 }).map((_, i) => (
              <div
                key={i}
                className="flex gap-4 py-3 border-b border-border-default last:border-b-0"
                style={{ animationDelay: `${i * 100}ms` }}
              >
                <div className="w-16 h-16 bg-surface-secondary rounded-lg shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-3/4 bg-surface-secondary rounded" />
                  <div className="h-3 w-1/3 bg-surface-secondary rounded" />
                </div>
                <div className="h-5 w-16 bg-surface-secondary rounded" />
              </div>
            ))}
          </div>
        </div>
        <div className="space-y-6">
          <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default p-6 space-y-3 animate-pulse">
            <div className="h-6 w-1/2 bg-surface-secondary rounded" />
            <div className="h-4 bg-surface-secondary rounded" />
            <div className="h-4 bg-surface-secondary rounded w-3/4" />
            <div className="h-4 bg-surface-secondary rounded w-2/3" />
          </div>
          <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default p-6 space-y-3 animate-pulse">
            <div className="h-6 w-1/2 bg-surface-secondary rounded" />
            <div className="h-4 bg-surface-secondary rounded" />
            <div className="h-4 bg-surface-secondary rounded" />
            <div className="h-px bg-border-default" />
            <div className="h-5 w-1/2 bg-surface-secondary rounded" />
          </div>
        </div>
      </div>
    </div>
  )
}
