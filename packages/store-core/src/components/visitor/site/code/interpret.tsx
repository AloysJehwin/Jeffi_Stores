import { Fragment, cloneElement, createElement, isValidElement, type Key, type ReactNode } from 'react'
import Link from 'next/link'
import { NODE_ID, type PageKey } from '@jeffi/site-blocks'
import { carouselList, type CodeNode, type CodeValue } from '@/lib/site/code/ast'
import { FORBIDDEN_KEYS, HTML_TAGS, MAX_DEPTH, MAX_EACH, VOID_TAGS, attrAllowed, safeHref, safeSrc, taxonomyOf } from '@/lib/site/code/allow'
import { codeMark } from '@/lib/site/code/css'
import { isRichText } from '@/lib/site/code/rich'
import { evalValue, toText, truthy } from '@/lib/site/code/evaluate'
import { allowedOnPage, codeLibrary, type RenderCtx } from '@/lib/site/code/library'
import type { SiteData } from '@/lib/site/data/types'
import { responsiveImg } from '@/lib/shared/image-url'

// The code-section interpreter: walks the stored AST into React elements. The AST is re-checked here as it is drawn
// (defence in depth): unknown tags and components are skipped, attributes outside the allowlist dropped, links and
// images re-validated, and the total work is capped.

export interface Env {
  vars: Map<string, unknown>
  data: SiteData
  page: PageKey | null
  sectionId: string
  /** The class the section's CSS asks for (codeMark): on every element it styled. */
  mark: string
  lcp: { on: boolean }
  budget: { n: number }
  /** Numbers the async parts' fragments (renderCmp). */
  seq: { n: number }
  depth: number
  /** Data components known to have nothing to show (CodeSection counts them first). */
  empty: Set<unknown>
  /** Category and brand slugs the section links to that the store has; null when not checked. */
  taxonomy: Taxonomy | null
  /** The ids on a one-page site (planSections); links to a section that draws nothing are left out. Null: not checked. */
  anchors: Anchors | null
  /** Rows that show a typed stand-in for a missing business detail (lib/site/code/placeholders.ts). */
  rows: Map<object, CodeValue[]> | null
  /** The editor's canvas (a preview token): elements carry their node id as `data-e`. Never on a live page. */
  preview: boolean
}

export type Taxonomy = { categories: Set<string>; brands: Set<string> }

/** What a one-page site's links may point at: the ids it draws, those in parts that draw nothing, and whether some id is set from data. */
export type Anchors = { ids: Set<string>; gone: Set<string>; open: boolean }

/** Elements drawn per section at most (lists inside lists multiply). */
const BUDGET = 4000

export function makeEnv(opts: {
  data: SiteData
  page?: PageKey | null
  sectionId: string
  priority?: boolean
  empty?: Set<unknown>
  taxonomy?: Taxonomy | null
  anchors?: Anchors | null
  rows?: Map<object, CodeValue[]> | null
  preview?: boolean
}): Env {
  return {
    vars: new Map(),
    data: opts.data,
    page: opts.page ?? null,
    sectionId: opts.sectionId,
    mark: codeMark(opts.sectionId),
    lcp: { on: !!opts.priority },
    budget: { n: BUDGET },
    seq: { n: 0 },
    depth: 0,
    empty: opts.empty ?? new Set(),
    taxonomy: opts.taxonomy ?? null,
    anchors: opts.anchors ?? null,
    rows: opts.rows?.size ? opts.rows : null,
    preview: !!opts.preview,
  }
}

// Parts that dress a section but never carry it: a section of only these plus data components that all come up empty
// (a new store has no products, categories, brands, reviews or offers yet) has nothing to show.
const DECOR = new Set([
  'Image', 'Icon', 'Link', 'Reveal', 'Marquee', 'Carousel', 'Tabs', 'Tab', 'Accordion', 'AccordionItem', 'Countdown', 'Store',
  // The card parts draw a product they are given; they never carry a section on their own.
  'QuickAdd', 'WishlistToggle', 'PriceTag', 'DiscountBadge', 'StockBadge', 'RatingStars',
  // A Showcase's identity and picture, as Store is a store's (a <Business> that tells the business's story carries it).
  'Business', 'BusinessPicture',
])

