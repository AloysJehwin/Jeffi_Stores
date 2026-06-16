export default function Loading() {
  return (
    <div className="container mx-auto px-3 sm:px-4 py-6 animate-fade-in">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-12">
        <div className="space-y-3">
          <div className="aspect-square bg-surface-secondary rounded-lg animate-pulse" />
          <div className="grid grid-cols-4 gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="aspect-square bg-surface-secondary rounded-lg animate-pulse" style={{ animationDelay: `${i * 80}ms` }} />
            ))}
          </div>
        </div>
        <div className="space-y-4">
          <div className="h-4 w-24 bg-surface-secondary rounded animate-pulse" />
          <div className="h-8 w-3/4 bg-surface-secondary rounded animate-pulse" />
          <div className="h-5 w-1/2 bg-surface-secondary rounded animate-pulse" />
          <div className="h-10 w-40 bg-surface-secondary rounded animate-pulse" />
          <div className="h-px bg-border-default my-4" />
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-4 bg-surface-secondary rounded animate-pulse" style={{ width: `${90 - i * 10}%`, animationDelay: `${i * 80}ms` }} />
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3 pt-4">
            <div className="aspect-[5/3] bg-surface-secondary rounded-xl animate-pulse" />
            <div className="aspect-[5/3] bg-surface-secondary rounded-xl animate-pulse" />
            <div className="aspect-[5/3] bg-surface-secondary rounded-xl animate-pulse" />
            <div className="aspect-[5/3] bg-surface-secondary rounded-xl animate-pulse" />
          </div>
          <div className="h-12 bg-surface-secondary rounded-lg animate-pulse mt-4" />
          <div className="h-12 bg-surface-secondary rounded-lg animate-pulse" />
        </div>
      </div>
    </div>
  )
}
