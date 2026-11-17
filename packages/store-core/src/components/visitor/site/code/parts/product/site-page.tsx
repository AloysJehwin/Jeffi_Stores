import type { ReactNode } from 'react'
import { SitePage } from '@/components/visitor/site/SitePage'
import { loadSitePage, type SitePageRef } from '@/lib/site/page'
import { codeComponents, hasBlock } from '../cart/page-parts'

/**
 * A page's Site Builder version (`site`, null for the built-in page) and whether it holds AI code sections (`code`).
 * An AI page that places every `required` part does without the built-in core; otherwise the core renders at its block
 * (or last), as renderSitePage does.
 */
export async function renderPartsPage(
  ref: SitePageRef,
  params: { preview?: string; layout?: string },
  coreType: string,
  core: ReactNode,
  required: string[]
): Promise<{ site: ReactNode | null; code: boolean }> {
  const page = await loadSitePage(ref, params)
  if (!page) return { site: null, code: false }
  const parts = codeComponents(page.doc)
  const builtIn = !parts || hasBlock(page.doc, coreType) || required.some(n => !parts.has(n))
  return {
    site: <SitePage doc={page.doc} surface={page.surface} audience={ref.audience} selectable={page.selectable} core={builtIn ? { [coreType]: core } : {}} page={ref.page} />,
    code: !!parts,
  }
}
