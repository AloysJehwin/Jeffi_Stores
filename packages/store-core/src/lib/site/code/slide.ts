import { isTagNode, type CodeNode, type TagNode } from '@jeffi/site-blocks'
import { breakpointTokens, classVariants, splitTokens, withBreakpoint, type Breakpoint } from '@jeffi/site-blocks/design'
import { effectiveValue, readClasses, setOwn, setPanelValue, type PanelProp } from './classes'

// Slides (docs/plans/site-builder-canvas-editor-research.md, architecture 3): a code section whose root is a slide
// frame. From Tablet up the frame has a design aspect and is a CSS container; every child is a free layer placed in %
// of it and its words are sized in container units (cqw), so the slide looks the same at any width. On phones there
// is no aspect: layers stack in the flow in tree order with their phone sizes. Pure, and no new node type: a slide is
// recognised from its root's classes (the allowlist takes no data-* attributes), and the live storefront renders it
// through the same interpreter as any section.
//
//   frame:  relative md:aspect-[16/9] md:p-0 md:overflow-hidden md:[container-type:inline-size]
//   layer:  md:absolute md:left-[8%] md:top-[20%] md:w-[50%] md:z-10 (and the same at lg), words md:text-[4.2cqw]

export const SLIDE_ASPECTS = [
  { id: '16:9', label: 'Wide 16:9', w: 16, h: 9 },
  { id: '4:3', label: 'Classic 4:3', w: 4, h: 3 },
  { id: '21:9', label: 'Banner 21:9', w: 21, h: 9 },
  { id: '1:1', label: 'Square 1:1', w: 1, h: 1 },
  { id: '3:4', label: 'Tall 3:4', w: 3, h: 4 },
] as const
export type SlideAspectId = (typeof SLIDE_ASPECTS)[number]['id']
export const DEFAULT_ASPECT: SlideAspectId = '16:9'

/** The widths a slide is designed at, per breakpoint: what a px size is measured against to become container units. */
export const DESIGN_WIDTH = { md: 768, lg: 1280 } as const
export type SlideBp = keyof typeof DESIGN_WIDTH

export const FRAME_CONTAINER = 'md:[container-type:inline-size]'
export const FRAME_CLIP = 'md:overflow-hidden'
const ASPECT_TOKEN = /^md:aspect-\[(\d+)\/(\d+)\]$/
const CQW_FONT = /^text-\[(\d*\.?\d+)cqw\]$/

const preset = (id: string) => SLIDE_ASPECTS.find(a => a.id === id) ?? SLIDE_ASPECTS[0]
export const aspectClass = (id: string) => `md:aspect-[${preset(id).w}/${preset(id).h}]`

/** A slide frame's classes: its own box (relative), the aspect, no padding, clipped, and the container its layers measure. */
export const slideFrameClasses = (aspect: string = DEFAULT_ASPECT) => `relative ${aspectClass(aspect)} md:p-0 ${FRAME_CLIP} ${FRAME_CONTAINER}`

// ── Reading ─────────────────────────────────────────────────────────────────────────────────────

/** A tag node's classes when written out ('' for none); null when built from data or not an element. */
export function classOf(n: CodeNode): string | null {
  if (!isTagNode(n) || n.ro) return null
  const c = n.props.className
  if (!c) return ''
  return c.k === 'lit' && typeof c.v === 'string' ? c.v : null
}

/** Every node with its ancestors (nearest last), in document order. */
export function forEachNode(n: CodeNode, fn: (n: CodeNode, up: CodeNode[]) => void, up: CodeNode[] = []): void {
  fn(n, up)
  const next = [...up, n]
  const kids = n.t === 'el' || n.t === 'cmp' || n.t === 'frag' ? n.children : []
  const slots = n.t === 'cmp' && n.render ? [n.render.body] : n.t === 'cond' ? [n.then, ...(n.else ? [n.else] : [])] : n.t === 'each' ? [n.body] : []
  for (const c of [...kids, ...slots]) forEachNode(c, fn, next)
}

/** The aspect a frame's classes ask for (`16:9`), or null when it has none. */
export function aspectIn(className: string): string | null {
  for (const t of splitTokens(className)) {
    const m = ASPECT_TOKEN.exec(t)
    if (m) return `${m[1]}:${m[2]}`
  }
  return null
}

