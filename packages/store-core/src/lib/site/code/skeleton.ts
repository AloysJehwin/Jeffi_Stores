import { CARD_PRODUCT, type CodeNode, type CodeValue } from './ast'
import { FORBIDDEN_KEYS, VOID_TAGS } from './allow'
import { evalValue, toText, truthy } from './evaluate'
import {
  ACCORDION,
  ACCORDION_ROW,
  CHEVRON,
  EMPTY,
  ICON,
  ICON_BOX,
  ICON_SIZE,
  LIST,
  LISTS,
  MARQUEE,
  MARQUEE_BOX,
  MOSAIC,
  PARTS,
  PILL,
  RAIL,
  RAIL_ITEM,
  SLIDE,
  SLIDE_ITEM,
  TABS,
  TAB_CENTER,
  TAB_PANEL,
  bar,
  baseOf,
  classList,
  frag,
  h,
  mosaicItemClass,
  picture,
  repeat,
  stripColours,
  txt,
  unknownPart,
  unvaried,
  withCls,
  type ListSkeleton,
} from './parts/skeleton'

// A code section's loading skeleton, built from its AST when it compiles. The AI's elements and layout classes stay, so
// the skeleton has the page's grid, spacing and sizes; text becomes shimmer bars in its own font size, pictures shimmer
// blocks, buttons pills, data lists a few repeats of their item, and each library part a skeleton of its own
// (components/visitor/skeletons/code.ts). The result reads no data and holds no parts: the interpreter draws it alone.

type El = Extract<CodeNode, { t: 'el' }>
type Cmp = Extract<CodeNode, { t: 'cmp' }>
type Each = Extract<CodeNode, { t: 'each' }>
type Lit = Extract<CodeValue, { k: 'lit' }>['v']

/** What a name stands for here: a value known now, an index the interpreter binds, or store data. */
type Bind = { k: 'static'; v: unknown } | { k: 'index' } | { k: 'data'; hint?: string }
interface Ctx {
  vars: ReadonlyMap<string, Bind>
  budget: { n: number }
  /** Inside a pill: text stays (the pill hides it) and colours go. */
  pill: boolean
  /** Capitals and wide tracking run wider. */
  wide: boolean
}
type Item = { node: CodeNode; ctx: Ctx }

