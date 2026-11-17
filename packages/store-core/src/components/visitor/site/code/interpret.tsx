import { Fragment, createElement, type Key, type ReactNode } from 'react'
import Link from 'next/link'
import type { PageKey } from '@jeffi/site-blocks'
import type { CodeNode } from '@/lib/site/code/ast'
import { FORBIDDEN_KEYS, HTML_TAGS, MAX_DEPTH, MAX_EACH, VOID_TAGS, attrAllowed, safeHref, safeSrc, taxonomyOf } from '@/lib/site/code/allow'
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
  lcp: { on: boolean }
  budget: { n: number }
  depth: number
  /** Data components known to have nothing to show (CodeSection counts them first). */
  empty: Set<unknown>
  /** Category and brand slugs the section links to that the store has; null when not checked. */
  taxonomy: Taxonomy | null
}

export type Taxonomy = { categories: Set<string>; brands: Set<string> }

/** Elements drawn per section at most (lists inside lists multiply). */
const BUDGET = 4000

export function makeEnv(opts: { data: SiteData; page?: PageKey | null; sectionId: string; priority?: boolean; empty?: Set<unknown>; taxonomy?: Taxonomy | null }): Env {
  return {
    vars: new Map(),
    data: opts.data,
    page: opts.page ?? null,
    sectionId: opts.sectionId,
    lcp: { on: !!opts.priority },
    budget: { n: BUDGET },
    depth: 0,
    empty: opts.empty ?? new Set(),
    taxonomy: opts.taxonomy ?? null,
  }
}

// Parts that dress a section but never carry it: a section of only these plus data components that all come up empty
// (a new store has no products, categories, brands, reviews or offers yet) has nothing to show.
const DECOR = new Set([
  'Image', 'Icon', 'Link', 'Reveal', 'Marquee', 'Carousel', 'Tabs', 'Tab', 'Accordion', 'AccordionItem', 'Countdown', 'Store',
  // The card parts draw a product they are given; they never carry a section on their own.
  'QuickAdd', 'WishlistToggle', 'PriceTag', 'DiscountBadge', 'StockBadge', 'RatingStars',
  // A Showcase's identity, as Store is a store's.
  'Business',
])

type CmpNode = Extract<CodeNode, { t: 'cmp' }>

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
        if (!DECOR.has(node.name)) out.other = true
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

const missing = (href: unknown, env: Env) => {
  const t = env.taxonomy && typeof href === 'string' ? taxonomyOf(href) : null
  return !!t && !env.taxonomy![t.kind].has(t.slug)
}

/** A link to a category or brand the store does not have goes to all products instead of an empty page. */
function liveHref(href: string, env: Env): string {
  return missing(href, env) ? '/products' : href
}

/** Component props with links (a menu, footer columns): items for a missing category or brand are left out. */
function liveLinks(v: unknown, env: Env, depth = 0): unknown {
  if (!env.taxonomy || depth > 6 || !v || typeof v !== 'object') return v
  if (Array.isArray(v)) return v.filter(x => !(x && typeof x === 'object' && missing((x as { href?: unknown }).href, env))).map(x => liveLinks(x, env, depth + 1))
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, k === 'href' && typeof x === 'string' ? liveHref(x, env) : liveLinks(x, env, depth + 1)]))
}

/** Awaits a library component that loads data. */
export async function Resolve({ promise }: { promise: Promise<ReactNode> }) {
  return <>{await promise}</>
}

const deeper = (env: Env): Env => ({ ...env, depth: env.depth + 1 })
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
const LINK_SAFE = new Set(['Image', 'Icon', 'ProductTitle', 'ProductPrice', 'ProductRating', 'Countdown', 'Reveal', 'Marquee', 'PriceTag', 'DiscountBadge', 'StockBadge', 'RatingStars'])
const DATA = new Set([
  'Store', 'Product', 'Products', 'Categories', 'Brands', 'Reviews', 'Offers', 'Business', 'Services', 'Work', 'Testimonials', 'Stats', 'Faqs',
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

function renderEl(node: Extract<CodeNode, { t: 'el' }>, env: Env, key?: Key): ReactNode {
  const tag = node.tag
  if (typeof tag !== 'string' || !HTML_TAGS.has(tag)) return null
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
  if (tag === 'img') {
    if (typeof props.src !== 'string') return null
    return createElement('img', { ...props, ...responsiveImg(props.src, '(min-width: 768px) 50vw, 100vw'), alt: props.alt ?? '', loading: props.loading ?? 'lazy', decoding: 'async' })
  }
  if (VOID_TAGS.has(tag)) return createElement(tag, props)
  const children = kids(node.children, env)
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
  const def = typeof node.name === 'string' ? codeLibrary().get(node.name) : undefined
  if (!def || !allowedOnPage(def, env.page) || env.empty.has(node)) return null
  // A tab of only empty store data is left out (Tabs with none left draws nothing).
  if (node.name === 'Tab' && onlyEmptyData(node.children, env.empty)) return null
  const raw: Record<string, unknown> = {}
  let className: string | undefined
  for (const [k, v] of Object.entries(node.props ?? {})) {
    if (FORBIDDEN_KEYS.has(k) || k === 'key') continue
    const val = evalValue(v, env.vars)
    if (k === 'className') className = toText(val) || undefined
    else raw[k] = k === 'href' && typeof val === 'string' ? liveHref(val, env) : liveLinks(val, env)
  }
  const parsed = def.props.safeParse(raw)
  if (!parsed.success) return null
  const children = kids(node.children, env)
  if (def.name === 'Link' && Array.isArray(node.children) && node.children.some(c => holdsLink(c)))
    return createElement('span', { ...(key != null ? { key } : {}), ...(className ? { className } : {}) }, ...children)
  const render = node.render && typeof node.render.param === 'string' ? node.render : null
  const ctx: RenderCtx = {
    children: children.length ? createElement(Fragment, null, ...children) : null,
    renderItem: render
      ? (value, i = 0) => <Fragment key={i}>{renderNode(render.body, bind(env, render.param, value, render.index, i))}</Fragment>
      : null,
    data: env.data,
    page: env.page,
    sectionId: env.sectionId,
    claimPriority: () => env.lcp.on && !(env.lcp.on = false),
  }
  let out: ReactNode | Promise<ReactNode>
  try {
    out = def.render({ ...(parsed.data as Record<string, unknown>), ...(className ? { className } : {}) }, ctx)
  } catch (err) {
    console.error('[code-section]', def.name, err)
    return null
  }
  if (isThenable(out)) {
    const safe = out.then(
      r => r,
      err => (console.error('[code-section]', def.name, err), null)
    )
    return <Resolve key={key} promise={safe} />
  }
  return key != null ? <Fragment key={key}>{out}</Fragment> : out
}

export function renderNode(n: unknown, env: Env, key?: Key): ReactNode {
  if (!n || typeof n !== 'object' || env.depth > MAX_DEPTH * 3 || env.budget.n-- <= 0) return null
  const node = n as CodeNode
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