/** Whether classes make a slide frame: the container and an aspect, both from Tablet up. */
export const isFrame = (className: string) => splitTokens(className).includes(FRAME_CONTAINER) && aspectIn(className) !== null

/** Whether the section is a slide: its root element is a slide frame. */
export function isSlide(tree: CodeNode | null | undefined): boolean {
  if (!tree || tree.t !== 'el') return false
  const c = classOf(tree)
  return c !== null && isFrame(c)
}

/** The slide's aspect (`16:9`), or null when the section is not a slide. */
export const aspectOf = (tree: CodeNode | null | undefined): string | null => (isSlide(tree) ? aspectIn(classOf(tree!) ?? '') : null)

/** The aspect as width / height, for sizing. */
export function ratioOf(aspect: string): number {
  const [w, h] = aspect.split(':').map(Number)
  return w > 0 && h > 0 ? w / h : 16 / 9
}

/** The slide's layers: the root's direct children that are elements, in tree (reading) order. */
export const slideLayers = (tree: CodeNode): TagNode[] => (tree.t === 'el' ? tree.children.filter(isTagNode) : [])

/** Live data parts (product lists…): placed in a fixed box that clips, not sized by their items. */
export const DATA_PARTS = new Set(['Products', 'Categories', 'Brands', 'Reviews', 'Offers', 'ProductResults', 'Carousel', 'Marquee', 'Tabs', 'Accordion'])
export const isDataPart = (n: CodeNode) => n.t === 'cmp' && DATA_PARTS.has(n.name)

// ── Container units ─────────────────────────────────────────────────────────────────────────────

/** A px size as container units of a design width: 48px at 1280 is 3.75cqw. */
export const pxToCqw = (px: number, width: number) => Math.round((px / width) * 10000) / 100
export const cqwToPx = (cqw: number, width: number) => (cqw * width) / 100

const TEXT_PX: Record<string, number> = { xs: 12, sm: 14, base: 16, lg: 18, xl: 20, '2xl': 24, '3xl': 30, '4xl': 36, '5xl': 48, '6xl': 60, '7xl': 72, '8xl': 96, '9xl': 128 }

/** A font-size class value (`3xl`, `[18px]`, `[1.5rem]`) in px, or null when it can't be told. */
export function textPx(value: string | undefined): number | null {
  if (!value) return null
  if (TEXT_PX[value]) return TEXT_PX[value]
  const m = /^\[(\d*\.?\d+)(px|rem|em)\]$/.exec(value)
  return m ? Number(m[1]) * (m[2] === 'px' ? 1 : 16) : null
}

/** Tailwind's own size nearest a px size (to give a cqw size back when a slide is made a flow section again). */
export function nearestTextSize(px: number): string {
  return Object.entries(TEXT_PX).reduce((best, [k, v]) => (Math.abs(v - px) < Math.abs(TEXT_PX[best] - px) ? k : best), 'base')
}

/** The container-unit font size an element sets itself at a breakpoint, or null. */
export function cqwOwn(className: string, bp: Breakpoint): number | null {
  for (const t of breakpointTokens(className, bp)) {
    const m = CQW_FONT.exec(classVariants(t).utility)
    if (m) return Number(m[1])
  }
  return null
}

/** The container-unit size in effect at a breakpoint (a narrower breakpoint's carries up). */
export function cqwAt(className: string, bp: Breakpoint): number | null {
  const order: Breakpoint[] = ['base', 'sm', 'md', 'lg', 'xl', '2xl']
  for (let i = order.indexOf(bp); i >= 0; i--) {
    const v = cqwOwn(className, order[i])
    if (v !== null) return v
  }
  return null
}

/** The font size set in container units at a breakpoint (null clears it); a px size set there goes, as it would fight it. */
export function setCqwFont(className: string, bp: Breakpoint, cqw: number | null): string {
  const next = setOwn(className, bp, 'fontSize', null)
  const keep = breakpointTokens(next, bp).filter(t => !CQW_FONT.test(classVariants(t).utility))
  const prefix = bp === 'base' ? '' : `${bp}:`
  return withBreakpoint(next, bp, cqw === null ? keep : [...keep, `${prefix}text-[${cqw}cqw]`])
}