type CmpNode = Extract<CodeNode, { t: 'cmp' }>

/** A render function that reads `field` of its item. */
function reads(n: CmpNode, field: string): boolean {
  const param = n.render?.param
  const seek = (v: unknown, depth: number): boolean => {
    if (!v || typeof v !== 'object' || depth > 200) return false
    const o = v as { k?: unknown; root?: unknown; path?: unknown }
    if (o.k === 'path' && o.root === param && Array.isArray(o.path) && o.path[0] === field) return true
    return Object.values(v).some(x => seek(x, depth + 1))
  }
  return !!param && seek(n.render!.body, 0)
}

/** A section that introduces the business (reads its name, tagline or profession): an opening when the page has no h1. */
export function introduces(n: unknown, depth = 0): boolean {
  if (!n || typeof n !== 'object' || depth > MAX_DEPTH * 3) return false
  const node = n as CodeNode
  const any = (list: unknown) => Array.isArray(list) && list.some(c => introduces(c, depth + 1))
  switch (node.t) {
    case 'cmp':
      return (node.name === 'Business' && ['name', 'tagline', 'profession'].some(f => reads(node, f))) || any(node.children) || introduces(node.render?.body, depth + 1)
    case 'el':
    case 'frag':
      return any(node.children)
    case 'cond':
      return introduces(node.then, depth + 1) || introduces(node.else, depth + 1)
    case 'each':
      return introduces(node.body, depth + 1)
    default:
      return false
  }
}

/** The data components in a subtree (not those inside another's items), and whether anything else there works on its own. */
export function scanData(n: unknown, out: { data: CmpNode[]; other: boolean } = { data: [], other: false }, depth = 0): { data: CmpNode[]; other: boolean } {
  if (!n || typeof n !== 'object' || depth > MAX_DEPTH * 3) return out
  const node = n as CodeNode
  const all = (list: unknown) => Array.isArray(list) && list.forEach(c => scanData(c, out, depth + 1))
  switch (node.t) {
    case 'cmp': {
      const def = codeLibrary().get(node.name)
      if (def?.count) out.data.push(node)
      else {
        if (!DECOR.has(node.name) || (node.name === 'Business' && reads(node, 'about'))) out.other = true
        all(node.children)
        if (node.render) scanData(node.render.body, out, depth + 1)
      }
      return out
    }
    case 'el':
    case 'frag':
      all(node.children)
      return out
    case 'cond':
      scanData(node.then, out, depth + 1)
      scanData(node.else, out, depth + 1)
      return out
    case 'each':
      scanData(node.body, out, depth + 1)
      return out
    default:
      return out
  }
}

/** True when a subtree shows only store data and all of it is empty. */
export const onlyEmptyData = (children: unknown, empty: Set<unknown>) => {
  const found = { data: [] as CmpNode[], other: false }
  if (Array.isArray(children)) children.forEach(c => scanData(c, found))
  return found.data.length > 0 && !found.other && found.data.every(d => empty.has(d))
}

const ID = /^[A-Za-z][\w-]{0,40}$/

/** The section an in-page link points at ("#services", "/#services"), or null for any other link. */
export function anchorOf(href: unknown): string | null {
  const m = typeof href === 'string' ? /^\/?#([A-Za-z][\w-]{0,40})$/.exec(href.trim()) : null
  return m ? m[1] : null
}

/** A link to a section the page does not draw. #top always lands (it scrolls to the top of any page). */
export function deadAnchor(href: unknown, anchors: Anchors | null): boolean {
  const id = anchors ? anchorOf(href) : null
  if (!id || id.toLowerCase() === 'top' || anchors!.ids.has(id)) return false
  return anchors!.gone.has(id) || !anchors!.open
}

