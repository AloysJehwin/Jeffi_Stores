import * as React from 'react'
import { blockVisible, normalizeDoc, pageRefKey, topBlocks, type PageDoc, type PageRef, type SiteSurface } from '@jeffi/site-blocks'
import { CARD_PAGE } from './code/ast'
import { siteData, type SiteCardSection, type SiteData } from './data'
import { portalHere } from './portal'

// The site card: one product card per site, written by the AI for its style (the `card` page's one code section).
// Every product list draws its products with it when the store has one, and with the store's ProductCard otherwise. A
// preview pins its own on its SiteData (`card`); the live store reads its published card page (a Site Builder preview,
// its draft's). The business portal keeps ProductCard, which shows a trade buyer their own prices.

/** The studio session key the card is saved under, and installed from. */
export const CARD_KEY = `store:${CARD_PAGE}`

const ID = /^[A-Za-z0-9_-]{1,64}$/

/** The card in a page doc: its first shown code section, compiled (null when it has none). */
export function cardOf(doc: unknown): SiteCardSection | null {
  if (!doc || typeof doc !== 'object') return null
  const block = topBlocks(normalizeDoc(doc as Partial<PageDoc>)).find(b => b.type === 'code_section' && blockVisible(b, Date.now()))
  const c = block?.props.compiled as Partial<SiteCardSection> | null | undefined
  if (!c || typeof c !== 'object' || !c.ast || typeof c.ast !== 'object' || typeof c.id !== 'string' || !ID.test(c.id)) return null
  return { id: c.id, ast: c.ast, css: typeof c.css === 'string' ? c.css : '' }
}

async function loadLive(): Promise<SiteCardSection | null> {
  try {
    const [{ getPublishedPage, getSiteDraft, siteBuilderEnabled }, { verifyHomepagePreviewToken }, { getWebSurface }, { headers }] = await Promise.all([
      import('./store'),
      import('@/lib/catalog/homepage-preview-token'),
      import('@/lib/catalog/web-surface'),
      import('next/headers'),
    ])
    const surface: SiteSurface = (await getWebSurface()) === 'web_mobile' ? 'web_mobile' : 'web'
    const ref = (s: SiteSurface): PageRef => ({ audience: 'store', surface: s, page: CARD_PAGE, slug: '' })
    // Phones use the desktop card until there is a phone one, as pages do.
    const surfaces: SiteSurface[] = surface === 'web_mobile' ? ['web_mobile', 'web'] : ['web']
    const preview = await verifyHomepagePreviewToken((await headers()).get('x-site-preview'))
    if (preview?.kind === 'site') {
      const pages = (await getSiteDraft(preview.draftId))?.docs.pages ?? {}
      const own = surfaces.map(s => pages[pageRefKey(ref(s))]).find(Boolean)
      if (own) return cardOf(own)
    } else if (!(await siteBuilderEnabled())) return null
    for (const s of surfaces) {
      const page = await getPublishedPage(ref(s))
      if (page) return cardOf(page.doc)
    }
    return null
  } catch {
    // Outside a request (a build, a script) there is no store to read: the built-in card.
    return null
  }
}

const reactCache = (React as unknown as { cache?: <F extends (...a: never[]) => unknown>(fn: F) => F }).cache
/** Read once per request. */
const liveCard: () => Promise<SiteCardSection | null> = typeof reactCache === 'function' ? reactCache(loadLive) : loadLive

/** The card product lists draw with here, or null for the store's ProductCard. */
export async function siteCard(data?: SiteData): Promise<SiteCardSection | null> {
  if (portalHere() === 'business') return null
  const src = data ?? siteData()
  if (src.card !== undefined) return src.card
  // A made-up catalogue with no card of its own (a session from before cards): the store's card.
  if (src.sample) return null
  return liveCard()
}