const MAX_NODES = 2500
/** A literal list's items are drawn one by one, so each keeps its own text length. */
const UNROLL = 12
/** Items of a list read from data inside an item (a product's pictures, a category's children). */
const NESTED = 3
/** A data value where it is tested: present (a product shows its price, its picture, its badge). */
const STAND_IN = 1
const CHUNK = 24
const MAX_BARS = 12
const DATA: Bind = { k: 'data' }
const INDEX: Bind = { k: 'index' }
const NONE = new Map<string, unknown>()
const RECORDS = new Set(['Store', 'Product', 'HeroPicture', 'BusinessPicture', 'Business', 'Category', 'Brand', 'SearchQuery', 'SeoText'])
const PHRASING = new Set(['span', 'strong', 'em', 'b', 'i', 'u', 's', 'small', 'mark', 'sup', 'sub', 'br', 'abbr', 'time', 'code', 'del', 'ins', 'q', 'cite'])
const KEEP = ['colSpan', 'rowSpan', 'open', 'hidden']
const WIDE = /^(uppercase|tracking-(wide|wider|widest|\[(?!-)))/
const NARROW = /^(normal-case|lowercase|tracking-(normal|tight|tighter))$/

/** Characters a data field usually runs to. */
const HINT: Record<string, number> = {
  name: 18, title: 22, label: 10, term: 10, price: 7, mrp: 7, brand: 10, category: 12, badge: 8, stars: 9, rating: 3, reviewCount: 3,
  productCount: 3, total: 3, discountPct: 3, year: 4, founded: 4, value: 4, author: 10, productName: 16, parentName: 12, email: 18,
  phone: 12, whatsapp: 12, address: 32, tagline: 30, subtitle: 26, cta: 10, network: 9, headquarters: 14, origin: 10, website: 18,
  source: 10, profession: 16, question: 40, shortDescription: 60, description: 120, about: 140, comment: 110, quote: 110, answer: 100,
  story: 160, text: 160, paragraphs: 140,
}

const lit = (v: unknown): CodeValue => ({ k: 'lit', v: (v === undefined ? null : v) as Lit })
const isCmp = (n: CodeNode, name: string): n is Cmp => n.t === 'cmp' && n.name === name

// ── Values ────────────────────────────────────────────────────────────────────────────────────────

/** Whether a value reads store data, an index the interpreter binds, or only what is known now. */
function kindOf(v: unknown, ctx: Ctx): 'static' | 'index' | 'data' {
  let kind: 'static' | 'index' | 'data' = 'static'
  const walk = (x: unknown, depth: number) => {
    if (!x || typeof x !== 'object' || depth > 50 || kind === 'data') return
    const c = x as { k?: unknown; root?: unknown }
    if (c.k === 'lit') return
    if (c.k === 'path') {
      const b = typeof c.root === 'string' ? ctx.vars.get(c.root) : undefined
      if (b?.k === 'index') kind = 'index'
      else if (b?.k !== 'static') kind = 'data'
      return
    }
    for (const y of Object.values(x)) walk(y, depth + 1)
  }
  walk(v, 0)
  return kind
}

/** The value with known names filled in and data standing in as present. */
function fill(v: CodeValue, ctx: Ctx, depth = 0): CodeValue {
  if (!v || typeof v !== 'object' || depth > 50) return lit(null)
  const f = (x: CodeValue) => fill(x, ctx, depth + 1)
  switch (v.k) {
    case 'lit':
      return v
    case 'path': {
      const b = ctx.vars.get(v.root)
      if (b?.k === 'index') return v
      if (b?.k === 'static') return lit(evalValue(v, new Map([[v.root, b.v]])))
      return lit(STAND_IN)
    }
    case 'tpl':
      return { k: 'tpl', parts: (v.parts ?? []).map(p => (typeof p === 'string' ? p : f(p))) }
    case 'not':
    case 'bool':
      return { k: v.k, v: f(v.v) }
    case 'eq':
      return { k: 'eq', a: f(v.a), b: f(v.b) }
    case 'cmp':
      return { k: 'cmp', op: v.op, a: f(v.a), b: f(v.b) }
    case 'cond':
      return { k: 'cond', test: f(v.test), then: f(v.then), else: f(v.else) }
    case 'obj':
      return { k: 'obj', v: Object.fromEntries(Object.entries(v.v ?? {}).filter(([k]) => !FORBIDDEN_KEYS.has(k)).map(([k, x]) => [k, f(x)])) }
    case 'arr':
      return { k: 'arr', v: (v.v ?? []).map(f) }
    default:
      return lit(null)
  }
}

/** A value as far as it is known now: a literal, or a value the interpreter finishes (it reads an index). */
function resolve(v: CodeValue | undefined, ctx: Ctx): CodeValue {
  if (!v) return lit(null)
  const out = fill(v, ctx)
  return kindOf(out, ctx) === 'static' ? lit(evalValue(out, NONE)) : out
}

function classOf(v: CodeValue | undefined, ctx: Ctx): CodeValue | null {
  if (!v) return null
  const r = resolve(v, ctx)
  return r.k !== 'lit' || (typeof r.v === 'string' && r.v.trim()) ? r : null
}

const joinCls = (a: CodeValue | undefined, b: CodeValue): CodeValue =>
  !a ? b : a.k === 'lit' && b.k === 'lit' ? lit(`${toText(a.v)} ${toText(b.v)}`.trim()) : { k: 'tpl', parts: [a, ' ', b] }

function bind(ctx: Ctx, param: unknown, b: Bind, index?: unknown, i?: number): Ctx {
  const vars = new Map(ctx.vars)
  if (typeof param === 'string') vars.set(param, b)
  if (typeof index === 'string') vars.set(index, i === undefined ? INDEX : { k: 'static', v: i })
  return { ...ctx, vars }
}

/** A part's props known now (literals, consts, a literal list's item); data ones are left out. */
function known(raw: Record<string, CodeValue> | undefined, ctx: Ctx): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(raw ?? {})) {
    if (k === 'className' || k.endsWith('ClassName') || FORBIDDEN_KEYS.has(k) || kindOf(v, ctx) !== 'static') continue
    const r = resolve(v, ctx)
    if (r.k === 'lit') out[k] = r.v
  }
  return out
}

