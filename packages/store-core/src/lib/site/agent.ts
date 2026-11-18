import {
  cloneDoc,
  topBlocks,
  type Archetype,
  type Block,
  type FieldMeta,
  type PageDoc,
  type PageRef,
  type SiteTemplate,
  type ThemeTokens,
} from '@jeffi/site-blocks'
import { aiChat } from '@/lib/shared/ai-client'
import { parseAiJson } from '@/lib/auth/ai-scope'
import { fetchPublic } from '@/lib/shared/safe-fetch'
import { queryMany, queryOne } from '@/lib/shared/db'
import { storeDescriptorForPrompt } from '@/lib/catalog/brand'
import { generateImage } from '@/lib/ai/media'
import { platformFunding } from '@/lib/ai/billing'
import { metered } from '@/lib/ai/cost-meter'
import { isSectionBlock, siteRegistry } from './blocks'
import { SECTION_TILE_DEFAULTS } from '@/lib/catalog/homepage-sections'
import { sitePacks } from './packs'
import { createSiteDraft, getSiteDraft, saveDraftPage, saveDraftTheme } from './store'
import { readReferenceProfile, type ReferenceProfile } from './reference'
import { homeFromProfile, themeFromProfile } from './profile-page'
import { critiqueDraft } from './critique'

// AI site agent: owner's description (+ sites they like) → a whole site in a new draft. Picks the closest site pack,
// tunes its colours, rewrites every page's copy for this store, optionally generates pictures, and records progress on
// the draft (docs.ai). Output is ordinary validated blocks; nothing goes live until the owner publishes.

export interface SiteAgentInput {
  description: string
  style?: Archetype | 'auto'
  references?: string[]
  images?: boolean
}

export interface SiteBrief {
  summary: string
  category: string
  vocabulary: string[]
  audience: string
  tone: string
  archetype: Archetype
  palette?: { primary?: string; accent?: string }
  artDirection: string
}

interface Catalog {
  products: number
  categories: string[]
  brands: string[]
  samples: string[]
}

const HEX = /^#[0-9a-f]{6}$/i
const MAX_IMAGES = 6
// Inside a funded build (onboarding, or a Site Builder generation on a provider-cost budget, lib/site/site-generation.ts):
// stop calling the AI once the budget is spent.
const budgetLeft = () => Math.min(platformFunding()?.remainingInr ?? Infinity, metered()?.remainingInr ?? Infinity)

async function ask<T = Record<string, unknown>>(system: string, user: string, modelHint: 'copy' | 'deep', maxTokens: number): Promise<T | null> {
  const r = await aiChat({ feature: 'site_builder', modelHint, maxTokens, jsonMode: true, temperature: 0.5, noCache: true, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] })
  return parseAiJson<T>(r.content)
}

/** The store's catalogue in a few lines, so copy and blocks speak about what it really sells. */
async function catalogSummary(): Promise<Catalog> {
  const [count, cats, brands, samples] = await Promise.all([
    queryOne<{ n: string }>(`SELECT count(*) AS n FROM products WHERE is_active = true`).catch(() => null),
    queryMany<{ name: string }>(`SELECT name FROM categories WHERE is_active = true AND parent_category_id IS NULL ORDER BY display_order NULLS LAST, name LIMIT 12`).catch(() => []),
    queryMany<{ name: string }>(`SELECT name FROM brands WHERE is_active = true ORDER BY name LIMIT 10`).catch(() => []),
    queryMany<{ name: string }>(`SELECT name FROM products WHERE is_active = true ORDER BY created_at DESC LIMIT 10`).catch(() => []),
  ])
  return { products: Number(count?.n ?? 0), categories: cats.map(c => c.name), brands: brands.map(b => b.name), samples: samples.map(s => s.name) }
}

const strip = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()

