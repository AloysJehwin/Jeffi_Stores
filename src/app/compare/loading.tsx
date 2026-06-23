export default function Loading() {
  return (
    <div className="bg-surface min-h-screen animate-fade-in">
      <div className="bg-surface-elevated border-b border-border-default">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center gap-2">
            <div className="h-3 w-10 bg-surface-secondary rounded animate-pulse" />
            <div className="h-3 w-3 bg-surface-secondary rounded animate-pulse" />
            <div className="h-3 w-16 bg-surface-secondary rounded animate-pulse" />
            <div className="h-3 w-3 bg-surface-secondary rounded animate-pulse" />
            <div className="h-3 w-14 bg-surface-secondary rounded animate-pulse" />
          </div>
        </div>
      </div>
      <div className="container mx-auto px-4 py-6 sm:py-8">
        <div className="flex items-center justify-between mb-6">
          <div className="h-8 w-48 bg-surface-secondary rounded animate-pulse" />
          <div className="h-8 w-28 bg-surface-secondary rounded-lg animate-pulse" />
        </div>
        <div className="bg-surface-elevated rounded-xl border border-border-default shadow-sm overflow-hidden">
          <div className="grid grid-cols-4 border-b border-border-default p-4 gap-4">
            <div className="w-36" />
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="space-y-3" style={{ animationDelay: `${i * 80}ms` }}>
                <div className="aspect-square max-w-[120px] mx-auto bg-surface-secondary rounded-lg animate-pulse" />
                <div className="h-4 bg-surface-secondary rounded animate-pulse" />
                <div className="h-4 w-3/4 bg-surface-secondary rounded animate-pulse" />
                <div className="h-5 w-16 bg-surface-secondary rounded-full animate-pulse" />
              </div>
            ))}
          </div>
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className={`grid grid-cols-4 gap-4 px-4 py-3 border-b border-border-default last:border-0 ${i % 2 === 0 ? 'bg-surface' : 'bg-surface-elevated'}`}>
              <div className="h-3 w-20 bg-surface-secondary rounded animate-pulse" style={{ animationDelay: `${i * 40}ms` }} />
              {Array.from({ length: 3 }).map((_, j) => (
                <div key={j} className="h-3 bg-surface-secondary rounded animate-pulse" style={{ width: `${60 + Math.random() * 30}%`, animationDelay: `${(i * 3 + j) * 30}ms` }} />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
