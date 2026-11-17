import type { ReactNode } from 'react'
import { SitePage, type CorePart } from '@/components/visitor/site/SitePage'
import { coreBlockFor } from '@/lib/site/blocks'
import { loadSitePage, type SitePageRef } from '@/lib/site/page'
import { codeComponents, hasBlock } from '../cart/page-parts'
import { setPageCore } from './slot'

/**
 * A working page (sign in, account, orders, wishlist, policies, help, not found) as the store's Site Builder page, or
 * null for the built-in page. An AI design places the page's core part (`part`), which draws `core`; a design that
 * lacks it (or keeps the page's core block) gets the built-in working part at that block, else last. An owner-built
 * page renders as renderSitePage does: its core block holds `block`. `aiOnly`: only an AI design frames this route
 * (the account pages it shares with the account home), so a block page leaves it built-in.
 */
export async function renderUtilityPage(
  ref: SitePageRef,
  params: { preview?: string; layout?: string },
  opts: { part: string; core: ReactNode; block?: Record<string, CorePart>; aiOnly?: boolean }
): Promise<ReactNode | null> {
  const page = await loadSitePage(ref, params)
  if (!page) return null
  const site = (core: Record<string, CorePart>) => (
    <SitePage doc={page.doc} surface={page.surface} audience={ref.audience} selectable={page.selectable} core={core} page={ref.page} />
  )
  const need = coreBlockFor(ref.page)
  const parts = codeComponents(page.doc)
  if (!parts) {
    if (opts.aiOnly || (need && !opts.block?.[need.type])) return null
    return site(opts.block ?? {})
  }
  const builtIn = (!!need && hasBlock(page.doc, need.type)) || !parts.has(opts.part)
  if (!builtIn) setPageCore(opts.part, opts.core)
  return site(builtIn ? (opts.block ?? { [need?.type ?? `${ref.page}_main`]: opts.core }) : {})
}

/** An account page (orders, addresses, rewards…) framed by the store's AI-designed account pages, else as it is. */
export async function renderAccountFrame(params: { preview?: string; layout?: string }, core: ReactNode): Promise<ReactNode> {
  return (await renderUtilityPage({ audience: 'store', page: 'account' }, params, { part: 'AccountPage', core, aiOnly: true })) ?? core
}
