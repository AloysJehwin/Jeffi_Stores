export default function Loading() {
  return (
    <div className="container mx-auto px-4 py-8 animate-fade-in">
      <div className="h-9 w-48 bg-surface-secondary rounded animate-pulse mb-8" />
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} className="bg-surface-elevated rounded-xl border border-border-default p-4 animate-pulse flex flex-col items-center gap-3" style={{ animationDelay: `${i * 60}ms` }}>
            <div className="w-16 h-16 bg-surface-secondary rounded-full" />
            <div className="h-4 w-3/4 bg-surface-secondary rounded" />
          </div>
        ))}
      </div>
    </div>
  )
}
