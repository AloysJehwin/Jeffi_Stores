import { Sk } from '@/components/admin/kit/skeleton'
import { Eyebrow, Display, SandCard } from '../_ui'

export default function Loading() {
  return (
    <div className="bg-surface text-foreground relative isolate overflow-hidden" aria-busy="true" aria-label="Loading">
      <section className="relative">
        <div aria-hidden className="org-sage absolute -top-24 -right-36 w-[300px] h-[300px] rounded-full opacity-80 sm:-top-40 sm:-right-24 sm:w-[560px] sm:h-[560px]" />
        <div className="relative w-full px-4 sm:px-6 lg:px-12 pt-10 pb-10 sm:pt-28 sm:pb-12">
          <Display as="h1" className="text-5xl sm:text-7xl lg:text-8xl max-w-4xl">
            Sell anything.
            <br />
            <span className="ecom-accent-text">We run the store.</span>
          </Display>
          <p className="mt-5 sm:mt-8 text-lg sm:text-xl text-foreground-secondary max-w-2xl leading-relaxed">
            A complete online store on your own subdomain — storefront, admin, payments, delivery and GST, managed for
            you.
          </p>
          <div className="mt-8 flex flex-col items-stretch gap-3 sm:mt-10 sm:flex-row sm:flex-wrap sm:items-center sm:gap-6">
            <span className="inline-flex items-center justify-center rounded-full ecom-accent-bg w-full sm:w-auto px-8 py-4 text-base font-display font-bold text-white">Start your store</span>
            <span className="font-display font-bold text-base ecom-accent-text text-center">See the demo</span>
          </div>
        </div>
        <div className="relative w-full px-4 sm:px-6 lg:px-12 pb-14 sm:pb-20">
          <Sk className="h-[420px] w-full rounded-[2rem] sm:h-[560px]" />
        </div>
      </section>
      <section className="w-full px-4 sm:px-6 lg:px-12 py-12 sm:py-20">
        <Eyebrow>How it works</Eyebrow>
        <Display className="mt-3 text-3xl sm:text-4xl lg:text-5xl">Live in three steps</Display>
        <div className="mt-8 grid grid-cols-1 gap-4 sm:mt-10 md:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <SandCard key={i} className="space-y-3">
              <Sk className="h-16 w-16 rounded-full" />
              <Sk className="h-6 w-2/3" />
              <Sk className="h-4 w-full" />
            </SandCard>
          ))}
        </div>
      </section>
    </div>
  )
}
