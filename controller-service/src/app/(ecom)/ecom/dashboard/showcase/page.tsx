import Link from 'next/link'
import { Check } from 'lucide-react'
import { loadOwnerContext } from '@controller/lib/ecom/owner-context'
import { consoleShowcase, showcaseConsoleState } from '@controller/lib/showcase/state'
import { SHOWCASE_FREE_DAYS, SHOWCASE_PRICE_INR } from '@/lib/showcase/types'
import PageHeader from '../_components/PageHeader'
import ShowcaseClient from './ShowcaseClient'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Showcase' }

const POINTS = [
  'Your work, services, reviews and contacts on one page, at site-yourname.jeffistores.in',
  'Enquiries from its contact form land in your inbox here, and by email',
  `Free for the first ${SHOWCASE_FREE_DAYS} days from when you publish, then ₹${SHOWCASE_PRICE_INR} a month from your wallet`,
]

export default async function ShowcasePage({ searchParams }: { searchParams: Promise<{ tenant?: string }> }) {
  const { tenant: tenantSlug } = await searchParams
  const { owner, tenant } = await loadOwnerContext({ tenantSlug })
  const site = await consoleShowcase(owner.id, tenant.id)

  if (!site) {
    return (
      <>
        <PageHeader eyebrow="Showcase" title="A website for your business" description="A one-page site that shows what you do and brings you enquiries. Made with AI in a few minutes; you can change anything after." />
        <section className="max-w-2xl rounded-2xl border border-border-default bg-surface-elevated p-6">
          <ul className="space-y-2.5 text-sm text-foreground-secondary">
            {POINTS.map(p => (
              <li key={p} className="flex gap-2">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-foreground-muted" />
                {p}
              </li>
            ))}
          </ul>
          <Link href="/onboard/showcase" className="mt-6 inline-flex rounded-full ecom-accent-bg px-5 py-2 text-sm font-semibold text-white">
            Create your site
          </Link>
        </section>
      </>
    )
  }

  return <ShowcaseClient initial={await showcaseConsoleState(site)} tenantSlug={tenant.slug} />
}