/** What a reference site says about itself: title, description and headings (style cues only; nothing is copied). */
export async function readReferences(urls: string[]): Promise<{ url: string; title: string; description: string; headings: string[] }[]> {
  const out = await Promise.all(
    urls.slice(0, 3).map(async url => {
      try {
        const { bytes } = await fetchPublic(url, 600_000, { truncate: true })
        const html = bytes.toString('utf8')
        const title = strip(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '').slice(0, 160)
        const description = (html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)?.[1] ?? '').slice(0, 300)
        const headings = [...html.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi)].map(m => strip(m[1])).filter(h => h && h.length < 90).slice(0, 15)
        return { url, title, description, headings }
      } catch {
        return null
      }
    })
  )
  return out.filter((r): r is NonNullable<typeof r> => !!r)
}

const STORE_PACKS = () => sitePacks().filter(p => p.pages[0]?.audience === 'store')

/** The brief: what the store is, who it is for, its voice, the closest style and an art direction for pictures. */
export async function makeBrief(input: SiteAgentInput, catalog: Catalog, refs: Awaited<ReturnType<typeof readReferences>>, profile?: ReferenceProfile | null): Promise<SiteBrief> {
  const packs = STORE_PACKS()
  const out = await ask<Partial<SiteBrief>>(
    `You plan an online store's website. ${await storeDescriptorForPrompt()}
Pick the closest style (archetype) from:
${packs.map(p => `- ${p.archetype}: ${p.name}. ${p.description}`).join('\n')}
Return JSON {"summary": one sentence, "category": what it sells, "vocabulary": [6-10 specific words shoppers of this category use], "audience": who buys, "tone": voice in a few words, "archetype": one of the ids above, "palette": {"primary": "#rrggbb", "accent": "#rrggbb"} or null to keep the style's, "artDirection": one sentence describing photography for every picture (light, setting, mood, colours)}.`,
    `Owner's description: ${input.description}
${input.style && input.style !== 'auto' ? `The owner chose the style: ${input.style}\n` : ''}Catalogue: ${catalog.products} products. Categories: ${catalog.categories.join(', ') || 'none yet'}. Brands: ${catalog.brands.join(', ') || 'none'}. Examples: ${catalog.samples.join('; ') || 'none'}.
${refs.length ? `Sites the owner likes (take their feel, never their words):\n${refs.map(r => `- ${r.url}: ${r.title}. ${r.description} Headings: ${r.headings.join(' | ')}`).join('\n')}` : ''}
${profile ? `Its design: ${profile.feel} ${profile.imageLed ? 'Image-led.' : ''} Density: ${profile.density}. Colours it uses: ${profile.colors.join(', ') || 'unknown'} (a cue for the feel; the store keeps its own identity).` : ''}`,
    'deep',
    1200
  ).catch(() => null)
  const archetype = input.style && input.style !== 'auto' ? input.style : packs.some(p => p.archetype === out?.archetype) ? (out!.archetype as Archetype) : 'minimal_modern'
  const palette = out?.palette && typeof out.palette === 'object' ? out.palette : undefined
  return {
    summary: String(out?.summary ?? input.description).slice(0, 300),
    category: String(out?.category ?? '').slice(0, 120),
    vocabulary: Array.isArray(out?.vocabulary) ? out!.vocabulary.map(String).slice(0, 12) : [],
    audience: String(out?.audience ?? '').slice(0, 160),
    tone: String(out?.tone ?? '').slice(0, 120),
    archetype,
    palette: palette ? { primary: HEX.test(String(palette.primary)) ? palette.primary : undefined, accent: HEX.test(String(palette.accent)) ? palette.accent : undefined } : undefined,
    artDirection: String(out?.artDirection ?? 'Natural light, clean backgrounds, true-to-life colour').slice(0, 300),
  }
}

// Sections whose tiles fall back to the flagship's built-in ones (hardware, "24/7 support"): their words are rewritten
// for this store, icons and colours kept.
const TILE_TEXT: Record<string, string[]> = { why_us: ['title', 'desc'], benefits: ['title', 'sub'], trust_strip: ['label'] }

