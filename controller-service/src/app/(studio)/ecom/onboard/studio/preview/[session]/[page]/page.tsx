import { cookies, headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { cssVarsRule, googleFontsHref, isPageKey, normalizeTheme, topBlocks, themeCssVars, type PageDoc } from '@jeffi/site-blocks'
import { OWNER_COOKIE, resolveOwnerSession } from '@/lib/auth/owner-session'
import { dbSiteData, runWithSiteData, sampleSiteData, type SampleCatalog, type SiteData } from '@/lib/site/data'
import { CARD_KEY, cardOf } from '@/lib/site/card'
import type { CompiledSection } from '@/lib/site/code/compile'
import CodeSection from '@/components/visitor/site/code/CodeSection'
import type { StudioPlan } from '@/lib/site/studio/types'
import { getStudioSessionById } from '@controller/lib/site-studio/sessions'
import { themePreviewSession } from '@controller/lib/site-studio/themes'
import ThemedSample from '@controller/app/(studio)/_preview/ThemedSample'
import PreviewBridge from '@controller/app/(studio)/_preview/PreviewBridge'
import ShowcasePreview from '@controller/app/(studio)/_preview/ShowcasePreview'
import { siteEditorEnabled } from '@/lib/site/store'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Site preview', robots: { index: false, follow: false } }

// The AI Site Studio's preview of one page (/onboard/studio/preview/<session>/<page>?surface=web|web_mobile on the
// ecom host): the session's code sections rendered by CodeSection over the sample catalogue, in the session's theme,
// with the AI's announcement bar, header and footer around it. Non-engaging pages show a themed sample. The wizard
// frames it (the `preview` query lets the shared middleware allow same-site framing) and sizes it per device; the
// code is responsive, so `surface` only labels the request.

const CHROME = ['announcement', 'header'] as const
const EMPTY: SampleCatalog = { store: { name: 'Your store' }, categories: [], brands: [], products: [], reviews: [] }
// Pages that wear the listing's design when the session has none of their own, as the installed store does.
const SHARED: Record<string, string> = { 'store:category': 'store:products', 'store:brand': 'store:products', 'store:search': 'store:products' }

/** `home` → store:home; `business:catalog` stays. */
function studioKey(seg: string): string {
  let raw = seg
  try {
    raw = decodeURIComponent(seg)
  } catch {}
  return raw.includes(':') ? raw : `store:${raw}`
}

function Sections({ doc, pageKey, data, lead = false }: { doc: PageDoc; pageKey: string; data: SiteData; lead?: boolean }) {
  const page = pageKey.split(':')[1]
  return (
    <>
      {topBlocks(doc).map((b, i) => {
        const compiled = b.props.compiled as CompiledSection | undefined
        if (b.type !== 'code_section' || !compiled || b.visibility?.hidden) return null
        return (
          <div key={b.id} data-studio-block={b.id} data-studio-page={pageKey} data-studio-label={String(b.props.label ?? 'Section')} className="studio-block">
            <CodeSection section={compiled} id={b.id} page={isPageKey(page) ? page : null} data={data} priority={lead && i === 0} always={lead && i === 0} />
          </div>
        )
      })}
    </>
  )
}

export default async function StudioPreviewPage({ params, searchParams }: { params: Promise<{ session: string; page: string }>; searchParams: Promise<{ surface?: string; catalog?: string; theme?: string; editor?: string }> }) {
  const { session: id, page } = await params
  const { catalog: as, theme: themeId, editor } = await searchParams
  const h = await headers()
  const owner = await resolveOwnerSession((await cookies()).get(OWNER_COOKIE)?.value, {
    userAgent: h.get('user-agent'),
    acceptLanguage: h.get('accept-language'),
    uaPlatform: h.get('sec-ch-ua-platform'),
  } as any).catch(() => null)
  const own = owner ? await getStudioSessionById(id) : null
  if (!own || own.owner_id !== owner!.id) notFound()
  // A ready-made theme before it is applied (`theme=minimalist.ocean`): its pages and palette over the owner's details.
  const s = themeId ? ((await themePreviewSession(own, themeId, studioKey(page))) ?? notFound()) : own
  // A Showcase's one page, over the owner's own details and content.
  // `editor=1`: the visual editor's canvas (node ids and its bridge), only while the editor is switched on.
  if (s.product === 'showcase') return <ShowcasePreview session={s} editing={editor === '1' && !themeId && (await siteEditorEnabled().catch(() => false))} />

  const key = studioKey(page)
  const [audience, pageName] = key.split(':') as ['store' | 'business', string]
  const plan = s.plan as StudioPlan | null
  const planned = plan?.pages.find(p => p.key === key)
  const themed = plan?.themed.find(t => `${t.audience}:${t.key}` === key)
  const theme = normalizeTheme(s.theme ?? (s.direction as { theme?: object } | null)?.theme ?? null)
  const catalog = (s.catalog as SampleCatalog | null) ?? { ...EMPTY, store: { name: (s.brief as { storeName?: string } | null)?.storeName ?? 'Your store' } }
  // `catalog=empty` shows the site as a new store goes live (no products yet); `catalog=live` over the store's own.
  const source = as === 'live' ? dbSiteData() : as === 'empty' ? { ...sampleSiteData({ ...EMPTY, store: catalog.store }), sample: false } : sampleSiteData(catalog)
  // Every product list draws the session's own product card (none yet: the store's card).
  const data: SiteData = { ...source, card: cardOf(s.pages?.[CARD_KEY]) }
  const css = `${cssVarsRule('.studio-preview.studio-preview', themeCssVars(theme))}
.studio-preview{font-family:var(--font-body),system-ui,sans-serif;background:var(--color-surface);color:var(--color-foreground);min-height:100vh}
.studio-picking .studio-block{cursor:pointer}
.studio-picking .studio-block:hover{outline:2px dashed #c46a46;outline-offset:-2px}
[data-studio-selected]{outline:3px solid #c46a46;outline-offset:-3px}`

  // Chrome pages preview on the home page, so the header and footer are seen in place.
  const chromeKey = pageName === 'header' || pageName === 'footer' || pageName === 'announcement' ? 'store:home' : key
  // A page an older plan has no design for wears the one the live store gives it (the listing's).
  const sharedKey = !s.pages?.[chromeKey] && !planned ? SHARED[chromeKey] : undefined
  const mainKey = sharedKey && s.pages?.[sharedKey] ? sharedKey : chromeKey
  const mainDoc = s.pages?.[mainKey]
  const chrome = (name: string) => s.pages?.[`store:${name}`]
  const pageKeys = [...(plan?.pages.filter(p => p.enabled).map(p => p.key) ?? []), ...(plan?.themed.map(t => `${t.audience}:${t.key}`) ?? [])]

  const body = await runWithSiteData(data, async () => (
    <>
      {CHROME.map(name => {
        const doc = chrome(name)
        return doc ? <Sections key={name} doc={doc} pageKey={`store:${name}`} data={data} /> : null
      })}
      <main>
        {mainDoc ? (
          <Sections doc={mainDoc} pageKey={mainKey} data={data} lead />
        ) : themed ? (
          <ThemedSample kind={themed.key} label={themed.label} audience={audience} catalog={s.catalog as SampleCatalog | null} />
        ) : (
          <div className="flex min-h-[60vh] items-center justify-center px-6 text-center text-sm text-foreground-muted">
            {planned ? `${planned.label} appears here once it is designed.` : 'This page is not part of your site.'}
          </div>
        )}
      </main>
      {chrome('footer') ? <Sections doc={chrome('footer')!} pageKey="store:footer" data={data} /> : null}
    </>
  ))

  return (
    <>
      <link rel="stylesheet" href={googleFontsHref(theme)} />
      <style dangerouslySetInnerHTML={{ __html: css }} />
      <div className="studio-preview">{body}</div>
      <PreviewBridge audience={audience} pages={pageKeys} />
    </>
  )
}
