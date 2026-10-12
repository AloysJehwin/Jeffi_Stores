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
      <section className="w-full px-6 lg:px-12 pt-10 pb-20 sm:pt-14">
        <nav className="text-sm text-foreground-muted mb-8">
          <Link href="/apps" className="hover:text-foreground">Apps</Link>
          <span className="mx-2">/</span>
          <span className="text-foreground-secondary">{app.group}</span>
        </nav>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.6fr] gap-10 items-start">
          <div>
            <span className="org-sage grid place-items-center w-16 h-16 rounded-full org-sage-text">
              <AppIcon name={app.icon} className="w-7 h-7" />
            </span>
            <Eyebrow className="mt-6">{app.group}</Eyebrow>
            <Display as="h1" className="mt-2 text-4xl lg:text-5xl">{app.name}</Display>
            <p className="mt-4 text-lg text-foreground-secondary">{app.blurb}</p>
            <ul className="mt-8 space-y-4">
              {benefits.map(b => (
                <li key={b} className="flex items-start gap-3">
                  <Dot tone="terracotta" className="mt-1.5" />
                  <span className="text-foreground-secondary">{b}</span>
                </li>
              ))}
            </ul>
            <div className="mt-9 flex flex-wrap gap-3">
              <Pill href="/signup">Start your store</Pill>
              <Pill href="/apps" tone="sand">All apps</Pill>
            </div>
          </div>

          <div className="rounded-[2rem] org-sand p-4 sm:p-6">
            <AppDemo slug={slug} />
          </div>
        </div>
      </section>
    </div>
  )
}
