import Link from 'next/link'
import { notFound } from 'next/navigation'
import { findApp } from '@/app/(ecom)/ecom/apps'
import AppIcon from '@/app/(ecom)/ecom/apps/AppIcon'
import { Eyebrow, Display, Pill, Dot } from '@/app/(ecom)/ecom/_ui'
import AppDemo from '@/app/(ecom)/ecom/apps/_demos'

export const dynamic = 'force-dynamic'

export default async function AppDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const app = findApp(slug)
  if (!app) notFound()
  const benefits = app.benefits ?? [app.blurb, 'Built into the same platform — no extra tools to wire up.', 'Works on your own subdomain, on desktop and mobile.']

  return (
    <div className="bg-surface text-foreground">
      <section className="w-full px-4 sm:px-6 lg:px-12 pt-6 pb-12 sm:pt-14 sm:pb-20">
        <nav className="text-sm text-foreground-muted mb-6 sm:mb-8">
          <Link href="/apps" className="inline-block py-3 -my-3 sm:inline sm:py-0 sm:my-0 hover:text-foreground">Apps</Link>
          <span className="mx-2">/</span>
          <span className="text-foreground-secondary">{app.group}</span>
        </nav>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.6fr] gap-8 sm:gap-10 items-start">
          <div>
            <span className="org-sage grid place-items-center w-14 h-14 sm:w-16 sm:h-16 rounded-full org-sage-text">
              <AppIcon name={app.icon} className="w-6 h-6 sm:w-7 sm:h-7" />
            </span>
            <Eyebrow className="mt-5 sm:mt-6">{app.group}</Eyebrow>
            <Display as="h1" className="mt-2 text-4xl lg:text-5xl break-words">{app.name}</Display>
            <p className="mt-3 sm:mt-4 text-base sm:text-lg text-foreground-secondary">{app.blurb}</p>
            <ul className="mt-6 sm:mt-8 space-y-3 sm:space-y-4">
              {benefits.map(b => (
                <li key={b} className="flex items-start gap-3">
                  <Dot tone="terracotta" className="mt-1.5 shrink-0" />
                  <span className="min-w-0 text-foreground-secondary">{b}</span>
                </li>
              ))}
            </ul>
            <div className="mt-8 sm:mt-9 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <Pill href="/signup" className="min-h-11 sm:min-h-0 w-full sm:w-auto">Start your store</Pill>
              <Pill href="/apps" tone="sand" className="min-h-11 sm:min-h-0 w-full sm:w-auto">All apps</Pill>
            </div>
          </div>

          <div className="rounded-3xl sm:rounded-[2rem] org-sand p-3 sm:p-6">
            <AppDemo slug={slug} />
          </div>
        </div>
      </section>
    </div>
  )
}
