import { verifyHomepagePreviewToken } from '@/lib/catalog/homepage-preview-token'
import { getEditableHomepage, type HomepageDraftState } from '@/lib/catalog/homepage-draft'
import { getWebSurface } from '@/lib/catalog/web-surface'
import type { HomepageSurface } from '@/lib/catalog/homepage-sections'
import { siteDraftState } from './store'

/**
 * What a home page renders for a `?preview=` token: a homepage draft's rows, or a Site Builder draft's documents (whose
 * blocks the editor's canvas can select). Without a valid token, the live page.
 */
export async function previewRows(token: string | undefined, layout: string | undefined): Promise<{
  surface: HomepageSurface
  draft: HomepageDraftState | null
  selectable: boolean
}> {
  const preview = await verifyHomepagePreviewToken(token)
  if (preview?.kind === 'site') {
    const surface = await getWebSurface(layout, true)
    return { surface, draft: await siteDraftState(preview.draftId, surface), selectable: true }
  }
  const editable = preview ? await getEditableHomepage(preview.draftId) : null
  const draft = editable?.draft ? editable : null
  return { surface: await getWebSurface(layout, !!draft), draft, selectable: false }
}
