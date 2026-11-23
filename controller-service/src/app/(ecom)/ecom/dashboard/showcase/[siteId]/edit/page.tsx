import { notFound, redirect } from 'next/navigation'
import { loadOwnerContext } from '@controller/lib/ecom/owner-context'
import { showcaseUrl } from '@/lib/showcase/host'
import { ownedShowcase, siteForClient } from '@controller/lib/showcase-builder/site'
import ShowcaseEditor from './ShowcaseEditor'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Edit your Showcase' }

// One Showcase's editor: the studio (preview, sections to arrange, words and pictures to change, AI changes), the
// business details and the page's content. Details and content save to the site at once; the design goes live when
// published. A draft is still in its signup.
export default async function ShowcaseEditPage({ params }: { params: Promise<{ siteId: string }> }) {
  const { siteId } = await params
  const { owner } = await loadOwnerContext()
  // ownedShowcase refuses anything but a uuid.
  const site = await ownedShowcase(owner.id, siteId)
  if (!site) notFound()
  if (site.status === 'draft') redirect(`/onboard/showcase?site=${site.id}`)
  return <ShowcaseEditor owner={{ email: owner.email }} initialSite={siteForClient(site)!} siteUrl={showcaseUrl(site.slug)} />
}
