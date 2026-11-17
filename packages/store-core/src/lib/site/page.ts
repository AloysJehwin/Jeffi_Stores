import { emptyDoc, normalizeDoc, pageRefKey, type PageDoc, type PageKey, type SiteAudience, type SiteSurface } from '@jeffi/site-blocks'
import { verifyHomepagePreviewToken } from '@/lib/catalog/homepage-preview-token'
import { getWebSurface } from '@/lib/catalog/web-surface'
import { getPublishedPage, getSiteDraft, siteBuilderEnabled } from './store'

export interface SitePageRef {
  audience: SiteAudience
  page: PageKey
  slug?: string
}

/**
 * The document a content page renders: with a Site Builder preview token, the draft's version (blocks selectable);
 * otherwise the published one while Site Builder is live. Phone browsers use the desktop layout until the page has
 * a phone layout of its own. Null: render the store's built-in page.
 */
export async function loadSitePage(
  ref: SitePageRef,
  params: { preview?: string; layout?: string } = {}
): Promise<{ doc: PageDoc; surface: SiteSurface; selectable: boolean; title: string | null } | null> {
  const preview = await verifyHomepagePreviewToken(params.preview)
  const at = (surface: SiteSurface) => ({ ...ref, surface, slug: ref.slug ?? '' })
  if (preview?.kind === 'site') {
    const raw = await getWebSurface(params.layout, true)
    const surface: SiteSurface = raw === 'web' ? 'web' : 'web_mobile'
    const draft = await getSiteDraft(preview.draftId)
    const own = (s: SiteSurface) => draft?.docs.pages?.[pageRefKey(at(s))]
    const doc =
      own(surface) ??
      (await getPublishedPage(at(surface)))?.doc ??
      (surface === 'web_mobile' ? (own('web') ?? (await getPublishedPage(at('web')))?.doc) : undefined)
    return { doc: normalizeDoc(doc ?? emptyDoc()), surface, selectable: true, title: null }
  }
  if (!(await siteBuilderEnabled())) return null
  const surface: SiteSurface = (await getWebSurface()) === 'web' ? 'web' : 'web_mobile'
  const page = (await getPublishedPage(at(surface))) ?? (surface === 'web_mobile' ? await getPublishedPage(at('web')) : null)
  return page ? { doc: page.doc, surface, selectable: false, title: page.title } : null
}
