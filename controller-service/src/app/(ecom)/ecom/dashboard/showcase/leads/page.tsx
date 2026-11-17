import Link from 'next/link'
import { loadOwnerContext } from '@controller/lib/ecom/owner-context'
import { consoleShowcase } from '@controller/lib/showcase/state'
import { listShowcaseLeads } from '@/lib/showcase/store'
import { showcaseHost } from '@/lib/showcase/host'
import PageHeader from '../../_components/PageHeader'
import LeadsClient from './LeadsClient'

export const dynamic = 'force-dynamic'

const PAGE = 50

export default async function ShowcaseLeadsPage({ searchParams }: { searchParams: Promise<{ tenant?: string }> }) {
  const { tenant: tenantSlug } = await searchParams
  const { owner, tenant } = await loadOwnerContext({ tenantSlug })
  const site = await consoleShowcase(owner.id, tenant.id)
  if (!site) {
    return (
      <>
        <PageHeader eyebrow="Showcase" title="Enquiries" description="Messages from your site's contact form arrive here." />
        <p className="text-sm text-foreground-secondary">
          You don&apos;t have a Showcase site yet.{' '}
          <Link href="/dashboard/showcase" className="font-semibold ecom-accent-text hover:underline">
            Make one
          </Link>
        </p>
      </>
    )
  }
  const first = await listShowcaseLeads(site.id, { limit: PAGE })
  return (
    <>
      <PageHeader eyebrow="Showcase" title="Enquiries" description={`Messages from the contact form on ${showcaseHost(site.slug)}. Each one is also emailed to you.`} />
      <LeadsClient initial={first} pageSize={PAGE} tenantSlug={tenant.slug} />
    </>
  )
}