/** An element with its own id over nothing but empty data: on a one-page site it goes, as an empty section does. */
const emptyAnchor = (node: Extract<CodeNode, { t: 'el' }>, empty: Set<unknown>) => {
  const id = node.props?.id
  return !!id && id.k === 'lit' && typeof id.v === 'string' && ID.test(id.v) && onlyEmptyData(node.children, empty)
}

/**
 * The ids a section draws, into `out`: static ids under parts that show (`drawn`) go to ids, those under data with
 * nothing to show to gone; an id set from data opens the page (a link to an id it never names may still land).
 */
export function scanIds(n: unknown, empty: Set<unknown>, out: Anchors, drawn = true, depth = 0): Anchors {
  if (!n || typeof n !== 'object' || depth > MAX_DEPTH * 3) return out
  const node = n as CodeNode
  const all = (list: unknown, on: boolean) => Array.isArray(list) && list.forEach(c => scanIds(c, empty, out, on, depth + 1))
  switch (node.t) {
    case 'el': {
      const on = drawn && !emptyAnchor(node, empty)
      const id = node.props?.id
      if (id && id.k === 'lit' && typeof id.v === 'string' && ID.test(id.v)) (on ? out.ids : out.gone).add(id.v)
      else if (id && on) out.open = true
      all(node.children, on)
      return out
    }
    case 'cmp': {
      const on = drawn && !empty.has(node) && !(node.name === 'Tab' && onlyEmptyData(node.children, empty))
      all(node.children, on)
      if (node.render) scanIds(node.render.body, empty, out, on, depth + 1)
      return out
    }
    case 'frag':
      all(node.children, drawn)
      return out
    case 'cond':
      scanIds(node.then, empty, out, drawn, depth + 1)
      scanIds(node.else, empty, out, drawn, depth + 1)
      return out
    case 'each':
      scanIds(node.body, empty, out, drawn, depth + 1)
      return out
    default:
      return out
  }
}

const missing = (href: unknown, env: Env) => {
  if (deadAnchor(href, env.anchors)) return true
  const t = env.taxonomy && typeof href === 'string' ? taxonomyOf(href) : null
  return !!t && !env.taxonomy![t.kind].has(t.slug)
}

/** A link to a category or brand the store does not have goes to all products instead of an empty page. */
function liveHref(href: string, env: Env): string {
  return missing(href, env) && !anchorOf(href) ? '/products' : href
}

/** Component props with links (a menu, footer columns): items for a missing category, brand or section are left out. */
function liveLinks(v: unknown, env: Env, depth = 0): unknown {
  if ((!env.taxonomy && !env.anchors) || depth > 6 || !v || typeof v !== 'object') return v
  if (Array.isArray(v)) return v.filter(x => !(x && typeof x === 'object' && missing((x as { href?: unknown }).href, env))).map(x => liveLinks(x, env, depth + 1))
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, k === 'href' && typeof x === 'string' ? liveHref(x, env) : liveLinks(x, env, depth + 1)]))
}

/** Awaits a library component that loads data. */
export async function Resolve({ promise }: { promise: Promise<ReactNode> }) {
  return <>{await promise}</>
}

const deeper = (env: Env): Env => ({ ...env, depth: env.depth + 1 })
const marked = (cls: string, env: Env) => (env.mark ? `${cls} ${env.mark}` : cls)
const bind = (env: Env, param: string, value: unknown, index: string | undefined, i: number): Env => {
  const vars = new Map(env.vars)
  vars.set(param, value)
  if (index) vars.set(index, i)
  return { ...env, vars, depth: env.depth + 1 }
}
const kids = (list: unknown, env: Env): ReactNode[] => (Array.isArray(list) ? list.map(c => renderNode(c, deeper(env))) : [])
const isThenable = (v: unknown): v is Promise<ReactNode> => !!v && typeof (v as { then?: unknown }).then === 'function'

