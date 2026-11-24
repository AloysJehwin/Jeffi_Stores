import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { cssVarsRule, googleFontsHref, normalizeDoc, normalizeTheme, themeCssVars } from '@jeffi/site-blocks'
import PhotoCredits from '@/components/visitor/site/PhotoCredits'
import { pageCredits, pictureCredits } from '@/lib/ai/stock-credits'
import { runWithSiteData } from '@/lib/site/data'
import { showcaseSiteData } from '@/lib/showcase/site-data'
import { requestHost } from '@showcase/lib/site'
import { previewFor, previewState, servedLive } from '@showcase/lib/preview'
import SiteSections from '../SiteSections'
import PreviewClient from './PreviewClient'

export const dynamic = 'force-dynamic'

// The no-login preview link (/preview?t=<token>) on the site's own host: the site's current page, a draft too,
// refreshed live (PreviewClient). Forms are inert and nothing is tracked. Once the link has run out, the live site
// when there is one, else a note. Never indexed, never cached, no referrer (the token is in the address).

type Props = { searchParams: Promise<{ t?: string | string[] }> }

const tokenOf = (t: string | string[] | undefined) => (typeof t === 'string' ? t : undefined)

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const p = await previewFor(tokenOf((await searchParams).t), await requestHost())
  const name = p.kind === 'ok' ? p.site.business.name?.trim() : ''
  return { title: name ? `${name} (preview)` : 'Preview', robots: { index: false, follow: false, nocache: true }, referrer: 'no-referrer' }
}

function Note({ title, body }: { title: string; body: string }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <h1 className="text-2xl font-bold text-foreground sm:text-3xl">{title}</h1>
      <p className="max-w-md text-foreground-secondary">{body}</p>
    </main>
  )
}

export default async function PreviewPage({ searchParams }: Props) {
  const token = tokenOf((await searchParams).t)
  const p = await previewFor(token, await requestHost())
  if (p.kind === 'invalid' || !token) notFound()
  if (p.kind === 'expired') {
    if (servedLive(p.site)) redirect('/')
    return <Note title="This preview link has expired" body="Ask for a new link, or check back once the site is published." />
  }

  const { site } = p
  const live = <PreviewClient token={token} state={previewState(site, p.expiresAt)} />
  if (!site.page)
    return (
      <>
        {live}
        <Note title="Your site is being built" body="Keep this page open: it shows your site as soon as the first version is ready." />
      </>
    )

  const theme = normalizeTheme(site.theme)
  const data = showcaseSiteData({ business: site.business, content: site.content, leadEndpoint: null })
  const css = `${cssVarsRule('.showcase-site.showcase-site', themeCssVars(theme))}.showcase-site{font-family:var(--font-body),system-ui,sans-serif;background:var(--color-surface);color:var(--color-foreground);min-height:100vh}`
  const doc = normalizeDoc(site.page)
  const body = await runWithSiteData(data, async () => <SiteSections doc={doc} data={data} />)

  return (
    <>
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      <link rel="stylesheet" href={googleFontsHref(theme)} />
      <style dangerouslySetInnerHTML={{ __html: css }} />
      {live}
      <div className="showcase-site">
        <main>{body}</main>
        <PhotoCredits credits={[...pictureCredits(site.content.pictures), ...pageCredits(site.page)]} className="px-4 py-4 text-center text-xs text-foreground-muted" />
      </div>
    </>
  )
}
