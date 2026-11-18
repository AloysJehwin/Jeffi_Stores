import type { ReactNode } from 'react'
import { SitePage } from '@/components/visitor/site/SitePage'
import { loadSitePage, type SitePageRef } from '@/lib/site/page'
import { codeComponents, hasBlock } from '../cart/page-parts'

export interface PartsPage {
  /** The library parts the page's AI code sections place; null without any (a built-in or block page). */
  parts: Set<string> | null
  /** Whether the built-in core still renders (no AI design, its block kept, or a required part missing). */
  builtIn: boolean
  has: (part: string) => boolean
  /** The Site Builder page around `core`, or null for the built-in page. */
  site: (core: ReactNode) => ReactNode | null
}

/**
 * A catalogue page's Site Builder version, loaded before the route builds its built-in content: the route leaves out
 * the built-in pieces the AI design places (its header, banner, subcategories, FAQs, SEO copy) and keeps the rest
 * around it. The core rule is renderPartsPage's.
 */
export async function loadPartsPage(ref: SitePageRef, params: { preview?: string; layout?: string }, coreType: string, required: string[]): Promise<PartsPage> {
  const page = await loadSitePage(ref, params)
  const parts = page ? codeComponents(page.doc) : null
  const builtIn = !page || !parts || hasBlock(page.doc, coreType) || required.some(n => !parts.has(n))
  return {
    parts,
    builtIn,
    has: part => !!parts?.has(part),
    site: core =>
      page ? <SitePage doc={page.doc} surface={page.surface} audience={ref.audience} selectable={page.selectable} core={builtIn ? { [coreType]: core } : {}} page={ref.page} /> : null,
  }
}
