import { redirect } from 'next/navigation'
import { loadOwnerContext } from '@controller/lib/ecom/owner-context'
import { showcaseUrl } from '@/lib/showcase/host'
import { ownerShowcase, siteForClient } from '@controller/lib/showcase-builder/site'
import ShowcaseEditor from './ShowcaseEditor'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Edit your Showcase' }

// The Showcase editor: the studio (preview, sections to arrange, words and pictures to change, AI changes), the
// business details and the page's content. Details and content save to the site at once; the design goes live when
// published.
export default async function ShowcaseEditPage() {
  const { owner } = await loadOwnerContext()
  const site = await ownerShowcase(owner.id)
  if (!site) redirect('/onboard/showcase')
  return <ShowcaseEditor owner={{ email: owner.email }} initialSite={siteForClient(site)!} siteUrl={showcaseUrl(site.slug)} />
}