// What a link may hold: pictures, icons, text and data read through a render function. Anything else draws its own
// links or controls (Logo, CartIcon, ProductCard, forms), and a link around it would nest <a> in <a>: invalid HTML and
// a hydration error. Such a link is drawn as a plain wrapper instead.
const LINK_SAFE = new Set(['Image', 'HeroPicture', 'BusinessPicture', 'Icon', 'ProductTitle', 'ProductPrice', 'ProductRating', 'Countdown', 'Reveal', 'Marquee', 'PriceTag', 'DiscountBadge', 'StockBadge', 'RatingStars'])
const DATA = new Set([
  'Store', 'Product', 'Products', 'Categories', 'Brands', 'Reviews', 'Offers', 'HeroPicture', 'Business', 'BusinessPicture', 'Services', 'Work', 'Testimonials', 'Stats', 'Faqs',
  // The catalogue pages' records: with a render function they draw only what it returns.
  'Category', 'SubCategories', 'CategoryFaqs', 'SeoText', 'Breadcrumbs', 'Brand', 'SearchQuery', 'AllCategories', 'AllBrands',
])

function holdsLink(n: unknown, depth = 0): boolean {
  if (!n || typeof n !== 'object' || depth > MAX_DEPTH * 3) return false
  const node = n as CodeNode
  const any = (list: unknown) => Array.isArray(list) && list.some(c => holdsLink(c, depth + 1))
  switch (node.t) {
    case 'el':
      return node.tag === 'a' || any(node.children)
    case 'cmp':
      if (DATA.has(node.name) && node.render) return holdsLink(node.render.body, depth + 1) || any(node.children)
      return !LINK_SAFE.has(node.name) || any(node.children)
    case 'cond':
      return holdsLink(node.then, depth + 1) || holdsLink(node.else, depth + 1)
    case 'frag':
      return any(node.children)
    case 'each':
      return holdsLink(node.body, depth + 1)
    default:
      return false
  }
}

const NUMERIC = new Set(['width', 'height', 'colSpan', 'rowSpan', 'start'])
const BOOLEAN = new Set(['hidden', 'open', 'reversed'])

// A typed quote is one no client gave: a Showcase's quotes come only from <Testimonials>, so a quote (or the figure
// holding one) written as text in the code is left out.
const typedOnly = (list: unknown): boolean => Array.isArray(list) && list.length > 0 && list.every(c => c && typeof c === 'object' && ((c as CodeNode).t === 'text' || ((c as CodeNode).t === 'el' && typedOnly((c as { children?: unknown }).children))))
function typedQuote(node: Extract<CodeNode, { t: 'el' }>, depth = 0): boolean {
  if (node.tag === 'blockquote' || node.tag === 'q') return typedOnly(node.children)
  if (depth > 3 || (depth === 0 && node.tag !== 'figure')) return false
  return (node.children ?? []).some(c => c?.t === 'el' && typedQuote(c, depth + 1))
}

