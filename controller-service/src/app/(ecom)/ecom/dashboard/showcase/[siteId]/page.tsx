import { notFound } from 'next/navigation'
import { loadOwnerContext } from '@controller/lib/ecom/owner-context'
import { showcaseConsoleState, storePlanOffers } from '@controller/lib/showcase/state'
import { getOwnedShowcase } from '@/lib/showcase/store'
import { needsKeepOnline } from '@controller/lib/showcase/hosting'
import ShowcaseClient from './ShowcaseClient'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Showcase' }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** One Showcase site's address, status and hosting; only its owner sees it. */
export default async function ShowcaseSitePage({ params, searchParams }: { params: Promise<{ siteId: string }>; searchParams: Promise<{ tenant?: string }> }) {
  const [{ siteId }, { tenant: tenantSlug }] = await Promise.all([params, searchParams])
  const { owner, tenant } = await loadOwnerContext({ tenantSlug })
  const site = UUID_RE.test(siteId) ? await getOwnedShowcase(siteId, owner.id) : null
  if (!site) notFound()
  const initial = await showcaseConsoleState(site)
  const plans = needsKeepOnline(initial) ? await storePlanOffers(owner.id) : null
  return <ShowcaseClient initial={initial} tenantSlug={tenant.slug} plans={plans} />
}
