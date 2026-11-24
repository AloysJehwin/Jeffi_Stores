import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { cssVarsRule, googleFontsHref, normalizeDoc, normalizeTheme, themeCssVars } from '@jeffi/site-blocks'
import PhotoCredits from '@/components/visitor/site/PhotoCredits'
import { pageCredits, pictureCredits } from '@/lib/ai/stock-credits'
import { runWithSiteData } from '@/lib/site/data'
import { showcaseSiteData } from '@/lib/showcase/site-data'
import { currentSite, liveView, siteOrigin } from '@showcase/lib/site'
import { localBusinessJsonLd, siteMetadata } from '@showcase/lib/seo'
import Paused from './Paused'
import SiteSections from './SiteSections'
import Tracker from './Tracker'

export const dynamic = 'force-dynamic'

export async function generateMetadata(): Promise<Metadata> {
  const site = await currentSite().catch(() => null)
  if (!site || site.status === 'draft') return { title: 'Site not found', robots: { index: false, follow: false } }
  return siteMetadata(site, await siteOrigin())
}

// A no-script form post comes back here with ?lead=sent, or ?lead=error&why=… (api/leads answers it with a redirect).
// Only these fixed texts show: the query never puts its own words on the page.
const WHY: Record<string, string> = {
  name: 'Please enter your name.',
  phone: 'Please check the phone number.',
  email: 'Please check the email address.',
  message: 'Please shorten your message to 2000 characters.',
  contact: 'Please add a phone number or an email so we can reply.',
  limit: 'Too many messages were sent from here. Please try again later.',
}

function LeadNotice({ state, why }: { state?: string; why?: string }) {
  if (state !== 'sent' && state !== 'error') return null
  const reason = typeof why === 'string' && Object.hasOwn(WHY, why) ? WHY[why] : 'Please check the form and try again.'
  return (
    <div role="status" className={`px-4 py-3 text-center text-sm font-medium ${state === 'sent' ? 'bg-emerald-50 text-emerald-900' : 'bg-amber-50 text-amber-900'}`}>
      {state === 'sent' ? 'Thanks, your message was sent. We will get back to you soon.' : `Your message could not be sent. ${reason}`}
    </div>
  )
}

export default async function ShowcasePage({ searchParams }: { searchParams: Promise<{ lead?: string; why?: string }> }) {
  const site = await currentSite()
  if (!site || site.status === 'draft') notFound()
  if (site.status === 'paused' || site.workspaceSuspended) return <Paused site={site} />
  if (!site.page) notFound()

  const { lead, why } = await searchParams
  const origin = await siteOrigin()
  const theme = normalizeTheme(site.theme)
  const data = showcaseSiteData(liveView(site))
  const css = `${cssVarsRule('.showcase-site.showcase-site', themeCssVars(theme))}.showcase-site{font-family:var(--font-body),system-ui,sans-serif;background:var(--color-surface);color:var(--color-foreground);min-height:100vh}`
  const doc = normalizeDoc(site.page)
  const body = await runWithSiteData(data, async () => <SiteSections doc={doc} data={data} />)

  return (
    <>
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      <link rel="stylesheet" href={googleFontsHref(theme)} />
      <style dangerouslySetInnerHTML={{ __html: css }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: localBusinessJsonLd(site, origin) }} />
      <div className="showcase-site">
        <LeadNotice state={lead} why={why} />
        <main>{body}</main>
        <PhotoCredits credits={[...pictureCredits(site.content.pictures), ...pageCredits(site.page)]} className="px-4 py-4 text-center text-xs text-foreground-muted" />
      </div>
      <Tracker />
    </>
  )
}
