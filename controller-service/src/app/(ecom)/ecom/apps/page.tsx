import Link from 'next/link'
import { APP_GROUPS } from '@/app/(ecom)/ecom/apps'
import AppIcon from './AppIcon'
import { Eyebrow, Display, Pill, SandCard } from '@/app/(ecom)/ecom/_ui'

export const dynamic = 'force-dynamic'

export default function AppsIndexPage() {
  return (
    <div className="bg-surface text-foreground relative overflow-hidden">
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
                <li key={a.slug}>
                  <Link href={`/apps/${a.slug}`} className="group flex items-center gap-4 min-h-11 sm:min-h-0">
                    <span className="org-sage org-sage-text shrink-0 grid place-items-center w-10 h-10 rounded-full"><AppIcon name={a.icon} className="w-4 h-4" /></span>
                    <span className="min-w-0">
                      <span className="block font-semibold text-foreground group-hover:org-brown">{a.name}</span>
                      <span className="block text-sm text-foreground-secondary sm:truncate">{a.blurb}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </SandCard>
        ))}
      </section>

      <section className="w-full px-4 sm:px-6 lg:px-12 py-14 sm:py-24 text-center">
        <Display className="text-4xl lg:text-6xl max-w-2xl mx-auto">Start with all of it</Display>
        <p className="text-foreground-secondary mt-4 sm:mt-5 text-base sm:text-lg">Set up your store in minutes and switch on the apps you need.</p>
        <Pill href="/signup" className="mt-8 sm:mt-9 w-full sm:w-auto px-8 py-4 text-base">Start your store</Pill>
      </section>
    </div>
  )
}