// ── Text ──────────────────────────────────────────────────────────────────────────────────────────

const fieldOf = (path: unknown): string =>
  Array.isArray(path) ? ([...path].reverse().find(k => typeof k === 'string' && !/^(formatted|value|length|\d+)$/.test(k)) ?? '') : ''

/** Roughly how many characters a value shows. */
function lengthOf(v: unknown, ctx: Ctx, depth = 0): number {
  if (!v || typeof v !== 'object' || depth > 20) return 0
  const c = v as CodeValue
  switch (c.k) {
    case 'lit':
      return [...toText(c.v)].length
    case 'path': {
      const b = ctx.vars.get(c.root)
      if (b?.k === 'static') return [...toText(evalValue(c, new Map([[c.root, b.v]])))].length
      if (b?.k === 'index') return 2
      return HINT[fieldOf(c.path)] ?? HINT[b?.k === 'data' ? (b.hint ?? '') : ''] ?? 12
    }
    case 'tpl':
      return (c.parts ?? []).reduce<number>((n, p) => n + (typeof p === 'string' ? [...p].length : lengthOf(p, ctx, depth + 1)), 0)
    case 'cond': {
      const t = resolve(c.test, ctx)
      if (t.k === 'lit') return lengthOf(truthy(t.v) ? c.then : c.else, ctx, depth + 1)
      return Math.max(lengthOf(c.then, ctx, depth + 1), lengthOf(c.else, ctx, depth + 1))
    }
    default:
      return 0
  }
}

/** Word-sized runs of a text, so its bars wrap as its lines would. */
function chunks(s: string): number[] {
  if ([...s].length <= CHUNK + 8) return [[...s].length]
  const out: number[] = []
  let cur = 0
  for (const w of s.split(/\s+/)) {
    const n = [...w].length
    if (cur && cur + 1 + n > CHUNK) {
      out.push(cur)
      if (out.length >= MAX_BARS) return out
      cur = n
    } else cur = cur ? cur + 1 + n : n
  }
  if (cur) out.push(cur)
  return out
}

const PATTERN = [22, 18, 24, 20, 16]
/** Runs for a text whose length is all that is known. */
function spread(n: number): number[] {
  if (n <= CHUNK + 8) return n > 0 ? [n] : []
  const out: number[] = []
  for (let left = n, i = 0; left > 0 && out.length < MAX_BARS; i++) {
    const c = Math.min(PATTERN[i % PATTERN.length], left)
    out.push(Math.max(c, 3))
    left -= c + 1
  }
  return out
}

/** Bars for runs of characters, spaced like words. A character is a bit under a `ch` of the font, capitals a bit over. */
function bars(runs: number[], ctx: Ctx): CodeNode[] {
  const k = ctx.wide ? 1.2 : 0.85
  return runs.flatMap((n, i) => (i ? [txt(' '), bar(n * k)] : [bar(n * k)]))
}

/** Text as bars. Separators and marks (/, ·, →) stay as they are; inside a pill the text stays, hidden by the pill. */
function text(s: string, ctx: Ctx): CodeNode {
  if (!s) return EMPTY
  if (ctx.pill || !/[\p{L}\p{N}]/u.test(s)) return txt(s)
  const out: CodeNode[] = []
  if (/^\s/.test(s)) out.push(txt(' '))
  out.push(...bars(chunks(s.trim()), ctx))
  if (/\s$/.test(s)) out.push(txt(' '))
  return frag(out)
}

/** A shown value: its text when it is known, else bars as long as such a value usually runs. */
function shown(v: CodeValue | undefined, ctx: Ctx): CodeNode {
  if (!v) return EMPTY
  if (kindOf(v, ctx) === 'static') {
    const r = resolve(v, ctx)
    return r.k === 'lit' ? text(toText(r.v), ctx) : EMPTY
  }
  const n = lengthOf(v, ctx)
  return ctx.pill ? txt('0'.repeat(Math.min(n, 40))) : frag(bars(spread(n), ctx))
}

