import { z } from 'zod'

// The `composed` block: a block the AI (or the owner) builds from safe primitives. Its settings are a tree of nodes:
// layout, content, store-data and a few effects. There is no HTML, CSS or script: styling is theme tones and a short
// list of options, so a composed block stays on brand, can't inject anything and is responsive by construction.
// Data nodes store a query, not results, so they stay live as the catalogue changes. Pure: safe for the client.

export const MAX_DEPTH = 6
export const MAX_NODES = 150

const TONES = ['default', 'muted', 'brand', 'accent', 'dark'] as const
const SPACES = ['none', 'xs', 'sm', 'md', 'lg', 'xl'] as const
const ALIGNS = ['left', 'center', 'right'] as const
export const ASPECTS = ['auto', '1:1', '4:5', '3:4', '4:3', '16:9', '21:9', '3:1'] as const
export const ICONS = ['truck', 'shield', 'star', 'heart', 'gift', 'tag', 'sparkles', 'leaf', 'award', 'clock', 'phone', 'map-pin', 'check', 'percent', 'package', 'refresh'] as const

const text = (max: number) => z.string().trim().min(1).max(max)
const href = z
  .string()
  .trim()
  .max(500)
  .refine(u => /^(https:\/\/|\/(?![/\\]))/i.test(u), 'Links start with / or https://')
// Pictures are uploaded media (https); a made-up path would only show a broken image.
const src = z
  .string()
  .trim()
  .max(2000)
  .refine(u => /^https:\/\/[^\s]+$/i.test(u), 'Images are https:// URLs')
const slug = z.string().trim().min(1).max(120).regex(/^[a-z0-9][a-z0-9-]*$/i)
const aspect = z.object({ web: z.enum(ASPECTS).optional(), web_mobile: z.enum(ASPECTS).optional() }).partial()
const cols = z.object({ web: z.number().int().min(1).max(6).default(4), web_mobile: z.number().int().min(1).max(3).default(2) })
const layout = z.enum(['grid', 'carousel']).default('grid')

export const ProductQuery = z.object({
  category: slug.optional(),
  brand: slug.optional(),
  search: z.string().trim().min(2).max(60).optional(),
  slugs: z.array(slug).max(24).optional(),
  minPrice: z.number().min(0).max(10_000_000).optional(),
  maxPrice: z.number().min(0).max(10_000_000).optional(),
  onSale: z.boolean().optional(),
  inStock: z.boolean().optional(),
  featured: z.boolean().optional(),
  sort: z.enum(['featured', 'new', 'best_sellers', 'price_asc', 'price_desc', 'discount']).default('new'),
  limit: z.number().int().min(1).max(24).default(8),
})
export type ProductQuery = z.infer<typeof ProductQuery>

