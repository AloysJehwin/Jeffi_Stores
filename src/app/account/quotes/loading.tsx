export default function Loading() {
  return (
    <div className="bg-surface min-h-screen py-6 lg:py-8 animate-fade-in">
      <div className="container mx-auto px-4">
        <div className="grid grid-cols-1 gap-6">
          <div>
            <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default">
              <div className="px-6 py-4 border-b border-border-default">
                <div className="h-4 w-80 max-w-full bg-surface-secondary rounded animate-pulse" />
              </div>
              <div className="divide-y divide-border-default">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div
                    key={i}
                    className="p-5 flex items-start justify-between gap-4 animate-pulse"
                    style={{ animationDelay: `${i * 80}ms` }}
                  >
                    <div className="flex-1 min-w-0 space-y-2">
                      <div className="flex items-center gap-2">
                        <div className="h-4 w-32 bg-surface-secondary rounded" />
                        <div className="h-5 w-20 bg-surface-secondary rounded-full" />
                      </div>
                      <div className="h-3 w-16 bg-surface-secondary rounded" />
                      <div className="h-3 w-1/2 bg-surface-secondary rounded" />
                      <div className="h-3 w-40 bg-surface-secondary rounded" />
                    </div>
                    <div className="h-3 w-32 bg-surface-secondary rounded shrink-0 hidden sm:block" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
