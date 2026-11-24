import { notFound } from 'next/navigation'
import { loadOwnerContext } from '@controller/lib/ecom/owner-context'
import { getOwnedShowcase } from '@/lib/showcase/store'
import { showcaseHost } from '@/lib/showcase/host'
import DomainClient from './DomainClient'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Site domain' }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** One Showcase's own domain: buy one or connect one the owner has; only its owner sees it. */
export default async function ShowcaseDomainPage({ params, searchParams }: { params: Promise<{ siteId: string }>; searchParams: Promise<{ tenant?: string }> }) {
  const [{ siteId }, { tenant: tenantSlug }] = await Promise.all([params, searchParams])
  const { owner, tenants, tenant } = await loadOwnerContext({ tenantSlug })
  const site = UUID_RE.test(siteId) ? await getOwnedShowcase(siteId, owner.id) : null
  if (!site) notFound()
  // The domain is paid from the workspace the site bills to, which its first publish creates.
  const workspace = site.tenantId ? tenants.find(t => t.id === site.tenantId) ?? null : null
  return (
    <DomainClient
      siteId={site.id}
      slug={site.slug}
      name={site.business.name?.trim() || 'Your site'}
      host={showcaseHost(site.slug)}
      customDomain={site.customDomain}
      status={site.status}
      workspace={workspace ? { id: workspace.id, slug: workspace.slug } : null}
      tenantSlug={tenant.slug}
    />
  )
}
