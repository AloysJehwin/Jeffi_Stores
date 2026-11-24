import Link from 'next/link'
import { Check, Plus } from 'lucide-react'
import { loadOwnerContext } from '@controller/lib/ecom/owner-context'
import { consoleShowcases, showcaseConsoleState } from '@controller/lib/showcase/state'
import { showcaseOfferText } from '@/lib/showcase/offer'
import PageHeader from '../_components/PageHeader'
import SitesList from './SitesList'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Showcase' }

const NEW_SITE = '/onboard/showcase?new=1'

const POINTS = [
  'Your work, services, reviews and contacts on one page, at site-yourname.jeffistores.in',
  'Enquiries from its contact form land in your inbox here, and by email',
  `${showcaseOfferText().replace(/^./, c => c.toUpperCase())}, counted from when you publish`,
]

export default async function ShowcasePage({ searchParams }: { searchParams: Promise<{ tenant?: string }> }) {
  const { tenant: tenantSlug } = await searchParams
  const { owner, tenant } = await loadOwnerContext({ tenantSlug })
  const sites = await consoleShowcases(owner.id)

  if (!sites.length) {
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
          <Link href={NEW_SITE} className="mt-6 inline-flex rounded-full ecom-accent-bg px-5 py-2 text-sm font-semibold text-white">
            Create your site
          </Link>
        </section>
      </>
    )
  }

  const states = await Promise.all(sites.map(showcaseConsoleState))
  return (
    <>
      <PageHeader
        eyebrow="Showcase"
        title={states.length === 1 ? 'Your site' : 'Your sites'}
        description="One-page sites for your business. Each has its own address, enquiries and hosting."
        actions={
          <Link href={NEW_SITE} className="inline-flex items-center gap-1.5 rounded-full ecom-accent-bg px-5 py-2 text-sm font-semibold text-white">
            <Plus className="h-4 w-4" /> New site
          </Link>
        }
      />
      <SitesList sites={states} tenantSlug={tenant.slug} />
    </>
  )
}