// ── Nodes ─────────────────────────────────────────────────────────────────────────────────────────

function sk(n: unknown, ctx: Ctx): CodeNode {
  if (!n || typeof n !== 'object' || ctx.budget.n-- <= 0) return EMPTY
  const node = n as CodeNode
  switch (node.t) {
    case 'text':
      return typeof node.value === 'string' ? text(node.value, ctx) : EMPTY
    case 'expr':
      return shown(node.value, ctx)
    case 'frag':
      return frag(kids(node.children, ctx))
    case 'cond': {
      const test = resolve(node.test, ctx)
      if (test.k === 'lit') return truthy(test.v) ? sk(node.then, ctx) : node.else ? sk(node.else, ctx) : EMPTY
      return { t: 'cond', test, then: sk(node.then, ctx), ...(node.else ? { else: sk(node.else, ctx) } : {}) }
    }
    case 'each':
      return frag(each(node, ctx))
    case 'el':
      return element(node, ctx)
    case 'cmp':
      return component(node, ctx)
    default:
      return EMPTY
  }
}

function kids(list: unknown, ctx: Ctx): CodeNode[] {
  const out: CodeNode[] = []
  if (Array.isArray(list))
    for (const c of list) {
      const n = sk(c, ctx)
      if (n.t === 'frag') out.push(...n.children)
      else out.push(n)
    }
  return out
}

/** A `.map`: a literal list item by item; a list read from data, a few of its item. */
function each(node: Each, ctx: Ctx): CodeNode[] {
  if (kindOf(node.items, ctx) === 'static') {
    const items = resolve(node.items, ctx)
    if (items.k !== 'lit' || !Array.isArray(items.v)) return []
    return items.v.slice(0, UNROLL).flatMap((item, i) => {
      const n = sk(node.body, bind(ctx, node.param, { k: 'static', v: item }, node.index, i))
      return n.t === 'frag' ? n.children : [n]
    })
  }
  const hint = node.items?.k === 'path' ? fieldOf(node.items.path) : undefined
  return [repeat(NESTED, sk(node.body, bind(ctx, node.param, { k: 'data', hint }, node.index)), node.index)]
}

/** The context for an element's children: wide while capitals or wide tracking are on. */
function inner(ctx: Ctx, classes: string[]): Ctx {
  const own = classes.filter(unvaried)
  const wide = own.some(c => WIDE.test(c)) ? true : own.some(c => NARROW.test(c)) ? false : ctx.wide
  return wide === ctx.wide ? ctx : { ...ctx, wide }
}

function element(node: El, ctx: Ctx): CodeNode {
  const cls = classOf(node.props?.className, ctx)
  const classes = classList(cls)
  if (node.tag === 'img') return picture(cls)
  if (node.tag === 'a' && !ctx.pill && buttonLike(classes, node.children, ctx)) return pill(node.children, cls, ctx)
  const props: Record<string, CodeValue> = {}
  const own = ctx.pill ? stripColours(cls) : cls
  if (own) props.className = own
  for (const k of KEEP) if (node.props?.[k]) props[k] = resolve(node.props[k], ctx)
  // A skeleton links nowhere.
  const tag = node.tag === 'a' ? 'span' : node.tag
  return { t: 'el', tag, props, children: VOID_TAGS.has(tag) ? [] : kids(node.children, inner(ctx, classes)) }
}

/** A link styled as a button: padding and a box of its own (a fill, a border or a pill shape) around a short label. */
function buttonLike(classes: string[], children: unknown, ctx: Ctx): boolean {
  const own = classes.filter(unvaried).map(baseOf)
  const padded = own.some(c => /^px?-(?!0$)/.test(c))
  const boxed = own.some(c => (/^bg-/.test(c) && !/^bg-(transparent|none|clip-|opacity-)/.test(c)) || /^border(-\d+|-\[[^\]]+\])?$/.test(c) || c === 'rounded-full')
  if (!padded || !boxed) return false
  const n = labelLength(children, ctx)
  return n !== null && n <= 40
}

