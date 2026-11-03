export default function ServiceAccountsLoading() {
  return (
    <div className="p-4 sm:p-6 space-y-6 animate-pulse">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <div className="h-7 w-48 bg-surface-secondary rounded-lg" />
          <div className="h-4 w-32 bg-surface-secondary rounded" />
        </div>
        <div className="h-9 w-24 bg-surface-secondary rounded-lg" />
      </div>

      <div className="bg-surface-elevated rounded-xl border border-border-default shadow-sm overflow-hidden">
        <div className="hidden md:block">
          <div className="border-b border-border-default bg-surface-secondary/40 h-10" />
          {[...Array(4)].map((_, i) => (
            <div key={i} className="border-b border-border-default px-5 py-3 flex items-center gap-4">
              <div className="h-4 w-32 bg-surface-secondary rounded" />
              <div className="h-4 w-40 bg-surface-secondary rounded" />
              <div className="h-5 w-20 bg-surface-secondary rounded-full" />
              <div className="h-5 w-14 bg-surface-secondary rounded-full ml-auto" />
            </div>
          ))}
        </div>
        <div className="md:hidden divide-y divide-border-default">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="p-4 space-y-2.5">
              <div className="h-4 w-40 bg-surface-secondary rounded" />
              <div className="flex gap-1">
                <div className="h-5 w-16 bg-surface-secondary rounded-full" />
                <div className="h-5 w-20 bg-surface-secondary rounded-full" />
              </div>
              <div className="h-3 w-32 bg-surface-secondary rounded" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
