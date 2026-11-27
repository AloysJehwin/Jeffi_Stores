import type { CodeNode } from './ast'
import { safeHref } from './allow'

// Which elements the canvas edits as rich text (components/visitor/site/editor/rich-text.ts): a text block whose
// children are literal text plus inline formatting Tiptap can write back, nothing data-bound. Marked `data-e-rich` in
// the editor's preview (interpret.tsx); text-only elements keep `data-e-text`.

export const RICH_BLOCKS = new Set(['p', 'li', 'blockquote', 'figcaption', 'dd', 'td', 'span'])
/** What the rich editor writes: bold, italic, underline, strike, line break, link. (mark and small are not editable there.) */
export const RICH_INLINE = new Set(['strong', 'em', 'b', 'i', 'u', 's', 'br', 'a'])
/** Every mark type at once nests this deep, so what the editor writes stays editable. */
export const MAX_INLINE_DEPTH = 5

function inline(n: CodeNode, depth: number, inLink: boolean): boolean {
  if (n.t === 'text') return true
  if (n.t !== 'el' || !RICH_INLINE.has(n.tag) || depth > MAX_INLINE_DEPTH) return false
  const keys = Object.keys(n.props ?? {})
  if (n.tag === 'br') return !keys.length && !n.children.length
  if (n.tag === 'a') {
    const href = n.props.href
    if (inLink || keys.length !== 1 || !href || href.k !== 'lit' || safeHref(href.v) === null) return false
  } else if (keys.length) return false
  return n.children.every(c => inline(c, depth + 1, inLink || n.tag === 'a'))
}

/** A text block holding literal text and inline formatting, with at least one formatting element. */
export function isRichText(n: CodeNode): boolean {
  if (n.t !== 'el' || !(RICH_BLOCKS.has(n.tag) || /^h[1-6]$/.test(n.tag))) return false
  return n.children.some(c => c.t === 'el') && n.children.every(c => inline(c, 1, false))
}
