import { redirect } from 'next/navigation'
import { loadOwnerContext } from '@controller/lib/ecom/owner-context'
import { listShowcasesByOwner } from '@/lib/showcase/store'

export const dynamic = 'force-dynamic'

// The old single-site editor link: the newest published site's editor, else the newest draft's signup, else a new one.
export default async function ShowcaseEditRedirect() {
  const { owner } = await loadOwnerContext()
  const sites = await listShowcasesByOwner(owner.id)
  const published = sites.find(s => s.status !== 'draft')
  if (published) redirect(`/dashboard/showcase/${published.id}/edit`)
  redirect(sites[0] ? `/onboard/showcase?site=${sites[0].id}` : '/onboard/showcase?new=1')
}
