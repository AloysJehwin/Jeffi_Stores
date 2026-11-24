import type { ReactNode } from 'react'
import { blockVisible, topBlocks, type PageDoc, type PageKey, type SiteAudience, type SiteSurface } from '@jeffi/site-blocks'
import SectionRenderer from '@/components/visitor/home/SectionRenderer'
import SitePreviewBridge from '@/components/visitor/home/SitePreviewBridge'
import SiteEditorGate from './editor/SiteEditorGate'
import { loadSectionData } from '@/lib/catalog/homepage-model'
import { coreBlockFor, isSectionBlock } from '@/lib/site/blocks'
import { cleanTree, type ComposedNode } from '@/lib/site/composed'
import { docToRows } from '@/lib/site/legacy'
import { loadSitePage, type SitePageRef } from '@/lib/site/page'
import { ContentBlock } from './ContentBlocks'

/**
 * A page's working part: a node, or a function of its block's settings (a side picture beside a form, say). The
 * settings carry `lcp: true` when the block is the page's first with a picture, so the part loads it eagerly.
 */
export type CorePart = ReactNode | ((props: Record<string, unknown>) => ReactNode)
const corePart = (part: CorePart, props: Record<string, unknown>) => (typeof part === 'function' ? part(props) : part)

// Homepage sections that draw no picture; any other section does, and sets its own priority.
const TEXT_SECTIONS = new Set(['trust_strip', 'benefits', 'why_us', 'value_stats', 'business_cta', 'countdown_deal', 'social_strip', 'rewards_game', 'business_reorder', 'business_quotes', 'business_offers', 'business_account'])
const COMPOSED_IMAGE_KINDS = new Set(['image', 'products', 'categories', 'brands', 'offers'])
const hasImageNode = (n: ComposedNode): boolean => COMPOSED_IMAGE_KINDS.has(n.kind) || !!n.children?.some(hasImageNode)
const set = (v: unknown) => typeof v === 'string' && v.trim() !== ''

/** Whether a block draws a picture; the first one on the page gets the LCP treatment (eager, high priority). */
// Code-section parts that draw pictures; the section's first picture claims the LCP priority.
const PICTURE_PARTS = new Set([
  'Image', 'Products', 'ProductCard', 'Categories', 'Brands', 'Offers', 'ProductGallery', 'RelatedProducts', 'ProductResults', 'CartUpsell', 'CartLines',
  'Category', 'SubCategories', 'Brand', 'AllCategories', 'AllBrands',
])

function bearsImage(type: string, props: Record<string, unknown>, isCore: boolean): boolean {
  if (isCore) return type === 'login_main' || type === 'signup_main' ? set(props.sideImage) : true
  if (isSectionBlock(type)) return !TEXT_SECTIONS.has(type)
  if (type === 'image_banner' || type === 'image_text') return set(props.image)
  if (type === 'composed') {
    const { tree } = cleanTree(props.tree)
    return !!tree && hasImageNode(tree)
  }
  if (type === 'code_section') {
    const c = props.compiled as { components?: string[]; ast?: unknown } | null
    return !!c && ((c.components ?? []).some(n => PICTURE_PARTS.has(n)) || JSON.stringify(c.ast ?? null).includes('"tag":"img"'))
  }
  return false
}

/**
 * A Site Builder page: its blocks in order, homepage sections through the section renderer with their data. `core` is
 * the page's working part (product details, the cart) by block type; it renders where its block sits, or last if the
 * page lost it, so the page always works.
 */
export async function SitePage({
  doc,
  surface,
  audience,
  selectable,
  core = {},
  page = null,
}: {
  doc: PageDoc
  surface: SiteSurface
  audience: SiteAudience
  selectable: boolean
  core?: Record<string, CorePart>
  /** Which page this is: its code sections draw only the parts allowed there. */
  page?: PageKey | null
}) {
  const now = Date.now()
  const all = topBlocks(doc)
  const blocks = all.filter(b => blockVisible(b, now) || b.type in core)
  const orphans = Object.keys(core).filter(t => !all.some(b => b.type === t))
  const sections = blocks.filter(b => isSectionBlock(b.type))
  const rows = docToRows({ ...doc, order: sections.map(b => b.id) }, { audience, surface, page: 'home' })
  const data = rows.sections.length ? await loadSectionData(rows.sections, { surface, page: 'home', audience, draft: rows }) : null
  const byId = new Map(rows.sections.map(s => [s.id, s]))
  let productRows = 0
  const lcpIndex = blocks.findIndex(b => bearsImage(b.type, b.props, b.type in core))
  return (
    <div className="bg-surface">
      {selectable && <SitePreviewBridge />}
      {selectable && <SiteEditorGate />}
      {blocks.length === 0 && orphans.length === 0 && selectable && (
        <div className="container mx-auto px-4 py-24 text-center text-foreground-muted">This page has no blocks yet. Add one in Site Builder.</div>
      )}
      {blocks.map((b, i) => {
        const row = byId.get(b.id)
        const priority = i === lcpIndex
        const node =
          b.type in core ? (
            corePart(core[b.type], priority ? { ...b.props, lcp: true } : b.props)
          ) : row && data ? (
            <SectionRenderer section={row} data={data} rowIndex={row.type === 'product_row' ? productRows++ : productRows} preview={selectable} />
          ) : (
            <ContentBlock block={b} priority={priority} always={selectable || i === 0} page={page} preview={selectable} />
          )
        return selectable ? (
          <div key={b.id} data-block-id={b.id}>
            {node}
          </div>
        ) : (
          <div key={b.id}>{node}</div>
        )
      })}
      {orphans.map(t => (
        <div key={t}>{corePart(core[t], {})}</div>
      ))}
    </div>
  )
}

/** The page's Site Builder version (or its preview), or null to render the built-in page. `core`: see SitePage. */
export async function renderSitePage(ref: SitePageRef, params: { preview?: string; layout?: string } = {}, core: Record<string, CorePart> = {}) {
  const page = await loadSitePage(ref, params)
  if (!page) return null
  const need = coreBlockFor(ref.page)
  if (need && !(need.type in core)) return null
  return <SitePage doc={page.doc} surface={page.surface} audience={ref.audience} selectable={page.selectable} core={core} page={ref.page} />
}
