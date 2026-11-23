import type { PageKey } from '@jeffi/site-blocks'
import { FORBIDDEN_KEYS, inertCss, taxonomyOf } from '@/lib/site/code/allow'
import { CARD_PAGE, type CodeNode } from '@/lib/site/code/ast'
import type { CompiledSection } from '@/lib/site/code/compile'
import { currentCss } from '@/lib/site/code/css'
import { evalValue } from '@/lib/site/code/evaluate'
import { codeLibrary } from '@/lib/site/code/library'
import { siteData, type SiteData } from '@/lib/site/data'
import { placeholderRows } from '@/lib/site/code/placeholders'
import { introduces, makeEnv, renderNode, scanData, scanIds, type Anchors, type Taxonomy } from './interpret'
import { CardSamples } from './common/SiteCard'

/** One answer per distinct call while the section renders, so counting the data first costs no extra queries. */
function once(src: SiteData): SiteData {
  const seen = new Map<string, Promise<unknown>>()
  const memo =
    <A extends unknown[], R>(name: string, fn: (...a: A) => Promise<R>) =>
    (...a: A): Promise<R> => {
      const key = name + JSON.stringify(a)
      let hit = seen.get(key) as Promise<R> | undefined
      if (!hit) seen.set(key, (hit = fn(...a)))
      return hit
    }
  return {
    ...src,
    products: memo('products', q => src.products(q)),
    product: memo('product', slug => src.product(slug)),
    categories: memo('categories', q => src.categories(q)),
    brands: memo('brands', q => src.brands(q)),
    reviews: memo('reviews', q => src.reviews(q)),
    offers: memo('offers', q => src.offers(q)),
    store: memo('store', () => src.store()),
  }
}

type CmpNode = Extract<CodeNode, { t: 'cmp' }>

/** How many items a data component would show; on any doubt, "some", so a section is never hidden by mistake. */
async function countOf(node: CmpNode, data: SiteData): Promise<number> {
  const def = codeLibrary().get(node.name)
  if (!def?.count) return 1
  const raw: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(node.props ?? {})) if (!FORBIDDEN_KEYS.has(k) && k !== 'key' && k !== 'className') raw[k] = evalValue(v, new Map())
  const parsed = def.props.safeParse(raw)
  if (!parsed.success) return 0
  return def.count(parsed.data as Record<string, unknown>, data).catch(() => 1)
}

type Found = ReturnType<typeof scanData>

/** The data components a section's tree holds that have nothing to show. */
async function emptyData(found: Found, data: SiteData): Promise<Set<unknown>> {
  const counts = await Promise.all(found.data.map(n => countOf(n, data)))
  return new Set<unknown>(found.data.filter((_, i) => counts[i] === 0))
}

/** A section of only store data that is all empty draws nothing. */
const hides = (found: Found, empty: Set<unknown>) => found.data.length > 0 && !found.other && empty.size === found.data.length

function hasTag(n: unknown, tag: string, depth = 0): boolean {
  if (!n || typeof n !== 'object' || depth > 200) return false
  const node = n as CodeNode
  if (node.t === 'el') return node.tag === tag || (node.children ?? []).some(c => hasTag(c, tag, depth + 1))
  if (node.t === 'cmp') return (node.children ?? []).some(c => hasTag(c, tag, depth + 1)) || hasTag(node.render?.body, tag, depth + 1)
  if (node.t === 'frag') return (node.children ?? []).some(c => hasTag(c, tag, depth + 1))
  if (node.t === 'cond') return hasTag(node.then, tag, depth + 1) || hasTag(node.else, tag, depth + 1)
  if (node.t === 'each') return hasTag(node.body, tag, depth + 1)
  return false
}

/**
 * A one-page site's sections, planned together before they draw: the header (the first) and the opening always draw,
 * even when their data is empty, so a page never loses them; and the ids the page will have, so links to a section
 * that draws nothing (or to an id no section has) are left out.
 */
export async function planSections(sections: (CompiledSection | null | undefined)[], data: SiteData): Promise<{ always: boolean[]; anchors: Anchors }> {
  const src = once(data)
  // The opening: the first section after the header (which always draws) that holds the page's h1, else the one
  // right after the header when it introduces the business.
  const h1 = sections.findIndex((s, i) => i > 0 && !!s?.ast && hasTag(s.ast, 'h1'))
  const opening = h1 >= 0 ? h1 : sections[1]?.ast && introduces(sections[1].ast) ? 1 : -1
  const always = sections.map((_, i) => i === 0 || i === opening)
  const anchors: Anchors = { ids: new Set(), gone: new Set(), open: false }
  const plans = await Promise.all(
    sections.map(async (s, i) => {
      if (!s || typeof s !== 'object' || !s.ast || typeof s.ast !== 'object') return null
      const found = scanData(s.ast)
      const empty = await emptyData(found, src)
      return { ast: s.ast, empty, shows: always[i] || !hides(found, empty) }
    })
  )
  for (const p of plans) if (p) scanIds(p.ast, p.empty, anchors, p.shows)
  return { always, anchors }
}