// ── Frame classes ───────────────────────────────────────────────────────────────────────────────

// What a flow section sets that would fight the frame from Tablet up: its own padding and heights.
const CLEAR: PanelProp[] = ['padding', 'paddingX', 'paddingY', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'minHeight', 'height', 'maxHeight']

/** A section's root classes made a slide frame at an aspect (the phone classes are kept as they are). */
export function frameClasses(className: string, aspect: string = DEFAULT_ASPECT): string {
  let next = className
  if (effectiveValue(next, 'base', 'position')?.value !== 'relative') next = setPanelValue(next, 'base', 'position', 'relative')
  for (const bp of ['md', 'lg'] as const) for (const prop of CLEAR) next = setOwn(next, bp, prop, null)
  next = setOwn(next, 'lg', 'aspect', null)
  next = setOwn(next, 'md', 'padding', '0')
  next = setOwn(next, 'md', 'aspect', null)
  const keep = breakpointTokens(next, 'md').filter(t => !ASPECT_TOKEN.test(t) && t !== FRAME_CLIP && t !== FRAME_CONTAINER)
  return withBreakpoint(next, 'md', [...keep, aspectClass(aspect), FRAME_CLIP, FRAME_CONTAINER])
}

/** The same frame at another aspect. */
export function aspectClasses(className: string, aspect: string): string {
  const keep = breakpointTokens(className, 'md').filter(t => !ASPECT_TOKEN.test(t))
  return withBreakpoint(className, 'md', [...keep, aspectClass(aspect)])
}

/** A frame's classes made a flow section again: no aspect, clip or container, and padding back (the frame had none). */
export function unframeClasses(className: string): string {
  let next = setOwn(className, 'md', 'aspect', null)
  const keep = breakpointTokens(next, 'md').filter(t => !ASPECT_TOKEN.test(t) && t !== FRAME_CLIP && t !== FRAME_CONTAINER)
  next = withBreakpoint(next, 'md', keep)
  if (readClasses(next).values.md.padding === '0') next = setOwn(next, 'md', 'padding', null)
  const padded = (['padding', 'paddingY', 'paddingTop', 'paddingBottom'] as PanelProp[]).some(p => effectiveValue(next, 'base', p))
  if (!padded) {
    next = setOwn(next, 'base', 'paddingY', '10')
    next = setOwn(next, 'md', 'paddingY', '16')
  }
  return next
}

/** A section's words sized in container units given back as Tailwind sizes (at the design width of each breakpoint). */
export function dropCqw(className: string): string {
  let next = className
  for (const bp of ['md', 'lg'] as const) {
    const cqw = cqwOwn(next, bp)
    if (cqw !== null) next = setOwn(setCqwFont(next, bp, null), bp, 'fontSize', nearestTextSize(cqwToPx(cqw, DESIGN_WIDTH[bp])))
  }
  return next
}

// ── Words in px ─────────────────────────────────────────────────────────────────────────────────

/**
 * The words inside a slide that are sized in px at Tablet: for each element holding its own words, the nearest element
 * from it up (the layer, say) that sets a size there; container units are fine, anything else is reported with that
 * element (`holder`) and its size value.
 */
export function pxText(tree: CodeNode): { node: CodeNode; holder: TagNode; text: string; value: string }[] {
  const out: { node: CodeNode; holder: TagNode; text: string; value: string }[] = []
  if (!isSlide(tree)) return out
  forEachNode(tree, (n, up) => {
    if (n === tree || !isTagNode(n)) return
    const text = n.children
      .filter((c): c is Extract<CodeNode, { t: 'text' }> => c.t === 'text')
      .map(c => c.value)
      .join('')
      .replace(/\s+/g, ' ')
      .trim()
    if (!text) return
    const chain = [...up.slice(1), n].filter(isTagNode)
    for (let i = chain.length - 1; i >= 0; i--) {
      const cls = classOf(chain[i])
      if (cls === null || cqwOwn(cls, 'md') !== null) return
      const eff = effectiveValue(cls, 'md', 'fontSize')
      if (!eff) continue
      out.push({ node: n, holder: chain[i], text, value: eff.value })
      return
    }
  })
  return out
}
