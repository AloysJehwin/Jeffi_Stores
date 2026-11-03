export default function Loading() {
  return (
    <div className="container mx-auto px-4 py-6 animate-fade-in">
      <div className="h-8 w-32 bg-surface-secondary rounded animate-pulse mb-6" />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="bg-surface-elevated rounded-lg border border-border-default p-3 animate-pulse"
            style={{ animationDelay: `${i * 60}ms` }}
          >
            <div className="aspect-square bg-surface-secondary rounded-lg mb-3" />
            <div className="h-4 bg-surface-secondary rounded mb-2" />
            <div className="h-4 bg-surface-secondary rounded w-2/3" />
          </div>
        ))}
      </div>
    </div>
  )
}
