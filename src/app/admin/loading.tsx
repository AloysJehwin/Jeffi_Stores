export default function AdminLoading() {
  return (
    <div className="p-4 sm:p-6 animate-fade-in">
      <div className="h-8 w-48 bg-surface-secondary rounded animate-pulse mb-6" />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-surface-elevated rounded-lg border border-border-default p-4 animate-pulse" style={{ animationDelay: `${i * 60}ms` }}>
            <div className="h-3 w-1/3 bg-surface-secondary rounded mb-2" />
            <div className="h-8 w-1/2 bg-surface-secondary rounded" />
          </div>
        ))}
      </div>
      <div className="bg-surface-elevated rounded-lg border border-border-default overflow-hidden animate-pulse">
        <div className="h-12 bg-surface-secondary border-b border-border-default" />
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-14 border-b border-border-default last:border-b-0 flex items-center px-4 gap-4" style={{ animationDelay: `${i * 60}ms` }}>
            <div className="h-4 flex-1 bg-surface-secondary rounded" />
            <div className="h-4 w-24 bg-surface-secondary rounded" />
            <div className="h-4 w-20 bg-surface-secondary rounded" />
            <div className="h-4 w-16 bg-surface-secondary rounded" />
          </div>
        ))}
      </div>
    </div>
  )
}