function tilesOf(b: Block): Record<string, unknown>[] | null {
  const keys = TILE_TEXT[b.type]
  if (!keys) return null
  const own = ((b.props as { config?: { items?: unknown } }).config?.items ?? null) as Record<string, unknown>[] | null
  const base = Array.isArray(own) && own.length ? own : ((SECTION_TILE_DEFAULTS as Record<string, Record<string, unknown>[]>)[b.type] ?? [])
  return base.length ? base : null
}

// The text a block shows, by key, as the AI may rewrite it: section copy and tiles, text fields and question lists.
function copyOf(b: Block): Record<string, unknown> | null {
  if (isSectionBlock(b.type)) {
    const p = b.props as Record<string, unknown>
    const c: Record<string, unknown> = Object.fromEntries(['title', 'subtitle', 'eyebrow', 'ctaLabel'].filter(k => typeof p[k] === 'string' && p[k]).map(k => [k, p[k]]))
    const tiles = tilesOf(b)
    if (tiles) c.items = tiles.map(t => Object.fromEntries(TILE_TEXT[b.type].map(k => [k, t[k]])))
    return Object.keys(c).length ? c : null
  }
  const fields = Object.entries(siteRegistry.get(b.type)?.fields ?? {}) as [string, FieldMeta][]
  const c: Record<string, unknown> = {}
  for (const [k, f] of fields) {
    const v = b.props[k]
    if ((f.kind === 'text' || f.kind === 'richtext') && typeof v === 'string' && v) c[k] = v
    if (f.kind === 'list' && f.item && Array.isArray(v) && v.length) c[k] = v
  }
  return Object.keys(c).length ? c : null
}

/** One page's copy rewritten for this store; keys and lengths kept, anything unusable left as it was. */
async function rewritePage(doc: PageDoc, ref: Pick<PageRef, 'page' | 'surface'>, brief: SiteBrief, catalog: Catalog): Promise<PageDoc> {
  const all = Object.values(doc.blocks)
  const copy = Object.fromEntries(all.map(b => [b.id, copyOf(b)]).filter(([, c]) => c))
  if (!Object.keys(copy).length) return doc
  const out = await ask<Record<string, Record<string, unknown>>>(
    `You write the words of one page of an online store (${ref.page} page, ${ref.surface === 'web_mobile' ? 'phone' : 'desktop'}). The store: ${brief.summary} It sells ${brief.category || 'what its catalogue shows'} to ${brief.audience || 'its customers'}. Voice: ${brief.tone || 'warm and clear'}. Use words like: ${brief.vocabulary.join(', ')}.
Rewrite every value for this store. Keep each key, keep lengths close to the original (headings short), Indian English, no emoji, no prices or claims you were not given. Never invent numbers, delivery or response times, support hours, years in business, customer counts, guarantees, awards, people or testimonials: say what the store sells and how it helps instead. Keep placeholders like {amount} exactly as written. Return JSON with the same block ids and keys.`,
    `Categories: ${catalog.categories.join(', ') || 'none'}. Brands: ${catalog.brands.join(', ') || 'none'}.
Page copy: ${JSON.stringify(copy).slice(0, 7000)}`,
    'copy',
    3000
  ).catch(() => null)
  if (!out || typeof out !== 'object') return doc
  const blocks = { ...doc.blocks }
  for (const [id, fields] of Object.entries(out)) {
    const b = blocks[id]
    const was = copy[id] as Record<string, unknown> | undefined
    if (!b || !was || !fields || typeof fields !== 'object') continue
    const props = { ...b.props }
    for (const [k, v] of Object.entries(fields)) {
      if (!(k in was)) continue
      if (k === 'items' && isSectionBlock(b.type) && Array.isArray(v)) {
        const base = tilesOf(b) ?? []
        const items = base.map((t, i) => {
          const next = v[i] && typeof v[i] === 'object' ? (v[i] as Record<string, unknown>) : {}
          return { ...t, ...Object.fromEntries(TILE_TEXT[b.type].filter(f => typeof next[f] === 'string' && (next[f] as string).trim()).map(f => [f, (next[f] as string).trim().slice(0, 160)])) }
        })
        props.config = { ...((props.config as Record<string, unknown>) ?? {}), items }
        continue
      }
      if (typeof was[k] === 'string' && typeof v === 'string' && v.trim()) props[k] = v.trim().slice(0, k === 'body' || k === 'subtitle' ? 4000 : 300)
      if (Array.isArray(was[k]) && Array.isArray(v) && v.length) props[k] = v.slice(0, 20)
    }
    blocks[id] = { ...b, props }
  }
  return { ...doc, blocks }
}

