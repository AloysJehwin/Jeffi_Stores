import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { OWNER_COOKIE, resolveOwnerSession } from '@/lib/auth/owner-session'
import { showcaseUrl } from '@/lib/showcase/host'
import { listShowcasesByOwner } from '@/lib/showcase/store'
import { ownedShowcase, siteForClient } from '@controller/lib/showcase-builder/site'
import ShowcaseOnboard from './ShowcaseOnboard'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Your Showcase' }

// /onboard/showcase: the Showcase signup (Details, then the site). ?site= works on one of the owner's sites, ?new=1
// starts another; a bare link resumes the newest draft. A published site with a workspace is edited from the
// dashboard instead; without one this page stays its editor.
export default async function ShowcaseOnboardPage({ searchParams }: { searchParams: Promise<{ site?: string; new?: string }> }) {
  const h = await headers()
  const owner = await resolveOwnerSession((await cookies()).get(OWNER_COOKIE)?.value, {
    userAgent: h.get('user-agent'),
    acceptLanguage: h.get('accept-language'),
    uaPlatform: h.get('sec-ch-ua-platform'),
  } as any).catch(() => null)
  if (!owner) redirect('/signup')
  const q = await searchParams
  let site = null
  if (q.site) {
    site = await ownedShowcase(owner.id, q.site)
    if (!site) redirect('/dashboard/showcase')
    if (site.status !== 'draft' && site.tenantId) redirect(`/dashboard/showcase/${site.id}/edit`)
  } else if (q.new !== '1') {
    const draft = (await listShowcasesByOwner(owner.id)).find(s => s.status === 'draft')
    if (draft) redirect(`/onboard/showcase?site=${draft.id}`)
  }
  return <ShowcaseOnboard owner={{ email: owner.email, name: owner.name }} initialSite={siteForClient(site)} siteUrl={site ? showcaseUrl(site.slug) : null} />
}
