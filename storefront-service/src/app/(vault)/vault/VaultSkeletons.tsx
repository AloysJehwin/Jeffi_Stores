import { ChevronRight } from 'lucide-react'

// The vault is always dark: shimmer blocks use its neutral tints, and `dark` keeps the sweep soft.
function Bar({ className }: { className: string }) {
  return <span aria-hidden className={`sk block ${/\brounded-/.test(className) ? '' : 'rounded'} ${className}`} />
}

export function VaultLibrarySkeleton() {
  return (
    <main className="dark mx-auto max-w-7xl px-4 pb-16 pt-8 sm:px-6 sm:pt-10" role="status" aria-busy="true" aria-label="Loading library">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">Your library</h1>
        <Bar className="mt-2 h-4 w-20 bg-white/[0.06]" />
      </div>
      <div className="-mx-4 mb-2 flex gap-2 overflow-hidden px-4 pb-1 sm:mx-0 sm:px-0">
        <span className="inline-flex shrink-0 items-center rounded-full bg-white px-3.5 py-1.5 text-sm text-neutral-950">All</span>
        {['w-24', 'w-20', 'w-28'].map(w => (
          <Bar key={w} className={`h-8 shrink-0 rounded-full bg-white/[0.05] ${w}`} />
        ))}
      </div>
      <div className="mb-4" />
      <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 sm:gap-5 lg:grid-cols-4 xl:grid-cols-5">
        {Array.from({ length: 10 }).map((_, i) => (
          <li key={i} className="overflow-hidden rounded-xl bg-neutral-900 ring-1 ring-white/[0.06]">
            <Bar className="aspect-[3/4] w-full rounded-none bg-neutral-800" />
            <div className="p-3 space-y-1.5">
              <Bar className="h-3 w-1/2 bg-white/[0.06]" />
              <Bar className="h-4 w-4/5 bg-white/[0.08]" />
              <Bar className="h-3 w-2/5 bg-white/[0.06]" />
            </div>
          </li>
        ))}
      </ul>
    </main>
  )
}

export function VaultItemSkeleton() {
  return (
    <main className="dark mx-auto max-w-5xl px-4 pb-16 pt-6 sm:px-6 sm:pt-8" role="status" aria-busy="true" aria-label="Loading item">
      <nav aria-label="Breadcrumb" className="mb-4">
        <ol className="flex min-w-0 items-center gap-1.5 text-sm text-neutral-500">
          <li>Library</li>
          <li aria-hidden><ChevronRight className="h-4 w-4" /></li>
          <li><Bar className="h-4 w-40 bg-white/[0.06]" /></li>
        </ol>
      </nav>
      <header className="mb-5">
        <Bar className="h-7 sm:h-8 w-2/3 bg-white/[0.08]" />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {['w-14', 'w-16', 'w-24'].map(w => (
            <Bar key={w} className={`h-6 rounded-md bg-white/[0.05] ${w}`} />
          ))}
        </div>
      </header>
      <div className="overflow-hidden rounded-xl bg-neutral-900 p-2 ring-1 ring-white/[0.06] sm:p-3">
        <Bar className="aspect-[3/4] sm:aspect-[4/3] w-full bg-neutral-800" />
      </div>
    </main>
  )
}
