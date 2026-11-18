import type { ReactNode } from 'react'
import { normalizeDoc, pageRefKey, type PageDoc, type SiteAudience, type SiteSurface } from '@jeffi/site-blocks'
import { getPublishedPage, getSiteDraft, siteBuilderEnabled } from '@/lib/site/store'
import { codeComponents } from '../cart/page-parts'

// The AI-written header, footer and announcement bar, for the layout to render in place of the built-in ones. Only a
// published chrome page made of code sections counts; anything else keeps the built-in chrome (null here). In Site
// Builder's canvas (`preview`), the draft's version over the published one, its blocks selectable and each part in a
// `data-site-page` wrapper so the canvas knows which page a block belongs to.

export interface CodeChrome {
  header: ReactNode | null
  footer: ReactNode | null
  announcement: ReactNode | null
}

export async function loadCodeChrome(audience: SiteAudience, surface: SiteSurface, preview?: { draftId: string } | null): Promise<CodeChrome | null> {
  const draft = preview ? await getSiteDraft(preview.draftId).catch(() => null) : null
  if (!draft && !(await siteBuilderEnabled())) return null
  const at = async (page: 'header' | 'footer' | 'announcement') => {
    const ref = { audience, page, slug: '' }
    const own = (s: SiteSurface): PageDoc | undefined => draft?.docs.pages?.[pageRefKey({ ...ref, surface: s })]
    const doc =
      own(surface) ??
      (await getPublishedPage({ ...ref, surface }))?.doc ??
      (surface === 'web_mobile' ? (own('web') ?? (await getPublishedPage({ ...ref, surface: 'web' }))?.doc) : undefined)
    const d = doc ? normalizeDoc(doc) : null
    return d && codeComponents(d) ? d : null
  }
  const [header, footer, announcement] = await Promise.all([at('header'), at('footer'), at('announcement')])
  if (!header && !footer && !announcement) return null
  // Loaded only when a store has AI chrome, so the layout doesn't pull the page renderer in for everyone.
  const { SitePage } = await import('@/components/visitor/site/SitePage')
  const render = (doc: typeof header, page: 'header' | 'footer' | 'announcement') =>
    !doc ? null : draft ? (
      <div data-site-page={page} style={{ display: 'contents' }}>
        <SitePage doc={doc} surface={surface} audience={audience} selectable page={page} />
      </div>
    ) : (
      <SitePage doc={doc} surface={surface} audience={audience} selectable={false} page={page} />
    )
  return { header: render(header, 'header'), footer: render(footer, 'footer'), announcement: render(announcement, 'announcement') }
}