const IMAGE_SIZE: Record<string, [number, number]> = { hero: [1600, 700], wide: [1600, 900], portrait: [896, 1120], square: [1024, 1024], landscape: [1280, 960], story: [768, 1366] }

/** Pictures for the empty image slots of a page, in one art direction; returns how many were made. */
async function fillImages(doc: PageDoc, brief: SiteBrief, budget: { left: number }, draftId: string): Promise<number> {
  let made = 0
  for (const b of topBlocks(doc)) {
    const fields = Object.entries(siteRegistry.get(b.type)?.fields ?? {}) as [string, FieldMeta][]
    for (const [k, f] of fields) {
      if (f.kind !== 'image' || b.props[k] || budget.left <= 0 || budgetLeft() <= 0 || k === 'mobileImage') continue
      const [width, height] = IMAGE_SIZE[f.size ?? 'wide'] ?? IMAGE_SIZE.wide
      const subject = String(b.props.heading ?? b.props.sideHeading ?? brief.category)
      budget.left--
      try {
        const r = await generateImage({
          prompt: `${subject}. For an online store selling ${brief.category}. ${brief.artDirection}. Photographic, no text, no logos, no watermarks.`,
          negativePrompt: 'text, letters, watermark, logo, distorted hands',
          width,
          height,
          feature: 'homepage_image',
          // Site generation always uses the cheapest image model.
          quality: 'draft',
          ref: `site:${draftId}`,
        })
        if (r.images[0]?.url) {
          b.props[k] = r.images[0].url
          made++
        }
      } catch {
        // out of credits or provider down: leave the slot for the owner
      }
    }
  }
  return made
}

async function progress(draftId: string, ai: Record<string, unknown>) {
  await queryOne(`UPDATE site_drafts SET docs = jsonb_set(docs, '{ai}', $2::jsonb), updated_at = now() WHERE id = $1 RETURNING id`, [draftId, JSON.stringify(ai)]).catch(() => null)
}

/** Starts a draft for the AI to fill; the build itself runs in buildSiteInDraft. */
export async function startAiSiteDraft(adminId: string | null): Promise<string> {
  const id = await createSiteDraft(adminId, 'AI site (building…)')
  await progress(id, { status: 'running', step: 'Reading your brief', at: new Date().toISOString() })
  return id
}

export interface SiteBuildResult {
  ok: boolean
  /** The critique pass: what it found and fixed. */
  checked?: number
  fixed?: number
  style?: string
  summary?: string
  pages?: number
  pictures?: number
  error?: string
}

