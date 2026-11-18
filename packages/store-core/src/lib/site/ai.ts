import { randomUUID } from 'crypto'
import { normalizeDoc, topBlocks, validateDoc, type Block, type FieldMeta, type PageDoc, type PageRef } from '@jeffi/site-blocks'
import { aiChat } from '@/lib/shared/ai-client'
import { parseAiJson } from '@/lib/auth/ai-scope'
import { storeDescriptorForPrompt } from '@/lib/catalog/brand'
import { coreBlockFor, isSectionBlock, siteRegistry } from './blocks'

// Site Builder AI: build a whole page from the blocks this page can have, or correct one block (the one the owner
// picked with the arrow tool, with what they pointed at). The model only ever returns block types and settings; the
// result is validated against the registry before the editor applies it as an ordinary, undoable edit.

const CONFIG_HINTS = `Settings ("config") you may set when you know them; otherwise leave config {}:
- product_row: { "source": "featured" | "new_arrivals" | "best_sellers" | "on_sale" | "category", "limit": 4-12, "layout": "grid" | "carousel", "categorySlug"?: string }
- any image block: { "aspect": "auto" | "21:9" | "16:9" | "3:1" | "5:3" | "4:3" | "1:1" | "4:5" | "3:4" }
Copy: short, specific to what the store sells, Indian English, no emoji, no prices you were not given.`

const COPY_KEYS = ['title', 'subtitle', 'eyebrow', 'ctaLabel', 'ctaUrl'] as const

type AiBlock = { type?: unknown; config?: unknown } & Partial<Record<(typeof COPY_KEYS)[number], unknown>>

// What the model sees of a block's settings: scalars as they are, long lists summarised (it must not echo them back).
function settingsSummary(props: Record<string, unknown>): Record<string, unknown> {
  const brief = (v: unknown, depth: number): unknown => {
    if (Array.isArray(v)) return v.length > 3 || depth > 1 ? `[${v.length} items, unchanged unless asked]` : v.map(x => brief(x, depth + 1))
    if (v && typeof v === 'object') return depth > 2 ? '{…}' : Object.fromEntries(Object.entries(v).map(([k, x]) => [k, brief(x, depth + 1)]))
    return typeof v === 'string' && v.length > 300 ? `${v.slice(0, 300)}…` : v
  }
  return brief(props, 0) as Record<string, unknown>
}

const text = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : v === null ? null : undefined)

