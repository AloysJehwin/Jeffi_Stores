import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { OWNER_COOKIE, resolveOwnerSession } from '@/lib/auth/owner-session'
import { showcaseUrl } from '@/lib/showcase/host'
import { ownerShowcase, siteForClient } from '@controller/lib/showcase-builder/site'
import ShowcaseOnboard from './ShowcaseOnboard'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Your Showcase' }

// /onboard/showcase: the Showcase signup (Details, then the site). A published site with a workspace is edited from
// the dashboard instead; without one this page stays its editor.
export default async function ShowcaseOnboardPage() {
  const h = await headers()
  const owner = await resolveOwnerSession((await cookies()).get(OWNER_COOKIE)?.value, {
    userAgent: h.get('user-agent'),
    acceptLanguage: h.get('accept-language'),
    uaPlatform: h.get('sec-ch-ua-platform'),
  } as any).catch(() => null)
  if (!owner) redirect('/signup')
  const site = await ownerShowcase(owner.id)
  if (site && site.status !== 'draft' && site.tenantId) redirect('/dashboard/showcase/edit')
  return <ShowcaseOnboard owner={{ email: owner.email, name: owner.name }} initialSite={siteForClient(site)} siteUrl={site ? showcaseUrl(site.slug) : null} />
}
