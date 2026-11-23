import Link from 'next/link'
import clsx from 'clsx'
import { ChevronRight } from 'lucide-react'
import { APP_GROUPS, appPlanTags } from '@controller/app/(ecom)/ecom/apps'
import AppIcon from './AppIcon'
import { Eyebrow, Display, Pill, SandCard } from '@controller/app/(ecom)/ecom/_ui'
import { PlanTag, lastGroupSpan } from '@controller/app/(ecom)/ecom/_sections/AppsGrid'
import { loadPlanFacts, plansLine } from '@controller/app/(ecom)/ecom/_sections/plan-facts'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Apps' }

export default async function AppsIndexPage() {
  const { plans, matrix, fromInr } = await loadPlanFacts()
  const tags = appPlanTags(plans, matrix)
  const tagged = Object.keys(tags).length > 0
  return (
    <div className="bg-surface text-foreground relative overflow-hidden">
      <div aria-hidden className="org-sage absolute -top-24 -right-24 w-72 h-72 sm:-top-40 sm:w-[520px] sm:h-[520px] rounded-full opacity-70" />
      <section className="relative w-full px-4 sm:px-6 lg:px-12 pt-10 pb-6 sm:pt-24 sm:pb-10">
        <Eyebrow>One platform</Eyebrow>
        <Display as="h1" className="mt-3 text-5xl lg:text-7xl">All apps</Display>
        <p className="mt-4 sm:mt-5 text-base sm:text-lg text-foreground-secondary max-w-2xl">
          Everything your store needs, grouped and ready — catalogue, sales, fulfilment, finance, marketing and more.
          Each one has a walkthrough you can click through.{tagged && ' A tag shows the lowest plan an app comes with.'}
        </p>
      </section>

      <section className="relative w-full px-4 sm:px-6 lg:px-12 py-6 sm:py-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5">
        {APP_GROUPS.map((g, gi) => (
          <SandCard key={g.group} className={clsx('p-6', lastGroupSpan(gi, APP_GROUPS.length))}>
            <Eyebrow className="text-[11px]">{g.group}</Eyebrow>
            <ul className="mt-5 space-y-4">
              {g.apps.map(a => (
                <li key={a.slug}>
                  <Link href={`/apps/${a.slug}`} className="group flex items-center gap-4 min-h-11 sm:min-h-0">
                    <span className="org-sage org-sage-text shrink-0 grid place-items-center w-10 h-10 rounded-full"><AppIcon name={a.icon} className="w-4 h-4" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="font-semibold text-foreground group-hover:org-brown">{a.name}</span>
                        {tags[a.slug] && <PlanTag label={tags[a.slug]} />}
                      </span>
                      <span className="mt-0.5 block text-sm text-foreground-secondary line-clamp-2">{a.blurb}</span>
                    </span>
                    <ChevronRight aria-hidden className="h-4 w-4 shrink-0 text-foreground-muted transition-transform group-hover:translate-x-0.5" />
                  </Link>
                </li>
              ))}
            </ul>
          </SandCard>
        ))}
      </section>

      <section className="w-full px-4 sm:px-6 lg:px-12 py-14 sm:py-24 text-center">
        <Display className="text-4xl lg:text-6xl max-w-2xl mx-auto">Start with what you need</Display>
        <p className="text-foreground-secondary mt-4 sm:mt-5 text-base sm:text-lg">Pick the plan that fits and move up as you grow.</p>
        <p className="text-foreground-muted mt-2 text-sm">{plansLine(fromInr)}</p>
        <div className="mt-8 sm:mt-9 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-center sm:gap-6">
          <Pill href="/signup" className="w-full sm:w-auto px-8 py-4 text-base">Start your store</Pill>
          <Pill tone="ghost" href="/pricing" className="text-base max-sm:min-h-12">Compare plans</Pill>
        </div>
      </section>
    </div>
  )
}
