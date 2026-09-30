export default function Loading() {
  return (
    <div className="container mx-auto px-4 py-6 animate-fade-in">
      <div className="h-8 w-40 bg-surface-secondary rounded animate-pulse mb-6" />
      <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default divide-y divide-border-default">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="p-4 sm:p-6 flex items-center justify-between gap-4 animate-pulse"
            style={{ animationDelay: `${i * 80}ms` }}
          >
            <div className="flex-1 space-y-2">
              <div className="h-4 w-2/3 bg-surface-secondary rounded" />
              <div className="h-3 w-1/3 bg-surface-secondary rounded" />
            </div>
            <div className="h-9 w-20 bg-surface-secondary rounded-lg shrink-0" />
          </div>
        ))}
      </div>
    </div>
  )
}
