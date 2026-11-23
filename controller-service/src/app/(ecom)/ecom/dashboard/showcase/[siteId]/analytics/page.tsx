import { notFound } from 'next/navigation'
import { loadOwnerContext } from '@controller/lib/ecom/owner-context'
import { getOwnedShowcase } from '@/lib/showcase/store'
import { showcaseHost } from '@/lib/showcase/host'
import AnalyticsClient from './AnalyticsClient'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Site analytics' }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** One Showcase's visitors and enquiries; only its owner sees it. */
export default async function ShowcaseAnalyticsPage({ params, searchParams }: { params: Promise<{ siteId: string }>; searchParams: Promise<{ tenant?: string }> }) {
  const [{ siteId }, { tenant: tenantSlug }] = await Promise.all([params, searchParams])
  const { owner, tenant } = await loadOwnerContext({ tenantSlug })
  const site = UUID_RE.test(siteId) ? await getOwnedShowcase(siteId, owner.id) : null
  if (!site) notFound()
  return <AnalyticsClient siteId={site.id} name={site.business.name?.trim() || 'Your site'} host={showcaseHost(site.slug)} status={site.status} tenantSlug={tenant.slug} />
}