// Each node's own settings; `children` is handled by the walker so a bad child is dropped, not the whole tree.
const NODE_SCHEMAS = {
  section: z.object({ tone: z.enum(TONES).default('default'), padding: z.enum(SPACES).default('lg'), width: z.enum(['narrow', 'normal', 'full']).default('normal'), fx: z.enum(['none', 'fade']).default('none') }),
  grid: z.object({ cols: cols.default({ web: 3, web_mobile: 1 }), gap: z.enum(SPACES).default('md') }),
  stack: z.object({ gap: z.enum(SPACES).default('sm'), align: z.enum(ALIGNS).default('left') }),
  columns: z.object({ ratio: z.enum(['1:1', '1:2', '2:1', '1:3', '3:1']).default('1:1'), gap: z.enum(SPACES).default('lg'), valign: z.enum(['top', 'center']).default('center') }),
  carousel: z.object({}),
  heading: z.object({ text: text(200), level: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(2), align: z.enum(ALIGNS).default('left'), tone: z.enum(TONES).default('default') }),
  text: z.object({ text: text(2000), align: z.enum(ALIGNS).default('left'), size: z.enum(['sm', 'md', 'lg']).default('md'), tone: z.enum(TONES).default('muted') }),
  image: z.object({ src, hoverSrc: src.optional(), alt: z.string().trim().max(200).default(''), aspect: aspect.default({ web: '4:3', web_mobile: '4:3' }), radius: z.enum(['none', 'sm', 'md', 'lg', 'full']).default('md'), href: href.optional() }),
  button: z.object({ label: text(60), href, variant: z.enum(['solid', 'outline', 'link']).default('solid') }),
  badge: z.object({ text: text(40), tone: z.enum(TONES).default('accent') }),
  icon: z.object({ name: z.enum(ICONS), size: z.enum(['sm', 'md', 'lg']).default('md'), tone: z.enum(TONES).default('brand') }),
  spacer: z.object({ size: z.enum(SPACES).default('md') }),
  divider: z.object({}),
  products: z.object({ query: ProductQuery, layout, cols: cols.default({ web: 4, web_mobile: 2 }), aspect: aspect.optional() }),
  categories: z.object({
    query: z.object({ parent: slug.nullish(), slugs: z.array(slug).max(24).optional(), limit: z.number().int().min(1).max(24).default(8) }),
    layout,
    cols: cols.default({ web: 4, web_mobile: 2 }),
    aspect: aspect.default({ web: '1:1', web_mobile: '1:1' }),
  }),
  brands: z.object({ query: z.object({ slugs: z.array(slug).max(24).optional(), featured: z.boolean().optional(), limit: z.number().int().min(1).max(24).default(8) }), layout }),
  review: z.object({ query: z.object({ productSlug: slug.optional(), minRating: z.number().int().min(1).max(5).default(4), limit: z.number().int().min(1).max(6).default(3) }), layout }),
  offers: z.object({ query: z.object({ limit: z.number().int().min(1).max(8).default(3) }), layout }),
  countdown: z.object({ endsAt: z.string().refine(s => Number.isFinite(Date.parse(s)), 'A date and time'), label: z.string().trim().max(80).default('Ends in'), align: z.enum(ALIGNS).default('center') }),
  marquee: z.object({ items: z.array(text(80)).min(1).max(12), tone: z.enum(TONES).default('brand'), speed: z.enum(['slow', 'normal', 'fast']).default('normal') }),
} as const

export type NodeKind = keyof typeof NODE_SCHEMAS
export const NODE_KINDS = Object.keys(NODE_SCHEMAS) as NodeKind[]
export const CONTAINER_KINDS: NodeKind[] = ['section', 'grid', 'stack', 'columns', 'carousel']
export const DATA_KINDS: NodeKind[] = ['products', 'categories', 'brands', 'review', 'offers']

type Inferred<K extends NodeKind> = z.infer<(typeof NODE_SCHEMAS)[K]>
// An empty schema infers Record<string, never>, which would forbid `children`.
type Props<K extends NodeKind> = string extends keyof Inferred<K> ? object : Inferred<K>
export type ComposedNode = { [K in NodeKind]: { kind: K; children?: ComposedNode[] } & Props<K> }[NodeKind]
export type NodeOf<K extends NodeKind> = Extract<ComposedNode, { kind: K }>

export interface CleanResult {
  tree: ComposedNode | null
  issues: string[]
  nodes: number
}

/** A tree made safe: unknown kinds and invalid nodes dropped, caps applied, a single root section ensured. */
export function cleanTree(input: unknown): CleanResult {
  const issues: string[] = []
  let count = 0
  const walk = (raw: unknown, depth: number, path: string): ComposedNode | null => {
    if (!raw || typeof raw !== 'object') return null
    // Models sometimes nest a node's settings ({"kind", "settings": {...}}) or say "type"; both are accepted.
    const { kind: k, type, children, settings, props, ...own } = raw as Record<string, unknown>
    const kind = k ?? type
    const obj = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? (v as object) : {})
    const rest: Record<string, unknown> = { ...obj(settings), ...obj(props), ...own }
    // Other common slips: text given as children strings, an aspect or column count given as one value.
    const words = Array.isArray(children) ? children.filter((c): c is string => typeof c === 'string') : []
    if (words.length && (kind === 'heading' || kind === 'text' || kind === 'badge') && typeof rest.text !== 'string') rest.text = words.join(kind === 'text' ? '\n\n' : ' ')
    if (words.length && kind === 'button' && typeof rest.label !== 'string') rest.label = words.join(' ')
    if (words.length && kind === 'marquee' && !Array.isArray(rest.items)) rest.items = words
    if (typeof rest.aspect === 'string') rest.aspect = { web: rest.aspect, web_mobile: rest.aspect }
    if (typeof rest.cols === 'number') rest.cols = { web: rest.cols, web_mobile: Math.min(2, rest.cols) }
    if (typeof kind !== 'string' || !(kind in NODE_SCHEMAS)) {
      issues.push(`${path}: unknown kind ${String(kind)}`)
      return null
    }
    if (depth > MAX_DEPTH) {
      issues.push(`${path}: nested too deep`)
      return null
    }
    if (count >= MAX_NODES) {
      issues.push(`${path}: too many nodes`)
      return null
    }
    const parsed = NODE_SCHEMAS[kind as NodeKind].safeParse(rest)
    if (!parsed.success) {
      issues.push(`${path} (${kind}): ${parsed.error.issues[0]?.message ?? 'invalid'}`)
      return null
    }
    count++
    const node = { kind, ...(parsed.data as object) } as ComposedNode
    if (CONTAINER_KINDS.includes(kind as NodeKind)) {
      const list = Array.isArray(children) ? children : []
      const kids = list.map((c, i) => walk(c, depth + 1, `${path}.${i}`)).filter((c): c is ComposedNode => !!c)
      node.children = kind === 'columns' ? kids.slice(0, 2) : kids
      if (!node.children.length) return null
    }
    return node
  }
  let tree = walk(input, 1, 'root')
  if (tree && tree.kind !== 'section') tree = { kind: 'section', tone: 'default', padding: 'lg', width: 'normal', fx: 'none', children: [tree] }
  return { tree, issues, nodes: count }
}

