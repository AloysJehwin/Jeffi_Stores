export default function Loading() {
  return (
    <div className="bg-surface min-h-screen py-6 sm:py-8 animate-fade-in">
      <div className="container mx-auto px-4">
        <div className="h-8 w-32 bg-surface-secondary rounded animate-pulse mb-6" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 lg:gap-8">
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default p-6 space-y-4 animate-pulse">
              <div className="h-6 w-40 bg-surface-secondary rounded" />
              <div className="h-12 bg-surface-secondary rounded-lg" />
              <div className="h-12 bg-surface-secondary rounded-lg" />
              <div className="h-20 bg-surface-secondary rounded-lg" />
            </div>
            <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default p-6 space-y-3 animate-pulse">
              <div className="h-6 w-32 bg-surface-secondary rounded" />
              {Array.from({ length: 2 }).map((_, i) => (
                <div key={i} className="flex gap-4 pb-4 border-b border-border-default last:border-b-0" style={{ animationDelay: `${i * 100}ms` }}>
                  <div className="w-20 h-20 bg-surface-secondary rounded-lg shrink-0" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 w-3/4 bg-surface-secondary rounded" />
                    <div className="h-3 w-1/3 bg-surface-secondary rounded" />
                    <div className="h-4 w-1/4 bg-surface-secondary rounded" />
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default p-6 h-fit space-y-3 animate-pulse">
            <div className="h-6 w-1/2 bg-surface-secondary rounded" />
            <div className="h-px bg-border-default my-2" />
            <div className="h-4 bg-surface-secondary rounded" />
            <div className="h-4 bg-surface-secondary rounded" />
            <div className="h-4 bg-surface-secondary rounded w-3/4" />
            <div className="h-12 bg-surface-secondary rounded-lg mt-4" />
          </div>
        </div>
      </div>
    </div>
  )
}
