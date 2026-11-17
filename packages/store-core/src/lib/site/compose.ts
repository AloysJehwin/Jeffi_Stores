import { aiChat, type AiChatMessage, type AiToolDef } from '@/lib/shared/ai-client'
import { parseAiJson } from '@/lib/auth/ai-scope'
import { storeDescriptorForPrompt } from '@/lib/catalog/brand'
import { COMPOSED_GRAMMAR, DATA_KINDS, cleanTree, walkTree, type ComposedNode } from './composed'
import { DATA_TOOLS, loadComposedData, type DataToolName } from './composed-data'
import { SiteAiError } from './ai'

// "Make a new block": the AI looks the store up with read-only tools, then writes a tree of safe primitives. The tree
// is cleaned (unknown or invalid nodes dropped, caps applied); data nodes that find nothing get one repair round.

const obj = (properties: Record<string, unknown> = {}, required: string[] = []) => ({ type: 'object', properties, required })
const TOOLS: AiToolDef[] = [
  { type: 'function', function: { name: 'list_categories', description: 'The store categories: slug, name, parent slug and how many products each has.', parameters: obj() } },
  { type: 'function', function: { name: 'list_brands', description: 'The store brands: slug, name, featured, product count.', parameters: obj() } },
  {
    type: 'function',
    function: {
      name: 'search_products',
      description: 'Find products with the same query a products node uses. Returns slug, name, price, mrp, category slug, brand and image count.',
      parameters: obj({
        category: { type: 'string', description: 'category slug (includes its sub-categories)' },
        brand: { type: 'string', description: 'brand slug' },
        search: { type: 'string' },
        slugs: { type: 'array', items: { type: 'string' } },
        minPrice: { type: 'number' },
        maxPrice: { type: 'number' },
        onSale: { type: 'boolean' },
        inStock: { type: 'boolean' },
        featured: { type: 'boolean' },
        sort: { type: 'string', enum: ['featured', 'new', 'best_sellers', 'price_asc', 'price_desc', 'discount'] },
        limit: { type: 'number' },
      }),
    },
  },
  { type: 'function', function: { name: 'get_product', description: 'One product by slug, with its description and up to 3 image URLs.', parameters: obj({ slug: { type: 'string' } }, ['slug']) } },
  { type: 'function', function: { name: 'list_offers', description: 'Live offers: slug, title, subtitle, end date.', parameters: obj() } },
  { type: 'function', function: { name: 'top_reviews', description: 'The best approved customer reviews: product slug, rating, excerpt.', parameters: obj({ limit: { type: 'number' } }) } },
  { type: 'function', function: { name: 'store_stats', description: 'Counts of products, products on sale, categories, brands and reviews, and the price range.', parameters: obj() } },
]

const MAX_TOOL_ROUNDS = 4
const MAX_LOOKUPS = 12

async function runTool(name: string, args: unknown): Promise<string> {
  const tool = DATA_TOOLS[name as DataToolName] as ((a: unknown) => Promise<unknown>) | undefined
  if (!tool) return JSON.stringify({ error: `No tool ${name}` })
  try {
    return JSON.stringify(await tool(args)).slice(0, 6000)
  } catch (err) {
    return JSON.stringify({ error: (err as Error).message.slice(0, 200) })
  }
}

type Out = { label?: unknown; summary?: unknown; tree?: unknown }

async function converse(messages: AiChatMessage[]): Promise<Out | null> {
  // Each distinct lookup runs once; repeats get a short pointer back (some models fire the same call many times).
  const seen = new Map<string, string>()
  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const r = await aiChat({ feature: 'site_builder', modelHint: 'agent', maxTokens: 4000, temperature: 0.4, noCache: true, messages, tools: round < MAX_TOOL_ROUNDS ? TOOLS : undefined })
    if (!r.toolCalls?.length) {
      const out = parseAiJson<Out>(r.content)
      if (out?.tree) return out
      messages.push({ role: 'assistant', content: r.content || '' }, { role: 'user', content: 'Reply with the JSON only: {"label", "summary", "tree"}.' })
      continue
    }
    const calls = r.toolCalls.map((tc, i) => ({ ...tc, id: tc.id || `call_${round}_${i}` }))
    messages.push({ role: 'assistant', content: r.content || '', tool_calls: calls.map(tc => ({ id: tc.id, function: { name: tc.name, arguments: tc.arguments } })), providerState: r.providerState })
    for (const tc of calls) {
      const key = `${tc.name}:${JSON.stringify(tc.arguments ?? {})}`
      let content: string
      if (seen.has(key)) content = JSON.stringify({ note: 'Same lookup as before; use that result.' })
      else if (seen.size >= MAX_LOOKUPS) content = JSON.stringify({ error: 'Enough lookups; write the block with what you have.' })
      else seen.set(key, (content = await runTool(tc.name, tc.arguments)))
      messages.push({ role: 'tool', tool_call_id: tc.id, content })
    }
  }
  return null
}

