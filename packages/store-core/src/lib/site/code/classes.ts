import { BREAKPOINTS, EDITOR_BREAKPOINTS, breakpointTokens, classVariants, splitTokens, tokenBreakpoint, withBreakpoint, type Breakpoint, type DesignOp } from '@jeffi/site-blocks/design'

// The style panel's view of a className: a fixed set of Tailwind utilities read as properties per breakpoint (type,
// theme colours plus [#hex], spacing, size, radius, border, shadow, layout, position). Anything else (hover:, dark:,
// per-corner radius, utilities outside the set) is kept as it is. Pure: the editor runs it in the browser, and the
// operations it yields are checked again by the compile on save.

export type PanelGroup = 'type' | 'color' | 'spacing' | 'size' | 'radius' | 'border' | 'shadow' | 'layout' | 'position'

const SHADES = '(?:50|100|200|300|400|500|600|700|800|900|950)'
// Theme colours, the default palette (AI code uses it), keywords and arbitrary hex; an opacity may follow.
const COLOR = `(?:surface(?:-elevated|-secondary)?|foreground(?:-secondary|-muted)?|border-(?:default|secondary)|(?:primary|secondary|accent|[a-z]+)-${SHADES}|white|black|transparent|current|inherit|\\[#[0-9a-fA-F]{3,8}\\])(?:\\/\\d{1,3})?`
const ARB = '\\[[^\\]\\s]+\\]'
const SPACE = `(?:\\d+(?:\\.5)?|px|${ARB})`
const SIZE = `(?:\\d+(?:\\.5)?|px|auto|full|screen|min|max|fit|svh|dvh|lvh|\\d+\\/\\d+|xs|sm|md|lg|xl|[2-7]xl|prose|none|${ARB})`
const LENGTH = /^\[(?:-?[\d.]+(?:px|rem|em|%|vw|vh|ch)|calc\(.+\)|clamp\(.+\))\]$/

interface PropDef {
  group: PanelGroup
  /** Matches a utility (no variants); captures its value. */
  re: RegExp
  /** The utility for a value. */
  make: (v: string) => string
}

const def = (group: PanelGroup, prefix: string, value: string): PropDef => ({ group, re: new RegExp(`^${prefix.replace(/-$/, '')}-(${value})$`), make: v => `${prefix.replace(/-$/, '')}-${v}` })
const word = (group: PanelGroup, words: string): PropDef => ({ group, re: new RegExp(`^(${words})$`), make: v => v })
const signed = (group: PanelGroup, prefix: string, value: string): PropDef => ({
  group,
  re: new RegExp(`^(-?)${prefix}-(${value})$`),
  make: v => (v.startsWith('-') ? `-${prefix}-${v.slice(1)}` : `${prefix}-${v}`),
})

