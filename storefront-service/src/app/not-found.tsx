import { headers } from 'next/headers'
import { getHost } from '@/lib/tenancy/get-host'
import { appFromHost } from '@/lib/tenant-registry'
import NotFoundView from '@/components/visitor/site/code/parts/utility/NotFoundView'
import { renderUtilityPage } from '@/components/visitor/site/code/parts/utility/site-page'

// Any address that is not a page, and every notFound(). On the store: its AI-designed not-found page (the search box
// and popular links placed by <NotFoundContent />, under the design's own heading), a Site Builder one holding them in
// its `not_found_main` block, or the built-in page with the same help. Other hosts get a plain message. Not-found pages
// never see search params, so a Site Builder preview reads its token from the headers the middleware sets.
export default async function NotFound() {
  const host = await getHost()
  if (appFromHost(host) || /^(ecom|certificate)\./.test(host)) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-2 px-4 text-center">
        <h1 className="text-2xl font-semibold text-foreground">Page not found</h1>
        <p className="text-sm text-foreground-muted">This page could not be found.</p>
      </div>
    )
  }
  const h = await headers()
  const site = await renderUtilityPage(
    { audience: 'store', page: 'not_found' },
    { preview: h.get('x-site-preview') ?? undefined, layout: h.get('x-site-layout') ?? undefined },
    { part: 'NotFoundContent', core: <NotFoundView bare />, block: { not_found_main: <NotFoundView /> } }
  ).catch(() => null)
  return site ?? <NotFoundView />
}