/** Paths of data nodes that found nothing in the store. */
async function emptyDataNodes(tree: ComposedNode): Promise<string[]> {
  const data = await loadComposedData(tree)
  const empty: string[] = []
  walkTree(tree, (n, path) => {
    if (DATA_KINDS.includes(n.kind) && !(Array.isArray(data[path]) && (data[path] as unknown[]).length)) empty.push(`${path} (${n.kind})`)
  })
  return empty
}

export interface ComposeResult {
  label: string
  summary: string
  tree: ComposedNode
  issues: string[]
}

/** A new composed block from the owner's request, or the current one changed (`current`). */
export async function aiComposeBlock(opts: {
  prompt: string
  page: string
  current?: { label?: string; tree?: unknown } | null
  hint?: string | null
}): Promise<ComposeResult> {
  const [categories, stats] = await Promise.all([DATA_TOOLS.list_categories().catch(() => []), DATA_TOOLS.store_stats().catch(() => ({}))])
  const system = `You design one block of an online store's ${opts.page} page. ${await storeDescriptorForPrompt()}
You build it only from these safe primitives (there is no HTML or CSS):
${COMPOSED_GRAMMAR}
Rules:
- Look the store up with the tools before you write: use only slugs the tools returned. Never invent products, prices, reviews or offers.
- Data nodes hold a query, never a copied list, so the block stays live.
- Image nodes only use image URLs the tools returned; otherwise prefer data nodes, which bring their own pictures.
- Copy: Indian English, short, specific to this store, no emoji, no prices.
- Phones: give grids and data nodes a web_mobile column count of 1 or 2.
- Keep it focused: one idea per block, usually 5 to 30 nodes.
- Settings sit directly on the node (no "settings" wrapper); words go in text/label, never in children. To show products, categories, brands, reviews or offers use their data node, never image nodes.
When done, reply with JSON only: {"label": "a short name", "summary": "one sentence on what you built", "tree": {the root section}}.
Example: {"label": "Best sellers", "summary": "Best sellers beside a short pitch.", "tree": {"kind": "section", "tone": "muted", "children": [{"kind": "columns", "ratio": "1:2", "children": [
  {"kind": "stack", "gap": "md", "children": [{"kind": "badge", "text": "Most loved"}, {"kind": "heading", "text": "Our best sellers", "level": 2}, {"kind": "text", "text": "Picked by customers this month."}, {"kind": "button", "label": "Shop all", "href": "/products"}]},
  {"kind": "products", "query": {"category": "<a slug from list_categories>", "sort": "best_sellers", "limit": 4}, "layout": "grid", "cols": {"web": 2, "web_mobile": 2}}]}]}}`
  const facts = `Store facts: ${JSON.stringify(stats)}. Categories: ${JSON.stringify(categories.slice(0, 30))}.`
  const ask = opts.current
    ? `Change this block as asked: ${opts.prompt}${opts.hint ? `\nThe owner pointed at: "${opts.hint}"` : ''}\nThe block now: ${JSON.stringify({ label: opts.current.label, tree: opts.current.tree }).slice(0, 9000)}`
    : `Build this block: ${opts.prompt}`
  const messages: AiChatMessage[] = [
    { role: 'system', content: system },
    { role: 'user', content: `${facts}\n\n${ask}` },
  ]

  let out = await converse(messages)
  let cleaned = cleanTree(out?.tree)
  if (!cleaned.tree) {
    console.warn('[compose] unusable reply', out ? JSON.stringify(out).slice(0, 1500) : 'no JSON', cleaned.issues.slice(0, 8))
    throw new SiteAiError('The AI could not build that block; try describing it differently')
  }

  // One repair round for data that found nothing (a wrong slug, too narrow a filter).
  const empty = await emptyDataNodes(cleaned.tree).catch(() => [])
  if (empty.length) {
    messages.push(
      { role: 'assistant', content: JSON.stringify({ label: out?.label, summary: out?.summary, tree: cleaned.tree }) },
      { role: 'user', content: `These data nodes found nothing in the store: ${empty.join(', ')}. Check with the tools and fix their queries (or remove them). Reply with the whole JSON again.` }
    )
    const fixed = await converse(messages).catch(() => null)
    const again = cleanTree(fixed?.tree)
    if (again.tree) {
      out = fixed
      cleaned = again
    }
  }

  return {
    label: String(out?.label ?? 'Custom block').slice(0, 80),
    summary: String(out?.summary ?? 'Built a new block.').slice(0, 300),
    tree: cleaned.tree!,
    issues: cleaned.issues.slice(0, 10),
  }
}