export const PANEL_PROPS = {
  fontFamily: def('type', 'font', 'sans|serif|mono|display|bebas|inter'),
  fontWeight: def('type', 'font', 'thin|extralight|light|normal|medium|semibold|bold|extrabold|black'),
  fontSize: { group: 'type', re: /^text-(xs|sm|base|lg|xl|[2-9]xl|\[[^\]\s]+\])$/, make: v => `text-${v}` },
  lineHeight: def('type', 'leading', `none|tight|snug|normal|relaxed|loose|\\d+|${ARB}`),
  letterSpacing: def('type', 'tracking', `tighter|tight|normal|wide|wider|widest|${ARB}`),
  textAlign: def('type', 'text', 'left|center|right|justify|start|end'),
  textTransform: word('type', 'uppercase|lowercase|capitalize|normal-case'),
  fontStyle: word('type', 'italic|not-italic'),
  textColor: def('color', 'text', COLOR),
  bgColor: def('color', 'bg', COLOR),
  borderColor: def('color', 'border', COLOR),
  padding: def('spacing', 'p', SPACE),
  paddingX: def('spacing', 'px', SPACE),
  paddingY: def('spacing', 'py', SPACE),
  paddingTop: def('spacing', 'pt', SPACE),
  paddingRight: def('spacing', 'pr', SPACE),
  paddingBottom: def('spacing', 'pb', SPACE),
  paddingLeft: def('spacing', 'pl', SPACE),
  margin: signed('spacing', 'm', `${SPACE}|auto`),
  marginX: signed('spacing', 'mx', `${SPACE}|auto`),
  marginY: signed('spacing', 'my', `${SPACE}|auto`),
  marginTop: signed('spacing', 'mt', `${SPACE}|auto`),
  marginRight: signed('spacing', 'mr', `${SPACE}|auto`),
  marginBottom: signed('spacing', 'mb', `${SPACE}|auto`),
  marginLeft: signed('spacing', 'ml', `${SPACE}|auto`),
  gap: def('spacing', 'gap', SPACE),
  gapX: def('spacing', 'gap-x', SPACE),
  gapY: def('spacing', 'gap-y', SPACE),
  spaceX: def('spacing', 'space-x', SPACE),
  spaceY: def('spacing', 'space-y', SPACE),
  width: def('size', 'w', SIZE),
  height: def('size', 'h', SIZE),
  minWidth: def('size', 'min-w', SIZE),
  maxWidth: def('size', 'max-w', SIZE),
  minHeight: def('size', 'min-h', SIZE),
  maxHeight: def('size', 'max-h', SIZE),
  aspect: def('size', 'aspect', `auto|square|video|${ARB}`),
  radius: { group: 'radius', re: /^rounded(?:-(none|sm|md|lg|xl|2xl|3xl|full|\[[^\]\s]+\]))?$/, make: v => (v ? `rounded-${v}` : 'rounded') },
  borderWidth: { group: 'border', re: /^border(?:-(0|2|4|8|\[[^\]\s]+\]))?$/, make: v => (v ? `border-${v}` : 'border') },
  shadow: { group: 'shadow', re: /^shadow(?:-(sm|md|lg|xl|2xl|inner|none|\[[^\]\s]+\]))?$/, make: v => (v ? `shadow-${v}` : 'shadow') },
  display: word('layout', 'block|inline-block|inline|flex|inline-flex|grid|inline-grid|hidden|contents|table'),
  flexDirection: def('layout', 'flex', 'row|row-reverse|col|col-reverse'),
  flexWrap: def('layout', 'flex', 'wrap|wrap-reverse|nowrap'),
  justify: def('layout', 'justify', 'start|end|center|between|around|evenly|stretch'),
  align: def('layout', 'items', 'start|end|center|baseline|stretch'),
  gridCols: def('layout', 'grid-cols', `\\d+|none|subgrid|${ARB}`),
  colSpan: def('layout', 'col-span', '\\d+|full'),
  order: signed('layout', 'order', `\\d+|first|last|none|${ARB}`),
  position: word('position', 'static|relative|absolute|fixed|sticky'),
  inset: signed('position', 'inset', SIZE),
  top: signed('position', 'top', SIZE),
  right: signed('position', 'right', SIZE),
  bottom: signed('position', 'bottom', SIZE),
  left: signed('position', 'left', SIZE),
  zIndex: signed('position', 'z', `\\d+|auto|${ARB}`),
} satisfies Record<string, PropDef>

export type PanelProp = keyof typeof PANEL_PROPS
const PROPS = Object.entries(PANEL_PROPS) as [PanelProp, PropDef][]

/** The property a utility sets and its value (`text-2xl` → fontSize 2xl), or null outside the set. */
export function utilityProp(utility: string): { prop: PanelProp; value: string } | null {
  for (const [prop, d] of PROPS) {
    const m = d.re.exec(utility)
    if (!m) continue
    const value = m.length > 2 ? `${m[1]}${m[2]}` : (m[1] ?? '')
    // `text-[…]` and `border-[…]`: a length is a size or a width, anything else a colour.
    if ((prop === 'fontSize' || prop === 'borderWidth') && value.startsWith('[') && !LENGTH.test(value)) continue
    if ((prop === 'textColor' || prop === 'borderColor') && value.startsWith('[') && !value.startsWith('[#')) continue
    return { prop, value }
  }
  return null
}

