import { redirect } from 'next/navigation'
import { loadOwnerContext } from '@controller/lib/ecom/owner-context'
import { consoleShowcases } from '@controller/lib/showcase/state'

export const dynamic = 'force-dynamic'

/** The old single-site address: the newest site's enquiries, else the sites list. */
export default async function OldShowcaseLeadsPage({ searchParams }: { searchParams: Promise<{ tenant?: string }> }) {
  const { tenant: tenantSlug } = await searchParams
  const { owner } = await loadOwnerContext({ tenantSlug })
  const [newest] = await consoleShowcases(owner.id)
  const t = tenantSlug ? `?tenant=${encodeURIComponent(tenantSlug)}` : ''
  redirect(newest ? `/dashboard/showcase/${newest.id}/leads${t}` : `/dashboard/showcase${t}`)
}
