import { Sk } from '@/components/admin/kit/skeleton'

export default function Loading() {
  return (
    <div className="bg-surface text-foreground" aria-busy="true" aria-label="Loading">
      <section className="w-full px-4 sm:px-6 lg:px-12 pt-6 pb-12 sm:pt-14 sm:pb-20">
        <nav className="flex items-center text-sm text-foreground-muted mb-6 sm:mb-8">
          <span>Apps</span>
          <span className="mx-2">/</span>
          <Sk className="h-3.5 w-20" />
        </nav>
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.6fr] gap-8 sm:gap-10 items-start">
          <div>
            <Sk className="w-14 h-14 sm:w-16 sm:h-16 rounded-full" />
            <Sk className="mt-5 sm:mt-6 h-3 w-24" />
            <Sk className="mt-3 h-10 w-64 max-w-full" />
            <Sk className="mt-4 h-4 w-5/6" />
            <div className="mt-6 sm:mt-8 space-y-4">
              {Array.from({ length: 3 }).map((_, i) => <Sk key={i} className={`h-4 ${i % 2 ? 'w-2/3' : 'w-4/5'}`} />)}
            </div>
            <div className="mt-8 sm:mt-9 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <span className="inline-flex items-center justify-center rounded-full px-5 py-2.5 text-sm font-display font-bold ecom-accent-bg text-white">Start your store</span>
              <span className="inline-flex items-center justify-center rounded-full px-5 py-2.5 text-sm font-display font-bold org-sand text-foreground">All apps</span>
            </div>
          </div>
          <div className="rounded-3xl sm:rounded-[2rem] org-sand p-3 sm:p-6">
            <Sk className="h-[420px] w-full rounded-2xl" />
          </div>
        </div>
      </section>
    </div>
  )
}
