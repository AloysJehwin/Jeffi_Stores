import { Sk } from '@/components/admin/kit/skeleton'
import { APP_GROUPS } from '@controller/app/(ecom)/ecom/apps'
import { Eyebrow, Display, SandCard } from '@controller/app/(ecom)/ecom/_ui'

export default function Loading() {
  return (
    <div className="bg-surface text-foreground relative overflow-hidden" aria-busy="true" aria-label="Loading All apps">
      <div aria-hidden className="org-sage absolute -top-24 -right-24 w-72 h-72 sm:-top-40 sm:w-[520px] sm:h-[520px] rounded-full opacity-70" />
      <section className="relative w-full px-4 sm:px-6 lg:px-12 pt-10 pb-6 sm:pt-24 sm:pb-10">
        <Eyebrow>One platform</Eyebrow>
        <Display as="h1" className="mt-3 text-5xl lg:text-7xl">All apps</Display>
        <p className="mt-4 sm:mt-5 text-base sm:text-lg text-foreground-secondary max-w-2xl">
          Everything your store needs, grouped and ready — catalogue, sales, fulfilment, finance, marketing and more.
          Each one has a walkthrough you can click through.
        </p>
      </section>
      <section className="relative w-full px-4 sm:px-6 lg:px-12 py-6 sm:py-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5">
        {APP_GROUPS.map(g => (
          <SandCard key={g.group} className="p-6">
            <Eyebrow className="text-[11px]">{g.group}</Eyebrow>
            <ul className="mt-5 space-y-4">
              {g.apps.map(a => (
                <li key={a.slug} className="flex items-center gap-4">
                  <Sk className="h-10 w-10 shrink-0 rounded-full" />
                  <span className="min-w-0 flex-1 space-y-1.5">
                    <Sk className="h-4 w-28" />
                    <Sk className="h-3 w-4/5" />
                  </span>
                </li>
              ))}
            </ul>
          </SandCard>
        ))}
      </section>
    </div>
  )
}
