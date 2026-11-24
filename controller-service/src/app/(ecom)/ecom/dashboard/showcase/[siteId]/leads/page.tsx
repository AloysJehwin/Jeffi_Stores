import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, BarChart3 } from 'lucide-react'
import { loadOwnerContext } from '@controller/lib/ecom/owner-context'
import { getOwnedShowcase, listShowcaseLeads } from '@/lib/showcase/store'
import { showcaseHost } from '@/lib/showcase/host'
import PageHeader from '../../../_components/PageHeader'
import LeadsClient from './LeadsClient'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Enquiries' }

const PAGE = 50
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const secondary =
  'inline-flex items-center gap-1.5 rounded-full border border-border-default px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-surface-secondary'

export default async function ShowcaseLeadsPage({ params, searchParams }: { params: Promise<{ siteId: string }>; searchParams: Promise<{ tenant?: string }> }) {
  const [{ siteId }, { tenant: tenantSlug }] = await Promise.all([params, searchParams])
  const { owner, tenant } = await loadOwnerContext({ tenantSlug })
  const site = UUID_RE.test(siteId) ? await getOwnedShowcase(siteId, owner.id) : null
  if (!site) notFound()
  const first = await listShowcaseLeads(site.id, { limit: PAGE })
  const t = `?tenant=${encodeURIComponent(tenant.slug)}`
  return (
    <>
      <PageHeader
        eyebrow="Showcase"
        title="Enquiries"
        description={`Messages from the contact form on ${showcaseHost(site.slug)}. Each one is also emailed to you; mark it handled once you have answered.`}
        actions={
          <>
            <Link href={`/dashboard/showcase/${site.id}${t}`} className={secondary}>
              <ArrowLeft className="h-4 w-4" /> Site
            </Link>
            <Link href={`/dashboard/showcase/${site.id}/analytics${t}&tab=leads`} className={secondary}>
              <BarChart3 className="h-4 w-4" /> Where they come from
            </Link>
          </>
        }
      />
      <LeadsClient initial={first} pageSize={PAGE} siteId={site.id} tenantSlug={tenant.slug} />
    </>
  )
}
