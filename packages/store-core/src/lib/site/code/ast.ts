// The JSON form a code section is stored and rendered in. compileSection builds it from the AI's TSX; the interpreter
// (components/visitor/site/code/CodeSection.tsx) walks it. Nothing in it is ever executed as code. The types live in
// @jeffi/site-blocks so the editor's operations (design.ts) share them.

import type { CodeNode } from '@jeffi/site-blocks'

export type { CodeNode, CodeValue } from '@jeffi/site-blocks'

/** The page a site card is written for: its section takes the product (`Card({ p })`) instead of no props. */
export const CARD_PAGE = 'card' as const
/** The root of a site card's bound paths: the product it is drawn for. */
export const CARD_PRODUCT = '$card'

/** Lists that can lay their own items out as a carousel (layout="carousel", itemClassName = slide widths). */
export const SLIDE_LISTS = new Set(['Products', 'Categories', 'RelatedProducts', 'CartUpsell'])

/**
 * The one list a <Carousel> holds, when that is all it holds and the list can be its own carousel: written so, the
 * whole list would be one slide, so it is drawn as the list's carousel instead (each item a slide).
 */
export function carouselList(node: CodeNode): Extract<CodeNode, { t: 'cmp' }> | null {
  if (node.t !== 'cmp' || node.name !== 'Carousel') return null
  const kids = (node.children ?? []).filter(c => !(c.t === 'text' && !c.value.trim()))
  const only = kids.length === 1 ? kids[0] : null
  if (!only || only.t !== 'cmp' || !SLIDE_LISTS.has(only.name)) return null
  const layout = only.props?.layout
  return layout && !(layout.k === 'lit' && (layout.v === 'grid' || layout.v === 'carousel')) ? null : only
}