/** A label's length when the children are only text, inline marks and icons, else null. */
function labelLength(list: unknown, ctx: Ctx, depth = 0): number | null {
  if (!Array.isArray(list) || depth > 6) return 0
  let n = 0
  for (const c of list as CodeNode[]) {
    if (!c || typeof c !== 'object') continue
    let m: number | null
    if (c.t === 'text') m = c.value.trim().length
    else if (c.t === 'expr') m = lengthOf(c.value, ctx)
    else if (c.t === 'frag') m = labelLength(c.children, ctx, depth + 1)
    else if (c.t === 'cond') {
      const a = labelLength([c.then], ctx, depth + 1)
      const b = c.else ? labelLength([c.else], ctx, depth + 1) : 0
      m = a === null || b === null ? null : Math.max(a, b)
    } else if (c.t === 'el') m = PHRASING.has(c.tag) ? labelLength(c.children, ctx, depth + 1) : null
    else m = isCmp(c, 'Icon') ? 2 : null
    if (m === null) return null
    n += m
  }
  return n
}

function pill(children: unknown, cls: CodeValue | null, ctx: Ctx): CodeNode {
  return h('span', withCls(stripColours(cls), PILL), ...kids(children, { ...ctx, pill: true }))
}

function component(node: Cmp, ctx: Ctx): CodeNode {
  const cls = classOf(node.props?.className, ctx)
  const props = known(node.props, ctx)
  const list = LISTS[node.name]
  if (list) return dataList(node, list, props, cls, ctx)
  switch (node.name) {
    case 'Link': {
      const classes = classList(cls)
      if (!ctx.pill && buttonLike(classes, node.children, ctx)) return pill(node.children, cls, ctx)
      return h('span', ctx.pill ? stripColours(cls) : cls, ...kids(node.children, inner(ctx, classes)))
    }
    case 'Icon':
      return h('span', withCls(ctx.pill ? stripColours(cls) : cls, `${ctx.pill ? ICON_BOX : ICON} ${ICON_SIZE[String(props.size)] ?? ICON_SIZE.md}`))
    case 'Image':
      return picture(cls, props.aspect)
    case 'Reveal':
      return h('div', cls, ...kids(node.children, ctx))
    case 'Tab':
      return frag(kids(node.children, ctx))
    case 'Marquee':
      return h('div', withCls(cls, MARQUEE_BOX), h('div', MARQUEE, ...kids(node.children, ctx)))
    case 'Carousel': {
      const itemCls = classOf(node.props?.itemClassName, ctx)
      const width = itemCls ? withCls(itemCls, SLIDE) : `${SLIDE} ${SLIDE_ITEM}`
      return h('div', cls, h('div', RAIL, ...expand(node.children, ctx).slice(0, 6).map(x => h('div', width, sk(x.node, x.ctx)))))
    }
    case 'Tabs':
      return tabs(node, cls, props, ctx)
    case 'Accordion':
      return h('div', cls ?? ACCORDION, ...expand(node.children, ctx).filter(x => isCmp(x.node, 'AccordionItem')).map(x => accordionItem(x.node as Cmp, x.ctx)))
    case 'AccordionItem':
      return accordionItem(node, ctx)
  }
  // A record (the store, this product, the opening picture…) drawn once through its render function.
  if (node.render && RECORDS.has(node.name)) return sk(node.render.body, bind(ctx, node.render.param, DATA, node.render.index, 0))
  const part = PARTS[node.name]
  if (part) return part(props, cls)
  return node.children?.length ? frag(kids(node.children, ctx)) : unknownPart(cls)
}

const num = (v: unknown) => (typeof v === 'number' && v >= 1 ? Math.floor(v) : undefined)
const len = (v: unknown) => (Array.isArray(v) && v.length ? v.length : undefined)

