interface VisitorSkeletonProps {
  variant?: 'page' | 'form' | 'list'
}

export default function VisitorSkeleton({ variant = 'page' }: VisitorSkeletonProps) {
  if (variant === 'form') {
    return (
      <div className="max-w-md mx-auto px-4 py-12 animate-fade-in">
        <div className="h-8 w-40 bg-surface-secondary rounded animate-pulse mx-auto mb-3" />
        <div className="h-4 w-56 bg-surface-secondary rounded animate-pulse mx-auto mb-8 opacity-60" />
        <div className="bg-surface-elevated rounded-xl border border-border-default p-6 space-y-4 animate-pulse">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} style={{ animationDelay: `${i * 60}ms` }}>
              <div className="h-3 w-20 bg-surface-secondary rounded mb-2" />
              <div className="h-10 bg-surface-secondary rounded" />
            </div>
          ))}
          <div className="h-10 bg-surface-secondary rounded mt-6" />
        </div>
      </div>
    )
  }

  if (variant === 'list') {
    return (
      <div className="max-w-7xl mx-auto px-4 py-8 animate-fade-in">
        <div className="h-8 w-48 bg-surface-secondary rounded animate-pulse mb-6" />
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="h-20 bg-surface-elevated rounded-lg border border-border-default animate-pulse"
              style={{ animationDelay: `${i * 60}ms` }}
            />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 animate-fade-in">
      <div className="h-9 w-64 bg-surface-secondary rounded animate-pulse mb-3" />
      <div className="h-4 w-96 bg-surface-secondary rounded animate-pulse mb-8 opacity-60" />
      <div className="space-y-3 animate-pulse">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="h-4 bg-surface-secondary rounded"
            style={{ width: `${60 + Math.random() * 40}%`, animationDelay: `${i * 50}ms` }}
          />
        ))}
      </div>
    </div>
  )
}
