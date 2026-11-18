import { blockVisible, normalizeDoc, pageRefKey, topBlocks, type PageDoc, type PageRef, type SiteAudience, type SiteSurface } from '@jeffi/site-blocks'
import { getPublishedPage, getSiteDraft, siteBuilderEnabled } from './store'
import type { ChromeLink, SiteChrome } from './chrome-types'

// The published header links, footer columns and announcements for a layout, or null while Site Builder is off (the
// storefront then keeps its built-in header and footer). With a draft (Site Builder's canvas), its versions win.
export async function getSiteChrome(audience: SiteAudience, surface: SiteSurface, draftId?: string | null): Promise<SiteChrome | null> {
  const draft = draftId ? await getSiteDraft(draftId).catch(() => null) : null
  if (!draft && !(await siteBuilderEnabled())) return null
  const page = async (ref: PageRef): Promise<{ doc: PageDoc } | null> => {
    const own = draft?.docs.pages?.[pageRefKey(ref)]
    return own ? { doc: normalizeDoc(own) } : getPublishedPage(ref)
  }
  const at = (p: 'header' | 'footer' | 'announcement') =>
    page({ audience, surface, page: p, slug: '' }).then(async x => x ?? (audience === 'business' ? page({ audience: 'store', surface, page: p, slug: '' }) : null))
  const [header, footer, announcement] = await Promise.all([at('header'), at('footer'), at('announcement')])
  const now = Date.now()
  const shown = (p: typeof header) => (p ? topBlocks(p.doc).filter(b => blockVisible(b, now)) : [])
  const links = (v: unknown) => (Array.isArray(v) ? (v as ChromeLink[]).filter(l => l?.label && l?.href) : [])

  const nav = shown(header).find(b => b.type === 'nav_links')
  const columns = shown(footer).filter(b => b.type === 'footer_column')
  const note = shown(footer).find(b => b.type === 'footer_note')
  return {
    nav: nav ? links(nav.props.links) : null,
    footer: footer
      ? { columns: columns.map(c => ({ title: String(c.props.title ?? ''), links: links(c.props.links) })), note: note ? String(note.props.text ?? '') || null : null }
      : null,
    announcements: shown(announcement)
      .filter(b => b.type === 'announcement' && b.props.text)
      .map(b => ({ text: String(b.props.text), href: (b.props.href as string | null) ?? null, tone: (b.props.tone as 'brand' | 'dark' | 'accent') ?? 'dark' })),
  }
}
