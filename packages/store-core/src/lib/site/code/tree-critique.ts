import { isTagNode, paletteFrom, type CodeNode, type ThemeTokens } from '@jeffi/site-blocks'
import type { DesignOp } from '@jeffi/site-blocks/design'
import { classOps, effectiveValue, readClasses, setOwn } from './classes'
import { freeAt, placeFree } from './free'
import { DESIGN_WIDTH, isSlide, pxText, pxToCqw, setCqwFont, textPx } from './slide'

// The critique on code sections' trees (docs/plans/SITE_EDITOR_PLAN.md phase 4), without a browser: words too pale
// for what is behind them, words too long for their slot, pictures with no description, headings out of order, and
// free layers that run off a phone's screen, and, in a slide, layers past the frame and words sized in px. Pure, so the editor runs it on the page it holds and the server's
// critique (lib/site/critique.ts) reads the same; fixes come back as design operations, or as an AI rewrite to ask for.

export type TreeFindingCode = 'contrast' | 'too_long' | 'no_alt' | 'heading_order' | 'off_screen' | 'slide_overflow' | 'slide_text'

export interface TreeFinding {
  code: TreeFindingCode
  severity: 'error' | 'warn'
  /** The section (block id) and the node in its tree. */
  block: string
  id: string
  message: string
  /** Operations that fix it, or the words to have the AI shorten. */
  fix?: { ops: DesignOp[] } | { shorten: { fieldId: string; text: string } }
}

const NEUTRAL: Record<string, string> = {
  white: '#ffffff',
  black: '#000000',
  surface: '#ffffff',
  'surface-elevated': '#ffffff',
  'surface-secondary': '#f4f4f5',
  foreground: '#111827',
  'foreground-secondary': '#374151',
  'foreground-muted': '#6b7280',
}

/** A colour class value (`primary-600`, `[#1a2b3c]`, `foreground`) as hex, or null when it can't be told. */
export function colourOf(value: string | undefined, theme: ThemeTokens): string | null {
  if (!value) return null
  const v = value.replace(/\/\d{1,3}$/, '')
  if (NEUTRAL[v]) return NEUTRAL[v]
  const hex = /^\[(#[0-9a-fA-F]{3}|#[0-9a-fA-F]{6})\]$/.exec(v)?.[1]
  if (hex) return hex.length === 4 ? `#${[...hex.slice(1)].map(c => c + c).join('')}` : hex.toLowerCase()
  const m = /^(primary|accent|secondary)-(50|100|200|300|400|500|600|700|800|900)$/.exec(v)
  if (!m) return null
  const base = m[1] === 'primary' ? theme.primary : m[1] === 'accent' ? theme.accent : theme.neutral
  return paletteFrom(base)[Number(m[2]) as 500]
}

const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
export const contrastOf = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m)
  return (x + 0.05) / (y + 0.05)
}

const LIMIT: Record<string, number> = { h1: 70, h2: 80, h3: 100, h4: 120, button: 30, a: 40, Link: 30, li: 160, p: 420 }
const LARGE = new Set(['h1', 'h2', 'h3'])
const litOf = (n: CodeNode, name: string): string | null => {
  if (!isTagNode(n)) return null
  const v = n.props[name]
  return v && v.k === 'lit' && typeof v.v === 'string' ? v.v : v ? null : ''
}
const kindOf = (n: CodeNode) => (n.t === 'el' ? n.tag : n.t === 'cmp' ? n.name : '')
const ownWords = (n: CodeNode) => (isTagNode(n) ? n.children.filter((c): c is Extract<CodeNode, { t: 'text' }> => c.t === 'text') : [])

/** Every node with its ancestors (nearest last), in document order. */
function walk(n: CodeNode, fn: (n: CodeNode, up: CodeNode[]) => void, up: CodeNode[] = []): void {
  fn(n, up)
  const next = [...up, n]
  const kids = n.t === 'el' || n.t === 'cmp' || n.t === 'frag' ? n.children : []
  const slots = n.t === 'cmp' && n.render ? [n.render.body] : n.t === 'cond' ? [n.then, ...(n.else ? [n.else] : [])] : n.t === 'each' ? [n.body] : []
  for (const c of [...kids, ...slots]) walk(c, fn, next)
}