// A non-section block's settings: every key its definition declares (the schema drops anything else on validation).
function contentPropsFrom(type: string, ai: Record<string, unknown>, base: Record<string, unknown> = {}): Record<string, unknown> {
  const keys = Object.keys(siteRegistry.get(type)?.fields ?? {})
  return { ...base, ...Object.fromEntries(Object.entries(ai).filter(([k, v]) => keys.includes(k) && v !== undefined && !(typeof v === 'string' && /^\[\d+ items/.test(v)))) }
}

const fieldList = (type: string) =>
  (Object.entries(siteRegistry.get(type)?.fields ?? {}) as [string, FieldMeta][])
    .map(([k, f]) => `${k}${f.kind === 'select' && f.options ? ` (${f.options.map(o => o.value).join('|')})` : f.kind === 'list' && f.item ? ` ([{${f.item.map(i => i.key).join(', ')}}])` : f.kind === 'list' ? ' ([{label, href}])' : f.kind === 'boolean' ? ' (true|false)' : ''}`)
    .join(', ')

function propsFrom(ai: AiBlock, base: Record<string, unknown> = {}): Record<string, unknown> {
  const next: Record<string, unknown> = { ...base }
  const max: Record<string, number> = { title: 300, subtitle: 1000, eyebrow: 200, ctaLabel: 100, ctaUrl: 2000 }
  for (const k of COPY_KEYS) {
    const v = text(ai[k], max[k])
    if (v !== undefined) next[k] = v
  }
  if (ai.config && typeof ai.config === 'object' && !Array.isArray(ai.config)) {
    const changed = Object.fromEntries(Object.entries(ai.config).filter(([, v]) => !(typeof v === 'string' && /^\[\d+ items/.test(v)) && v !== '{…}'))
    next.config = { ...((base.config as object) ?? {}), ...changed }
  }
  return next
}

async function ask(system: string, user: string, modelHint: 'copy' | 'agent' = 'copy', maxTokens = 1500) {
  const r = await aiChat({
    feature: 'site_builder',
    modelHint,
    maxTokens,
    jsonMode: true,
    temperature: 0.4,
    noCache: true,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  })
  const out = parseAiJson<Record<string, unknown>>(r.content)
  if (!out) console.warn('[site-builder ai] unparseable reply:', r.content.slice(0, 300))
  return out
}

const hasBlockFields = (o: unknown): o is AiBlock =>
  !!o && typeof o === 'object' && (COPY_KEYS.some(k => k in (o as object)) || 'config' in (o as object))

export class SiteAiError extends Error {}

/** Corrects one block from the owner's request; returns the page with that block changed. */
export async function aiCorrectBlock(doc: PageDoc, ref: Pick<PageRef, 'audience' | 'surface' | 'page'>, blockId: string, prompt: string, hint?: string | null) {
  const block = doc.blocks[blockId]
  const def = block && siteRegistry.get(block.type)
  if (!block || !def) throw new SiteAiError('That block is not on this page any more')
  const store = await storeDescriptorForPrompt()
  const out = await ask(
    `You edit one block of an online store's ${ref.page} page (${ref.surface === 'web' ? 'desktop website' : ref.surface === 'web_mobile' ? 'phone browsers' : 'mobile app'}). ${store}
The block is "${def.label}": ${def.description ?? ''}
Return JSON {"block": {${isSectionBlock(block.type) ? '"title"?, "subtitle"?, "eyebrow"?, "ctaLabel"?, "ctaUrl"?, "config"?' : fieldList(block.type)}}, "summary": "one sentence on what you changed"}. Include ONLY the keys the request changes, and inside "config" only the changed keys: never repeat unchanged values or lists. Use null to clear a text.
${CONFIG_HINTS}`,
    `Current settings: ${JSON.stringify(settingsSummary(block.props)).slice(0, 4000)}
${hint ? `The owner pointed at: "${hint}"\n` : ''}Request: ${prompt}`
  )
  // Some models drop the {"block": …} wrapper and return the fields at the top level.
  const section = isSectionBlock(block.type)
  const raw = out?.block && typeof out.block === 'object' ? (out.block as Record<string, unknown>) : out
  const change = section ? (hasBlockFields(raw) ? raw : null) : raw && Object.keys(raw).some(k => k in (def.fields ?? {})) ? raw : null
  if (!change) throw new SiteAiError('The AI did not return a change; try rephrasing')
  const next: Block = { ...block, props: section ? propsFrom(change as AiBlock, block.props) : contentPropsFrom(block.type, change, block.props) }
  const result = validateDoc({ ...doc, blocks: { ...doc.blocks, [blockId]: next } }, siteRegistry, ref)
  return { doc: result.doc, summary: typeof out?.summary === 'string' ? out.summary : `Updated ${def.label}` }
}

/** Builds (or rebuilds) the page from the owner's description, reusing existing blocks of the same type. */
export async function aiBuildPage(doc: PageDoc, ref: Pick<PageRef, 'audience' | 'surface' | 'page'>, prompt: string, planTypes: string[] | null) {
  const allowed = siteRegistry.allowedOn(ref).filter(d => !planTypes || !isSectionBlock(d.type) || planTypes.includes(d.type))
  const store = await storeDescriptorForPrompt()
  const current = topBlocks(doc).map(b => ({ type: b.type, title: (b.props as { title?: unknown }).title ?? null }))
  const out = await ask(
    `You lay out an online store's ${ref.page} page for ${ref.surface === 'web' ? 'the desktop website' : ref.surface === 'web_mobile' ? 'phone browsers (keep it short and scannable)' : 'the mobile app'}${ref.audience === 'business' ? ' for business (B2B) buyers: favour quotes, reorder, GST/tax and account blocks' : ''}. ${store}
Use only these block types (type: what it is):
${allowed.map(d => `- ${d.type}: ${d.label}. ${d.description ?? ''}${d.locked ? ' (REQUIRED: include it exactly once)' : d.singleton ? ' (at most once)' : ''}${isSectionBlock(d.type) ? '' : ` Settings: ${fieldList(d.type)}.`}`).join('\n')}
Return JSON {"blocks": [{"type", ...settings}], "summary": "one or two sentences"}. Section blocks take "title"?, "subtitle"?, "eyebrow"?, "ctaLabel"?, "ctaUrl"?, "config"?; other blocks take the settings listed for them. Leave image settings empty (the owner adds pictures). 6 to 14 blocks, a strong first block, varied rhythm (do not stack similar blocks), real-sounding copy for this store.
${CONFIG_HINTS}`,
    `The page now: ${JSON.stringify(current)}
Request: ${prompt}`,
    'agent',
    5000
  )
  const raw = out?.blocks ?? out?.layout ?? out?.sections
  const list = Array.isArray(raw) ? (raw as AiBlock[]) : null
  if (!list?.length) throw new SiteAiError('The AI did not return a layout; try describing the page differently')
  const unused = new Map<string, Block[]>()
  for (const b of topBlocks(doc)) unused.set(b.type, [...(unused.get(b.type) ?? []), b])
  const blocks: Record<string, Block> = {}
  const order: string[] = []
  for (const ai of list.slice(0, 20)) {
    const type = String(ai.type ?? '')
    const def = allowed.find(d => d.type === type)
    if (!def) continue
    const reuse = unused.get(type)?.shift()
    const id = reuse?.id ?? randomUUID()
    const base = reuse?.props ?? (def.props.parse({}) as Record<string, unknown>)
    blocks[id] = { ...(reuse ?? {}), id, type, v: def.v, props: isSectionBlock(type) ? propsFrom(ai, base) : contentPropsFrom(type, ai as Record<string, unknown>, base) }
    order.push(id)
  }
  // The page's working core (product details, the cart) stays, where it was if the AI left it out.
  const core = coreBlockFor(ref.page)
  if (core && !order.some(id => blocks[id].type === core.type)) {
    const was = topBlocks(doc).findIndex(b => b.type === core.type)
    const keep = topBlocks(doc).find(b => b.type === core.type) ?? { id: randomUUID(), type: core.type, v: core.v, props: {} }
    blocks[keep.id] = keep
    order.splice(Math.max(0, Math.min(was < 0 ? 0 : was, order.length)), 0, keep.id)
  }
  // Blocks kept from the page bring the blocks inside them (a listing's between-products sections).
  const addKids = (b: Block) =>
    Object.values(b.children ?? {}).flat().forEach(cid => {
      const c = doc.blocks[cid]
      if (c && !blocks[cid]) {
        blocks[cid] = c
        addKids(c)
      }
    })
  Object.values(blocks).forEach(addKids)
  const result = validateDoc(normalizeDoc({ ...doc, blocks, order }), siteRegistry, ref)
  if (!result.doc.order.length) throw new SiteAiError('The AI picked blocks this page cannot have; try again')
  return { doc: result.doc, summary: typeof out?.summary === 'string' ? out.summary : `Built ${result.doc.order.length} blocks` }
}