function renderEl(node: Extract<CodeNode, { t: 'el' }>, env: Env, key?: Key): ReactNode {
  const tag = node.tag
  if (typeof tag !== 'string' || !HTML_TAGS.has(tag)) return null
  // On a one-page site an anchored block over empty data goes with its links, as an empty section does.
  if (env.anchors && emptyAnchor(node, env.empty)) return null
  if (env.page === 'showcase' && typedQuote(node)) return null
  const props: Record<string, unknown> = key != null ? { key } : {}
  for (const [name, v] of Object.entries(node.props ?? {})) {
    if (name === 'key' || !attrAllowed(tag, name)) continue
    const val = evalValue(v, env.vars)
    if (name === 'href') {
      const u = safeHref(toText(val))
      if (u) props.href = liveHref(u, env)
    } else if (name === 'src') {
      const u = safeSrc(toText(val))
      if (u) props.src = u
    } else if (BOOLEAN.has(name)) props[name] = truthy(val)
    else if (NUMERIC.has(name)) {
      const n = Number(val)
      if (Number.isFinite(n) && n >= 0 && n < 10000) props[name] = n
    } else if (name === 'target') {
      if (val === '_blank' || val === '_self') props.target = val
    } else if (name === 'loading') {
      if (val === 'lazy' || val === 'eager') props.loading = val
    } else if (name === 'id') {
      const s = toText(val)
      if (/^[A-Za-z][\w-]{0,40}$/.test(s)) props.id = s
    } else {
      const s = toText(val)
      if (s) props[name] = s
    }
  }
  // The section's own CSS styles only what carries its mark (lib/site/code/css.ts).
  if (typeof props.className === 'string') props.className = marked(props.className, env)
  // The editor's canvas only: the node id, and `data-e-text` where the words are written out (editable in place).
  if (env.preview && typeof node.id === 'string' && NODE_ID.test(node.id)) {
    props['data-e'] = node.id
    if (!VOID_TAGS.has(tag) && (node.children ?? []).every(c => c.t === 'text')) props['data-e-text'] = ''
    else if (isRichText(node)) props['data-e-rich'] = ''
  }
  if (tag === 'img') {
    if (typeof props.src !== 'string') return null
    return createElement('img', { ...props, ...responsiveImg(props.src, '(min-width: 768px) 50vw, 100vw'), alt: props.alt ?? '', loading: props.loading ?? 'lazy', decoding: 'async' })
  }
  if (VOID_TAGS.has(tag)) return createElement(tag, props)
  if (tag === 'a' && deadAnchor(props.href, env.anchors)) return null
  const children = kids(node.children, env)
  // A list item whose only link was left out goes too.
  if (tag === 'li' && env.anchors && children.length && children.every(c => c == null || c === false || c === '')) return null
  if (tag === 'a') {
    if (Array.isArray(node.children) && node.children.some(c => holdsLink(c))) {
      delete props.href
      delete props.target
      return createElement('span', props, ...children)
    }
    if (props.target === '_blank') props.rel = 'noopener noreferrer'
    if (typeof props.href === 'string' && props.href.startsWith('/')) return createElement(Link, props as { href: string }, ...children)
  }
  return createElement(tag, props, ...children)
}