/** A class value set on the node or the nearest ancestor that sets it, at Phone (base). */
const inherited = (chain: CodeNode[], prop: 'textColor' | 'bgColor') => {
  for (let i = chain.length - 1; i >= 0; i--) {
    const cls = litOf(chain[i], 'className')
    const v = cls ? effectiveValue(cls, 'base', prop)?.value : undefined
    if (v) return { value: v, at: chain[i] }
  }
  return null
}

/** Elements placed freely on phones (base classes) whose box runs past the section, with a fix that brings them in. */
export function offScreen(tree: CodeNode): { id: string; ops: DesignOp[] }[] {
  const out: { id: string; ops: DesignOp[] }[] = []
  walk(tree, n => {
    const cls = litOf(n, 'className')
    const r = cls ? freeAt(cls, 'base')?.rect : null
    if (!cls || !r || !(r.left < 0 || r.top < 0 || r.left + r.width > 100.5 || (r.height !== undefined && r.top + r.height > 100.5))) return
    const width = Math.min(100, r.width)
    const height = r.height === undefined ? undefined : Math.min(100, r.height)
    const rect = { left: Math.max(0, Math.min(r.left, 100 - width)), top: Math.max(0, Math.min(r.top, 100 - (height ?? 0))), width, ...(height !== undefined ? { height } : {}) }
    out.push({ id: n.id ?? '', ops: n.id ? classOps(n.id, cls, placeFree(cls, 'base', rect)) : [] })
  })
  return out
}

const past = (r: { left: number; top: number; width: number; height?: number }) => r.left < 0 || r.top < 0 || r.left + r.width > 100.5 || (r.height !== undefined && r.top + r.height > 100.5)

/** A slide's layers whose box runs past the frame at Tablet or Desktop, with a fix that brings them in. */
export function slideOverflow(tree: CodeNode): { id: string; ops: DesignOp[] }[] {
  const out: { id: string; ops: DesignOp[] }[] = []
  if (!isSlide(tree)) return out
  walk(tree, n => {
    const cls = n === tree ? null : litOf(n, 'className')
    if (!cls || !n.id) return
    let next = cls
    let bad = false
    for (const bp of ['md', 'lg'] as const) {
      const r = freeAt(next, bp)?.rect
      if (!r || !past(r)) continue
      bad = true
      const width = Math.min(100, r.width)
      const height = r.height === undefined ? undefined : Math.min(100, r.height)
      next = placeFree(next, bp, { left: Math.max(0, Math.min(r.left, 100 - width)), top: Math.max(0, Math.min(r.top, 100 - (height ?? 0))), width, ...(height !== undefined ? { height } : {}) })
    }
    if (bad) out.push({ id: n.id, ops: classOps(n.id, cls, next) })
  })
  return out
}

/** A slide's words sized in px (a Tailwind size or a px/rem value) where container units keep them in scale. */
export function slideText(tree: CodeNode): { id: string; text: string; ops: DesignOp[] }[] {
  return pxText(tree).map(({ node, holder, text, value }) => {
    const cls = litOf(holder, 'className') ?? ''
    const md = textPx(value)
    let ops: DesignOp[] = []
    if (md !== null && holder.id) {
      let next = setCqwFont(cls, 'md', pxToCqw(md, DESIGN_WIDTH.md))
      const lgOwn = readClasses(next).values.lg.fontSize
      if (lgOwn !== undefined) next = setCqwFont(next, 'lg', pxToCqw(textPx(lgOwn) ?? md * (DESIGN_WIDTH.lg / DESIGN_WIDTH.md), DESIGN_WIDTH.lg))
      ops = classOps(holder.id, cls, next)
    }
    return { id: holder.id ?? node.id ?? '', text, ops }
  })
}

/**
 * One page's code sections checked in reading order (headings run across sections). `sections`: block id, label and
 * tree, in page order.
 */
