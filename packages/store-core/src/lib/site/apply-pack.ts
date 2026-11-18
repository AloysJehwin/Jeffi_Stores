import { cloneDoc, type SiteAudience } from '@jeffi/site-blocks'
import { getSiteDraft, saveDraftPage, saveDraftTheme } from './store'
import { sitePacks } from './packs'

/** Writes a site pack's pages (fresh block ids) and theme into a draft. Returns the pages written, or null if unknown. */
export async function applySitePack(draftId: string, packId: string, adminId: string | null): Promise<{ pages: number; audience: SiteAudience } | null> {
  const pack = sitePacks().find(p => p.id === packId)
  if (!pack) return null
  if (!(await getSiteDraft(draftId))) throw new Error('Draft not found')
  for (const p of pack.pages) {
    await saveDraftPage(draftId, { audience: p.audience, surface: p.surface, page: p.page, slug: '' }, cloneDoc(p.doc, () => crypto.randomUUID()), adminId)
  }
  const audience = pack.pages[0]?.audience ?? 'store'
  if (pack.theme) await saveDraftTheme(draftId, audience, pack.theme, adminId)
  return { pages: pack.pages.length, audience }
}