function renderCmp(node: Extract<CodeNode, { t: 'cmp' }>, env: Env, key?: Key): ReactNode {
  // A <Carousel> holding only a list draws that list as its own carousel (each item a slide): written so, the whole
  // list would be one slide, its grid squeezed into it. The list's className was for that grid, so it is dropped.
  const list = carouselList(node)
  if (list) {
    const { className: _grid, ...own } = list.props ?? {}
    const slides: Record<string, CodeValue> = { ...own, layout: { k: 'lit', v: 'carousel' } }
    if (node.props?.itemClassName) slides.itemClassName = node.props.itemClassName
    const out = renderCmp({ ...list, props: slides }, env, key)
    const wrap = node.props?.className ? toText(evalValue(node.props.className, env.vars)) : ''
    return wrap ? createElement('div', { ...(key != null ? { key } : {}), className: marked(wrap, env) }, out) : out
  }
  const def = typeof node.name === 'string' ? codeLibrary().get(node.name) : undefined
  if (!def || !allowedOnPage(def, env.page) || env.empty.has(node)) return null
  // A tab of only empty store data is left out (Tabs with none left draws nothing).
  if (node.name === 'Tab' && onlyEmptyData(node.children, env.empty)) return null
  const raw: Record<string, unknown> = {}
  let className: string | undefined
  for (const [k, v] of Object.entries(node.props ?? {})) {
    if (FORBIDDEN_KEYS.has(k) || k === 'key') continue
    const val = evalValue(v, env.vars)
    if (k === 'className') {
      const s = toText(val)
      className = s ? marked(s, env) : undefined
    } else raw[k] = k === 'href' && typeof val === 'string' ? liveHref(val, env) : liveLinks(val, env)
  }
  const parsed = def.props.safeParse(raw)
  if (!parsed.success) return null
  // Its class props (itemClassName…) take the mark too, after the length caps, so one near its cap keeps its styles.
  const own: Record<string, unknown> = { ...(parsed.data as Record<string, unknown>) }
  if (env.mark) for (const [k, v] of Object.entries(own)) if (k.endsWith('ClassName') && typeof v === 'string' && v !== '') own[k] = marked(v, env)
  if (def.name === 'Link' && deadAnchor(own.href, env.anchors)) return null
  const children = kids(node.children, env)
  if (def.name === 'Link' && Array.isArray(node.children) && node.children.some(c => holdsLink(c)))
    return createElement('span', { ...(key != null ? { key } : {}), ...(className ? { className } : {}) }, ...children)
  const render = node.render && typeof node.render.param === 'string' ? node.render : null
  const edit = editAttrs(node, env)
  const ctx: RenderCtx = {
    children: children.length ? createElement(Fragment, null, ...children) : null,
    renderItem: render
      ? (value, i = 0) => <Fragment key={i}>{renderNode(render.body, bind(env, render.param, value, render.index, i))}</Fragment>
      : null,
    data: env.data,
    page: env.page,
    sectionId: env.sectionId,
    claimPriority: () => env.lcp.on && !(env.lcp.on = false),
    edit,
  }
  let out: ReactNode | Promise<ReactNode>
  try {
    out = def.render({ ...own, ...(className ? { className } : {}) }, ctx)
  } catch (err) {
    console.error('[code-section]', def.name, err)
    return null
  }
  if (isThenable(out)) {
    const safe = out.then(
      r => r,
      err => (console.error('[code-section]', def.name, err), null)
    )
    // In a keyed fragment, which the payload keeps: a part's chunk can reach the browser after hydration has started,
    // and React (19.2 canary) replays an element that suspends on it without rewinding its hydration cursor, so it
    // claims its own first child and hydration fails. The fragment is what suspends and replays instead.
    return (
      <Fragment key={key ?? `async-${env.seq.n++}`}>
        <Resolve promise={safe} />
      </Fragment>
    )
  }
  // A part drawn as one plain element carries the node id itself; Link, Image and Icon take ctx.edit.
  if (edit && isValidElement<Record<string, unknown>>(out) && typeof out.type === 'string' && !out.props['data-e']) out = cloneElement(out, edit)
  return key != null ? <Fragment key={key}>{out}</Fragment> : out
}

/** The editor's canvas only: a part's node id, and whether its words are written out (editable in place). */
function editAttrs(node: Extract<CodeNode, { t: 'cmp' }>, env: Env): Record<string, string> | null {
  if (!env.preview || typeof node.id !== 'string' || !NODE_ID.test(node.id)) return null
  const text = !node.render && Array.isArray(node.children) && node.children.length > 0 && node.children.every(c => c.t === 'text')
  return { 'data-e': node.id, 'data-e-cmp': '', ...(text ? { 'data-e-text': '' } : {}) }
}

export function renderNode(n: unknown, env: Env, key?: Key): ReactNode {
  if (!n || typeof n !== 'object' || env.depth > MAX_DEPTH * 3 || env.budget.n-- <= 0) return null
  const node = n as CodeNode
  // A row holding a typed stand-in for a detail the business did not give is left out.
  const facts = env.rows?.get(node)
  if (facts && facts.some(f => !truthy(evalValue(f, env.vars)))) return null
  switch (node.t) {
    case 'text':
      return typeof node.value === 'string' ? node.value : null
    case 'expr':
      return toText(evalValue(node.value, env.vars)) || null
    case 'cond':
      return truthy(evalValue(node.test, env.vars)) ? renderNode(node.then, env, key) : node.else ? renderNode(node.else, env, key) : null
    case 'frag':
      return createElement(Fragment, key != null ? { key } : null, ...kids(node.children, env))
    case 'each': {
      const items = evalValue(node.items, env.vars)
      if (!Array.isArray(items) || typeof node.param !== 'string') return null
      return items.slice(0, MAX_EACH).map((item, i) => <Fragment key={i}>{renderNode(node.body, bind(env, node.param, item, node.index, i))}</Fragment>)
    }
    case 'el':
      return renderEl(node, env, key)
    case 'cmp':
      return renderCmp(node, env, key)
    default:
      return null
  }
}