/** A data list: its own layout (the section's className, a carousel or a mosaic) around a few of its item. */
function dataList(node: Cmp, spec: ListSkeleton, props: Record<string, unknown>, cls: CodeValue | null, ctx: Ctx): CodeNode {
  const layout = props.layout
  const query = props.query && typeof props.query === 'object' ? (props.query as Record<string, unknown>) : {}
  const asked = num(props.limit) ?? num(query.limit) ?? len(props.slugs) ?? len(query.slugs) ?? len(props.links) ?? len(props.columns) ?? spec.n
  const n = Math.min(asked, layout === 'mosaic' ? 12 : layout === 'carousel' ? 6 : 8)
  const itemCls = classOf(node.props?.itemClassName, ctx)
  const r = node.render && typeof node.render.param === 'string' ? node.render : null
  const item = (i?: number) => (r ? sk(r.body, bind(ctx, r.param, DATA, r.index, i)) : spec.tile(props))
  // A mosaic sizes each item by its place and the count, so its items are drawn one by one.
  if (layout === 'mosaic') return h('div', withCls(cls, MOSAIC), ...Array.from({ length: n }, (_, i) => placed(item(i), withCls(itemCls, mosaicItemClass(i, n).trim()))))
  if (layout === 'carousel') return h('div', cls, h('div', RAIL, repeat(n, h('div', itemCls ? withCls(itemCls, SLIDE) : `${SLIDE} ${spec.rail ?? RAIL_ITEM}`, item()), r?.index)))
  const grid = typeof spec.grid === 'function' ? spec.grid(props) : spec.grid
  return h('div', cls ?? (layout === 'list' ? LIST : grid), repeat(n, itemCls ? placed(item(), itemCls) : item(), r?.index))
}

/** An item with classes on its own root, as ItemsLayout puts them, or in a wrapper when it has none. */
function placed(body: CodeNode, extra: CodeValue): CodeNode {
  if (body.t === 'el') return { ...body, props: { ...body.props, className: joinCls(body.props.className, extra) } }
  return h('div', extra, body)
}

function tabs(node: Cmp, cls: CodeValue | null, props: Record<string, unknown>, ctx: Ctx): CodeNode {
  const list = expand(node.children, ctx).filter(x => isCmp(x.node, 'Tab'))
  if (!list.length) return EMPTY
  const s = TABS[String(props.variant)] ?? TABS.underline
  const head = list.map((x, i) => h('span', `${s.tab} ${i ? s.off : s.on}`.trim(), shown((x.node as Cmp).props?.label, x.ctx)))
  const first = list[0]
  return h('div', cls, h('div', props.align === 'center' ? `${s.list} ${TAB_CENTER}` : s.list, ...head), h('div', TAB_PANEL, ...kids((first.node as Cmp).children, first.ctx)))
}

function accordionItem(node: Cmp, ctx: Ctx): CodeNode {
  return h('div', classOf(node.props?.className, ctx), h('div', ACCORDION_ROW, h('span', null, shown(node.props?.title, ctx)), h('span', CHEVRON)))
}

/** Children as the items they draw: fragments opened, literal lists unrolled, settled conditions taken. */
function expand(list: unknown, ctx: Ctx, out: Item[] = [], depth = 0): Item[] {
  if (!Array.isArray(list) || depth > 8) return out
  for (const c of list as CodeNode[]) {
    if (!c || typeof c !== 'object') continue
    if (c.t === 'frag') expand(c.children, ctx, out, depth + 1)
    else if (c.t === 'cond') {
      const t = resolve(c.test, ctx)
      const branch = t.k !== 'lit' || truthy(t.v) ? c.then : c.else
      if (branch) expand([branch], ctx, out, depth + 1)
    } else if (c.t === 'each') {
      if (kindOf(c.items, ctx) === 'static') {
        const items = resolve(c.items, ctx)
        if (items.k === 'lit' && Array.isArray(items.v))
          items.v.slice(0, UNROLL).forEach((it, i) => expand([c.body], bind(ctx, c.param, { k: 'static', v: it }, c.index, i), out, depth + 1))
      } else for (let i = 0; i < NESTED; i++) expand([c.body], bind(ctx, c.param, DATA, c.index, i), out, depth + 1)
    } else if (c.t !== 'text' || c.value.trim()) out.push({ node: c, ctx })
  }
  return out
}

/** A section's loading skeleton, from its compiled AST. Pure: the same AST always gives the same skeleton. */
export function codeSkeleton(ast: CodeNode | null | undefined): CodeNode {
  // A site card's root is the product it is drawn for.
  return sk(ast, { vars: new Map([[CARD_PRODUCT, DATA]]), budget: { n: MAX_NODES }, pill: false, wide: false })
}
