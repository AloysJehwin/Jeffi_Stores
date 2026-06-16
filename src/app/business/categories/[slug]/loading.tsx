export default function Loading() {
  return (
    <div className="bg-surface min-h-screen animate-fade-in">
      <div className="container mx-auto px-4 py-6">
        <div className="bg-surface-elevated rounded-2xl border border-border-default p-6 sm:p-10 mb-6 animate-pulse">
          <div className="flex flex-col sm:flex-row items-center gap-4 sm:gap-6">
            <div className="w-32 h-32 bg-surface-secondary rounded-2xl shrink-0" />
            <div className="flex-1 space-y-3 w-full">
              <div className="h-8 w-2/3 bg-surface-secondary rounded mx-auto sm:mx-0" />
              <div className="h-4 w-1/2 bg-surface-secondary rounded mx-auto sm:mx-0" />
              <div className="h-4 w-3/4 bg-surface-secondary rounded mx-auto sm:mx-0" />
            </div>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 stagger-grid gap-6">
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className="bg-surface-elevated rounded-lg border border-border-default p-3 animate-pulse" style={{ animationDelay: `${i * 80}ms` }}>
              <div className="aspect-[5/3] bg-surface-secondary rounded-lg mb-4" />
              <div className="h-4 bg-surface-secondary rounded mb-2" />
              <div className="h-4 bg-surface-secondary rounded w-3/4 mb-3" />
              <div className="h-6 bg-surface-secondary rounded w-1/3" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