/** Builds the whole site into the draft, recording progress on it (docs.ai). Never throws. */
export async function buildSiteInDraft(draftId: string, input: SiteAgentInput, adminId: string | null): Promise<SiteBuildResult> {
  try {
    const first = input.references?.[0]
    const [refs, catalog, profile] = await Promise.all([
      readReferences(input.references ?? []).catch(() => []),
      catalogSummary(),
      first ? readReferenceProfile(first).catch(() => null) : Promise.resolve(null),
    ])
    const brief = await makeBrief(input, catalog, refs, profile)
    const pack: SiteTemplate = STORE_PACKS().find(p => p.archetype === brief.archetype) ?? STORE_PACKS()[0]
    let pages = pack.pages
    let reference: { url: string; patterns: number; composed: number; skipped: string[] } | null = null
    // A site the owner likes lays out the home page: its patterns in its order, as our blocks.
    if (profile?.sequence.length) {
      await progress(draftId, { status: 'running', step: `Laying out your home page like ${new URL(profile.url).hostname}`, archetype: brief.archetype, summary: brief.summary })
      const home = await homeFromProfile(profile, { brands: catalog.brands.length, compose: budgetLeft() > 0, brief: brief.summary }).catch(() => null)
      if (home) {
        pages = pages.map(p => (p.page !== 'home' ? p : p.surface === 'web' ? { ...p, doc: home.web } : p.surface === 'web_mobile' ? { ...p, doc: home.phone } : p))
        reference = { url: profile.url, patterns: profile.sequence.length, composed: home.composed, skipped: home.skipped }
      }
    }
    await progress(draftId, { status: 'running', step: `Writing your ${pack.name} pages`, archetype: brief.archetype, summary: brief.summary })

    const theme: Partial<ThemeTokens> = {
      ...pack.theme,
      ...(profile ? themeFromProfile(profile) : {}),
      ...(brief.palette?.primary ? { primary: brief.palette.primary } : {}),
      ...(brief.palette?.accent ? { accent: brief.palette.accent } : {}),
    }
    const budget = { left: input.images ? MAX_IMAGES : 0 }
    let pictures = 0
    const queue = [...pages]
    const workers = Array.from({ length: 4 }, async () => {
      for (let p = queue.shift(); p; p = queue.shift()) {
        let doc = cloneDoc(p.doc, () => crypto.randomUUID())
        if (budgetLeft() > 0) doc = await rewritePage(doc, p, brief, catalog).catch(() => doc)
        if (budget.left > 0 && p.surface === 'web') pictures += await fillImages(doc, brief, budget, draftId)
        await saveDraftPage(draftId, { audience: p.audience, surface: p.surface, page: p.page, slug: '' }, doc, adminId)
      }
    })
    await Promise.all(workers)
    await saveDraftTheme(draftId, 'store', theme, adminId)
    await queryOne(`UPDATE site_drafts SET title = $2 WHERE id = $1 RETURNING id`, [draftId, `AI site: ${pack.name}`]).catch(() => null)
    // The critique pass: every page checked, what can be fixed fixed (two rounds at most).
    await progress(draftId, { status: 'running', step: 'Checking every page', archetype: brief.archetype, summary: brief.summary })
    const check = await critiqueDraft(draftId, { fix: true }).catch(() => null)
    const left = check ? Object.values(check.pages).flatMap(p => p.left.map(f => f.message)).slice(0, 8) : []
    await progress(draftId, {
      status: 'done',
      step: 'Ready to review',
      archetype: brief.archetype,
      style: pack.name,
      summary: brief.summary,
      pages: pages.length,
      pictures,
      checked: check?.found ?? 0,
      fixed: check?.fixed ?? 0,
      left,
      reference,
      at: new Date().toISOString(),
    })
    return { ok: true, style: pack.name, summary: brief.summary, pages: pages.length, pictures, checked: check?.found, fixed: check?.fixed }
  } catch (err) {
    const error = (err as Error).message?.slice(0, 200)
    await progress(draftId, { status: 'failed', step: 'The AI could not finish', error })
    return { ok: false, error }
  }
}

/** The draft's AI build status, if it has one. */
export async function aiSiteStatus(draftId: string) {
  return ((await getSiteDraft(draftId))?.docs as { ai?: Record<string, unknown> } | undefined)?.ai ?? null
}