/** A token the panel reads: only a breakpoint prefix (or none) before a utility in the set. */
function panelToken(token: string): { bp: Breakpoint; prop: PanelProp; value: string } | null {
  const { variants, utility } = classVariants(token)
  if (variants.length > 1 || utility.startsWith('!')) return null
  const bp = tokenBreakpoint(token)
  if (bp === 'other' || (variants.length === 1 && variants[0] !== bp)) return null
  const p = utilityProp(utility)
  return p ? { bp, ...p } : null
}

export interface PanelClasses {
  /** Each breakpoint's own values. */
  values: Record<Breakpoint, Partial<Record<PanelProp, string>>>
  /** Tokens outside the set, kept as they are. */
  unknown: string[]
}

export function readClasses(className: string): PanelClasses {
  const values = Object.fromEntries(BREAKPOINTS.map(b => [b, {}])) as PanelClasses['values']
  const unknown: string[] = []
  for (const t of splitTokens(className)) {
    const p = panelToken(t)
    if (p) values[p.bp][p.prop] = p.value
    else unknown.push(t)
  }
  return { values, unknown }
}

const rank = (bp: Breakpoint) => BREAKPOINTS.indexOf(bp)

/** The value in effect at a breakpoint and where it is set (narrower breakpoints carry up). */
export function effectiveValue(className: string, bp: Breakpoint, prop: PanelProp): { value: string; from: Breakpoint } | null {
  const { values } = readClasses(className)
  for (let i = rank(bp); i >= 0; i--) {
    const v = values[BREAKPOINTS[i]][prop]
    if (v !== undefined) return { value: v, from: BREAKPOINTS[i] }
  }
  return null
}

const prefixed = (bp: Breakpoint, utility: string) => (bp === 'base' ? utility : `${bp}:${utility}`)

/** One breakpoint's own value of a property set (null clears it); its other tokens are kept. Nothing is pinned. */
export function setOwn(className: string, bp: Breakpoint, prop: PanelProp, value: string | null): string {
  const keep = breakpointTokens(className, bp).filter(t => panelToken(t)?.prop !== prop)
  return withBreakpoint(className, bp, value === null ? keep : [...keep, prefixed(bp, PANEL_PROPS[prop].make(value))])
}

/**
 * The classes with a property set at a breakpoint (null clears it). The next editor breakpoint up that inherited the
 * old value gets it pinned, so editing Phone leaves Tablet and Desktop as they were (and Tablet leaves Desktop).
 */
export function setPanelValue(className: string, bp: Breakpoint, prop: PanelProp, value: string | null): string {
  const before = effectiveValue(className, bp, prop)
  const own = readClasses(className).values[bp][prop]
  if ((own ?? null) === value) return className
  let next = setOwn(className, bp, prop, value)
  const up = EDITOR_BREAKPOINTS.find(b => rank(b) > rank(bp))
  if (up && before) {
    const was = effectiveValue(className, up, prop)
    if (was && rank(was.from) <= rank(bp) && readClasses(next).values[up][prop] === undefined) next = setOwn(next, up, prop, before.value)
  }
  return next
}

/** The operations that turn one class string into another: one per breakpoint whose tokens changed. */
export function classOps(id: string, before: string, after: string): DesignOp[] {
  const ops: DesignOp[] = []
  for (const bp of BREAKPOINTS) {
    const a = breakpointTokens(before, bp)
    const b = breakpointTokens(after, bp)
    if (a.join(' ') !== b.join(' ')) ops.push({ op: 'classes', id, bp, value: b })
  }
  return ops
}