/** Every link in a prop value: a plain string, or `href` fields in objects and lists (menus, footer columns). */
function hrefsIn(v: unknown, add: (href: string) => void, depth = 0): void {
  if (typeof v === 'string') return v.startsWith('/') ? add(v) : undefined
  if (!v || typeof v !== 'object' || depth > 6) return
  for (const x of Array.isArray(v) ? v : Object.values(v)) hrefsIn(x, add, depth + 1)
}

/** The category and brand slugs the section links to, checked against the store. */
async function taxonomyFor(ast: unknown, data: SiteData): Promise<Taxonomy | null> {
  const wanted = { categories: new Set<string>(), brands: new Set<string>() }
  const add = (href: string) => {
    const t = taxonomyOf(href)
    if (t) wanted[t.kind].add(t.slug)
  }
  const walk = (n: unknown, depth = 0) => {
    if (!n || typeof n !== 'object' || depth > 200) return
    const node = n as CodeNode
    if (node.t === 'el' || node.t === 'cmp') for (const v of Object.values(node.props ?? {})) hrefsIn(evalValue(v, new Map()), add)
    if (node.t === 'el' || node.t === 'cmp' || node.t === 'frag') node.children?.forEach(c => walk(c, depth + 1))
    if (node.t === 'cmp' && node.render) walk(node.render.body, depth + 1)
    if (node.t === 'cond') (walk(node.then, depth + 1), walk(node.else, depth + 1))
    if (node.t === 'each') walk(node.body, depth + 1)
  }
  walk(ast)
  if (!wanted.categories.size && !wanted.brands.size) return null
  const [cats, brands] = await Promise.all([
    wanted.categories.size ? data.categories({ slugs: [...wanted.categories], limit: wanted.categories.size }).catch(() => null) : [],
    wanted.brands.size ? data.brands({ slugs: [...wanted.brands], limit: wanted.brands.size }).catch(() => null) : [],
  ])
  // A failed lookup leaves the links alone rather than sending every one to the listing.
  if (!cats || !brands) return null
  return { categories: new Set(cats.map(c => c.slug.toLowerCase())), brands: new Set(brands.map(b => b.slug.toLowerCase())) }
}

/**
 * A code section on the page: the compiled AST drawn by the interpreter, with the section's scoped CSS. `data`
 * overrides the catalogue (the studio preview passes its sample catalogue); `priority` marks the page's LCP section;
 * `id` (the block id) becomes the wrapper's DOM id. The CSS scope is always the compiled section's own id.
 *
 * Written once, shown on a store whose catalogue keeps changing: a section of only store data that is all empty
 * (a new store) draws nothing, unless `always` (the page's first block, the Site Builder editor); tabs of only empty data are left out; links to a category or
 * brand the store does not have go to all products.
 */
export default async function CodeSection({
  section,
  id: blockId,
  page = null,
  data,
  priority = false,
  always = false,
  anchors = null,
  preview = false,
}: {
  section: CompiledSection | null | undefined
  id?: string
  page?: PageKey | null
  data?: SiteData
  priority?: boolean
  always?: boolean
  /** A one-page site's ids (planSections): links to a section the page does not draw are left out. */
  anchors?: Anchors | null
  /** The editor's canvas, with a preview token: elements carry `data-e` node ids. */
  preview?: boolean
}) {
  const s = section as Partial<CompiledSection> | null | undefined
  if (!s || typeof s !== 'object' || !s.ast || typeof s.ast !== 'object') return null
  const id = typeof s.id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(s.id) ? s.id : 'cs'
  const src = once(data ?? siteData())
  // The card page holds the site's product card: shown drawn for a few products.
  if (page === CARD_PAGE)
    return (
      <div id={blockId && /^[A-Za-z0-9_-]{1,64}$/.test(blockId) ? blockId : undefined}>
        <CardSamples card={{ id, ast: s.ast, css: currentCss(s.css, id) }} data={src} />
      </div>
    )
  const found = scanData(s.ast)
  const [empty, taxonomy] = await Promise.all([emptyData(found, src), taxonomyFor(s.ast, src)])
  if (!always && hides(found, empty)) return null
  // CSS saved in an earlier format gets this section's mark here, once per process.
  const css = inertCss(currentCss(s.css, id))
  const rows = page === 'showcase' ? placeholderRows(s.ast) : null
  const env = makeEnv({ data: src, page, sectionId: id, priority, empty, taxonomy, anchors, rows, preview })
  return (
    <div data-code-section={id} id={blockId && /^[A-Za-z0-9_-]{1,64}$/.test(blockId) ? blockId : undefined}>
      {css && <style dangerouslySetInnerHTML={{ __html: css }} />}
      {renderNode(s.ast, env)}
    </div>
  )
}