export function critiqueTrees(sections: { block: string; label: string; tree: CodeNode }[], theme: ThemeTokens): TreeFinding[] {
  const out: TreeFinding[] = []
  let lastHeading = 0
  let sawH1 = false
  for (const { block, label, tree } of sections) {
    let nearestHeading = ''
    walk(tree, (n, up) => {
      if (!isTagNode(n) || !n.id) return
      const kind = kindOf(n)
      const words = ownWords(n)
      const text = words.map(w => w.value).join('').replace(/\s+/g, ' ').trim()
      // Headings: one h1 for the page, and no level skipped on the way down.
      const level = /^h([1-6])$/.exec(kind)?.[1]
      if (level) {
        const lv = Number(level)
        if (text) nearestHeading = text
        const want = lv === 1 && sawH1 ? 2 : lastHeading && lv > lastHeading + 1 ? lastHeading + 1 : null
        if (want && n.t === 'el') {
          out.push({
            code: 'heading_order',
            severity: 'warn',
            block,
            id: n.id,
            message: lv === 1 ? `"${label}" has a second main heading (h1); a page reads best with one.` : `A heading in "${label}" jumps from level ${lastHeading} to ${lv}; screen readers expect level ${want}.`,
            fix: { ops: [{ op: 'node', id: n.id, node: { ...n, tag: `h${want}` } }] },
          })
          lastHeading = want
        } else lastHeading = lv
        if (lv === 1) sawH1 = true
      }
      // Words too long for the slot.
      const limit = LIMIT[kind]
      if (limit && text.length > limit)
        out.push({
          code: 'too_long',
          severity: 'warn',
          block,
          id: n.id,
          message: `"${text.slice(0, 40)}…" in "${label}" is ${text.length} characters; it may wrap badly on phones.`,
          fix: words.length === 1 ? { shorten: { fieldId: n.children.length === 1 ? n.id : words[0].id!, text } } : undefined,
        })
      // Pictures with no description.
      const isPicture = (n.t === 'cmp' && n.name === 'Image') || (n.t === 'el' && n.tag === 'img')
      if (isPicture && litOf(n, 'src') && litOf(n, 'alt') === '') {
        const alt = nearestHeading.slice(0, 120)
        out.push({
          code: 'no_alt',
          severity: 'warn',
          block,
          id: n.id,
          message: `A picture in "${label}" has no description for people who can't see it.`,
          fix: alt ? { ops: [{ op: 'attr', id: n.id, name: 'alt', value: alt }] } : undefined,
        })
      }
      // Words too pale for what is behind them, where the section sets a colour.
      if (text) {
        const chain = [...up, n]
        const fg = inherited(chain, 'textColor')
        const bg = inherited(chain, 'bgColor')
        if (fg || bg) {
          const f = fg ? colourOf(fg.value, theme) : NEUTRAL.foreground
          const b = bg ? colourOf(bg.value, theme) : NEUTRAL.surface
          const large = LARGE.has(kind)
          const need = large ? 3 : 4.5
          if (f && b && contrastOf(f, b) < need) {
            const better = contrastOf('#ffffff', b) >= contrastOf(NEUTRAL.foreground, b) ? 'white' : 'foreground'
            const cls = litOf(n, 'className')
            out.push({
              code: 'contrast',
              severity: 'warn',
              block,
              id: n.id,
              message: `Words in "${label}" are hard to read on their background (contrast ${contrastOf(f, b).toFixed(1)}:1; ${need}:1 reads well).`,
              // Every screen size reads the fixed colour (no pinning of the old one).
              fix: cls !== null ? { ops: classOps(n.id, cls, setOwn(cls, 'base', 'textColor', better)) } : undefined,
            })
          }
        }
      }
    })
    for (const o of offScreen(tree))
      out.push({ code: 'off_screen', severity: 'warn', block, id: o.id, message: `A freely placed element in "${label}" sits partly off the screen on phones.`, ...(o.ops.length ? { fix: { ops: o.ops } } : {}) })
    for (const o of slideOverflow(tree))
      out.push({ code: 'slide_overflow', severity: 'warn', block, id: o.id, message: `A layer in the slide "${label}" runs past the edge of the slide on tablets or desktops.`, ...(o.ops.length ? { fix: { ops: o.ops } } : {}) })
    for (const o of slideText(tree))
      out.push({ code: 'slide_text', severity: 'warn', block, id: o.id, message: `"${o.text.slice(0, 40)}" in the slide "${label}" is sized in px, so it will not scale with the slide; container units (cqw) keep it in proportion.`, ...(o.ops.length ? { fix: { ops: o.ops } } : {}) })
  }
  return out
}