/** Every node with its path ("0.2.1"), depth first. */
export function walkTree(tree: ComposedNode | null, visit: (node: ComposedNode, path: string) => void, path = '0') {
  if (!tree) return
  visit(tree, path)
  tree.children?.forEach((c, i) => walkTree(c, visit, `${path}.${i}`))
}

/** A copy of the tree with the node at `path` replaced by `patch(node)`. */
export function updateNode(tree: ComposedNode, path: string, patch: (n: ComposedNode) => ComposedNode): ComposedNode {
  const [, ...rest] = path.split('.').map(Number)
  const go = (n: ComposedNode, idx: number[]): ComposedNode =>
    idx.length === 0 ? patch(n) : { ...n, children: n.children?.map((c, i) => (i === idx[0] ? go(c, idx.slice(1)) : c)) }
  return go(tree, rest)
}

/** The grammar the AI writes in, compact, generated from the schemas' defaults. */
export const COMPOSED_GRAMMAR = `A block is one JSON tree of nodes {"kind": ..., ...settings, "children": [...]} (children only on layout nodes).
Layout: section {tone: default|muted|brand|accent|dark, padding: none|xs|sm|md|lg|xl, width: narrow|normal|full, fx: none|fade} (the root),
  grid {cols: {web: 1-6, web_mobile: 1-3}, gap}, stack {gap, align: left|center|right}, columns {ratio: 1:1|1:2|2:1|1:3|3:1, valign: top|center} (exactly 2 children; stacks on phones), carousel {}.
Content: heading {text, level: 1|2|3, align, tone}, text {text, align, size: sm|md|lg, tone}, image {src (an https URL from the tools), hoverSrc?, alt, aspect: {web, web_mobile} from ${ASPECTS.join('|')}, radius: none|sm|md|lg|full, href?},
  button {label, href (/path or https), variant: solid|outline|link}, badge {text, tone}, icon {name: ${ICONS.join('|')}, size: sm|md|lg, tone}, spacer {size}, divider {}.
Store data (live; store the query, never product lists): products {query: {category?: slug, brand?: slug, search?, slugs?: [slug], minPrice?, maxPrice?, onSale?, inStock?, featured?, sort: featured|new|best_sellers|price_asc|price_desc|discount, limit: 1-24}, layout: grid|carousel, cols, aspect?},
  categories {query: {parent?: slug, slugs?, limit}, layout, cols, aspect}, brands {query: {slugs?, featured?, limit}, layout}, review {query: {productSlug?, minRating: 1-5, limit: 1-6}, layout}, offers {query: {limit: 1-8}, layout}.
Effects: countdown {endsAt: ISO date-time, label, align}, marquee {items: [short text], tone, speed: slow|normal|fast}, image hoverSrc (hover swap), section fx fade.
At most ${MAX_DEPTH} levels and ${MAX_NODES} nodes. Phones get their own column counts and aspects.`
