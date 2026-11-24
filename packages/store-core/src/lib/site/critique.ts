import { normalizeDoc, normalizeTheme, paletteFrom, parsePageRefKey, topBlocks, type Block, type PageDoc, type PageRef, type ThemeTokens } from '@jeffi/site-blocks'
import { queryOne } from '@/lib/shared/db'
import { aiChat } from '@/lib/shared/ai-client'
import { parseAiJson } from '@/lib/auth/ai-scope'
import { listActiveOffers } from '@/lib/catalog/product-offers'
import { loadSectionExtras } from '@/lib/catalog/homepage-extras'
import { configNumber, type ProductSource } from '@/lib/catalog/homepage-sections'
import { isSectionBlock } from './blocks'
import { docToRows } from './legacy'
import { DATA_KINDS, cleanTree, updateNode, walkTree, type ComposedNode } from './composed'
import { loadComposedData, productsFor } from './composed-data'
import { getSiteDraft, saveDraftPage, saveDraftTheme } from './store'
import { freeAt } from './code/free'
import type { CodeNode } from './code/ast'

// The critique pass: a page checked the way a careful designer would before it goes live, without a browser. It finds
// blocks that would render empty (no products, reviews or offers behind them), banners with no picture, text too long
// for its slot, headings on a picture with nothing to keep them readable, colours too pale for white text, the same
// thing twice, phone layouts too dense to tap, and freely placed elements that fall off a phone's screen. Most
// findings fix themselves; long text is shortened by the AI.
// A screenshot check can join later through the same Finding shape.

export interface Finding {
  severity: 'error' | 'warn'
  code: 'empty_data' | 'empty_block' | 'no_image' | 'too_long' | 'busy_image' | 'contrast' | 'repeat' | 'phone_dense' | 'too_many' | 'empty_page' | 'off_screen'
  message: string
  blockId?: string
  /** It can be fixed without asking (removed, set, shortened). */
  fixable: boolean
}

const LIMITS: Record<string, number> = { heading: 70, title: 70, subheading: 140, subtitle: 140, eyebrow: 40, ctaLabel: 24, sideHeading: 70, text: 90 }
const BANNER_HEADING = 50

// WCAG relative luminance and contrast ratio.
const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
export const contrast = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m)
  return (x + 0.05) / (y + 0.05)
}

const ROW_QUERY: Record<ProductSource, (slug: string | null) => Parameters<typeof productsFor>[0]> = {
  featured: () => ({ featured: true, sort: 'new', limit: 1 }),
  new_arrivals: () => ({ sort: 'new', limit: 1 }),
  best_sellers: () => ({ sort: 'best_sellers', limit: 1 }),
  on_sale: () => ({ onSale: true, sort: 'discount', limit: 1 }),
  category: slug => ({ ...(slug ? { category: slug } : {}), sort: 'new', limit: 1 }),
}

/** True when a section block has nothing to show; null when we can't tell. */
async function sectionEmpty(b: Block, ref: Pick<PageRef, 'audience' | 'surface' | 'page'>): Promise<boolean | null> {
  const config = (b.props.config ?? {}) as Record<string, unknown>
  try {
    switch (b.type) {
      case 'product_row': {
        const source = (['featured', 'new_arrivals', 'best_sellers', 'on_sale', 'category'] as const).find(s => s === config.source) ?? 'featured'
        return (await productsFor(ROW_QUERY[source](typeof config.categorySlug === 'string' ? config.categorySlug : null))).length === 0
      }
      case 'category_grid':
        return !(await queryOne(`SELECT 1 FROM categories WHERE is_active = true AND parent_category_id IS NULL LIMIT 1`))
      case 'brand_carousel':
        return !(await queryOne(`SELECT 1 FROM brands WHERE is_active = true LIMIT 1`))
      case 'testimonials':
        return !(await queryOne(`SELECT 1 FROM product_reviews WHERE is_approved = true AND rating >= $1 AND length(btrim(COALESCE(comment, ''))) >= 20 LIMIT 1`, [configNumber({ config }, 'minRating', 4, 5)]))
      case 'offer_slider':
        return (await listActiveOffers()).length === 0
      case 'countdown_deal':
      case 'product_spotlight':
      case 'bundle_spotlight':
      case 'back_in_stock':
      case 'category_tabs': {
        // Extras load the same way whatever page the block is on.
        const rows = docToRows(normalizeDoc({ blocks: { [b.id]: b }, order: [b.id] }), { ...ref, page: 'home' }).sections
        const v = (await loadSectionExtras(rows, false)).get(b.id)
        return v == null || (Array.isArray(v) && v.length === 0)
      }
      default:
        return null
    }
  } catch {
    return null
  }
}

/** Everything wrong with one page. */
export async function critiquePage(doc: PageDoc, ref: Pick<PageRef, 'audience' | 'surface' | 'page'>, theme: ThemeTokens): Promise<Finding[]> {
  const out: Finding[] = []
  const blocks = topBlocks(doc).filter(b => !b.visibility?.hidden)
  if (!blocks.length) return [{ severity: 'error', code: 'empty_page', message: 'This page has no blocks.', fixable: false }]
  if (ref.page === 'home' && blocks.length > 14) out.push({ severity: 'warn', code: 'too_many', message: `${blocks.length} blocks is a long page; customers rarely scroll past ten.`, fixable: false })

  const titles = new Map<string, string>()
  const rowKeys = new Map<string, string>()
  await Promise.all(
    blocks.map(async b => {
      const p = b.props as Record<string, any>
      // Would render empty.
      if (isSectionBlock(b.type)) {
        const empty = await sectionEmpty(b, ref)
        if (empty) out.push({ severity: 'error', code: 'empty_data', blockId: b.id, message: `"${p.title ?? b.type}" has nothing to show yet (no matching products, reviews or offers), so customers would see a gap.`, fixable: true })
      }
      if (b.type === 'composed') {
        const tree = cleanTree(p.tree).tree
        if (!tree) out.push({ severity: 'error', code: 'empty_block', blockId: b.id, message: 'A custom block is empty.', fixable: true })
        else {
          const data = await loadComposedData(tree).catch(() => ({}) as Record<string, unknown>)
          const nodes: string[] = []
          let empty = 0
          walkTree(tree, (n, path) => {
            if (DATA_KINDS.includes(n.kind)) {
              nodes.push(path)
              if (!(Array.isArray(data[path]) && (data[path] as unknown[]).length)) empty++
            }
          })
          if (nodes.length && empty === nodes.length && countContent(tree) === 0) out.push({ severity: 'error', code: 'empty_block', blockId: b.id, message: `"${p.label}" finds nothing in your store.`, fixable: true })
          else if (empty) out.push({ severity: 'warn', code: 'empty_data', blockId: b.id, message: `${empty} part(s) of "${p.label}" find nothing in your store.`, fixable: false })
          walkTree(tree, (n, path) => {
            if ((n.kind === 'products' || n.kind === 'categories') && n.cols.web_mobile > 2) out.push({ severity: 'warn', code: 'phone_dense', blockId: `${b.id}#${path}`, message: `"${p.label}" shows ${n.cols.web_mobile} cards across a phone; two is the most that stays readable.`, fixable: true })
          })
        }
      }
      // Free layers placed on phones (base classes) that run past the section's edges.
      if (b.type === 'code_section') {
        for (const id of offScreenOnPhones((p.compiled as { ast?: CodeNode } | null)?.ast))
          out.push({ severity: 'warn', code: 'off_screen', blockId: id ? `${b.id}#${id}` : b.id, message: `A freely placed element in "${p.label ?? 'a section'}" sits partly off the screen on phones. Move it inside the section on Phone.`, fixable: false })
      }
      // Pictures.
      if (b.type === 'image_banner' && !p.image) {
        if (!p.heading) out.push({ severity: 'error', code: 'empty_block', blockId: b.id, message: 'A banner has no picture and no words.', fixable: true })
        else out.push({ severity: 'warn', code: 'no_image', blockId: b.id, message: `The banner "${p.heading}" has no picture yet.`, fixable: false })
      }
      if (b.type === 'image_text' && !p.image) out.push({ severity: 'warn', code: 'no_image', blockId: b.id, message: `"${p.heading ?? 'Image with text'}" has no picture yet.`, fixable: false })
      if (b.type === 'image_banner' && p.image && p.heading && p.overlay === 'none') out.push({ severity: 'warn', code: 'busy_image', blockId: b.id, message: `The heading on "${p.heading}" sits on the picture with nothing to keep it readable.`, fixable: true })
      // Text too long for its slot.
      for (const [k, max] of Object.entries(LIMITS)) {
        const v = p[k]
        const limit = b.type === 'image_banner' && k === 'heading' ? BANNER_HEADING : max
        if (typeof v === 'string' && v.length > limit) out.push({ severity: 'warn', code: 'too_long', blockId: b.id, message: `"${v.slice(0, 40)}…" is ${v.length} characters; it may wrap badly on phones.`, fixable: true })
      }
      // The same thing twice.
      const title = String(p.title ?? p.heading ?? '').trim().toLowerCase()
      if (title) {
        if (titles.has(title)) out.push({ severity: 'warn', code: 'repeat', blockId: b.id, message: `Two blocks are both called "${p.title ?? p.heading}".`, fixable: false })
        else titles.set(title, b.id)
      }
      if (b.type === 'product_row') {
        const c = (p.config ?? {}) as Record<string, unknown>
        const key = `${c.source ?? 'featured'}:${c.categorySlug ?? ''}`
        if (rowKeys.has(key)) out.push({ severity: 'warn', code: 'repeat', blockId: b.id, message: 'Two product rows show the same products.', fixable: true })
        else rowKeys.set(key, b.id)
      }
    })
  )
  // Colours: buttons and brand sections put white text on the accent and brand colours.
  const pal = { accent: paletteFrom(theme.accent)[500], primary: paletteFrom(theme.primary)[600] }
  if (contrast(pal.accent, '#ffffff') < 3) out.push({ severity: 'warn', code: 'contrast', message: `White text on your accent colour (${theme.accent}) is hard to read; buttons use it.`, fixable: true })
  if (contrast(pal.primary, '#ffffff') < 3) out.push({ severity: 'warn', code: 'contrast', message: `White text on your brand colour (${theme.primary}) is hard to read.`, fixable: true })
  // Keep the page order stable for the reader.
  const order = new Map(blocks.map((b, i) => [b.id, i]))
  return out.sort((a, b) => (order.get(a.blockId?.split('#')[0] ?? '') ?? 99) - (order.get(b.blockId?.split('#')[0] ?? '') ?? 99))
}

/**
 * Elements placed freely on phones (lib/site/code/free.ts, on the base classes) whose box runs past the section: left
 * or top below 0, or right or bottom past 100%. Their node ids ('' without one). Placed only on wider screens, an
 * element sits in the flow on phones, so it can't fall off.
 */
export function offScreenOnPhones(ast: CodeNode | null | undefined): string[] {
  const out: string[] = []
  const walk = (n: CodeNode | null | undefined) => {
    if (!n || typeof n !== 'object') return
    if (n.t === 'el' || n.t === 'cmp') {
      const c = n.props?.className
      const layer = c && c.k === 'lit' && typeof c.v === 'string' ? freeAt(c.v, 'base') : null
      const r = layer?.rect
      if (r && (r.left < 0 || r.top < 0 || r.left + r.width > 100.5 || (r.height !== undefined && r.top + r.height > 100.5))) out.push(n.id ?? '')
    }
    if (n.t === 'el' || n.t === 'cmp' || n.t === 'frag') n.children?.forEach(walk)
    if (n.t === 'cmp') walk(n.render?.body)
    if (n.t === 'cond') {
      walk(n.then)
      walk(n.else)
    }
    if (n.t === 'each') walk(n.body)
  }
  walk(ast)
  return out
}

function countContent(tree: ComposedNode) {
  let n = 0
  walkTree(tree, x => {
    if (x.kind === 'heading' || x.kind === 'text' || x.kind === 'image') n++
  })
  return n
}

// A darker shade until white text reads (or the darkest shade).
function readable(hex: string, shadeFor: (h: string) => string): string {
  let cur = hex
  for (let i = 0; i < 6 && contrast(shadeFor(cur), '#ffffff') < 3; i++) cur = paletteFrom(cur)[700]
  return cur
}

/** Shorter versions of the texts that are too long, in one AI call. */
async function shorten(items: { id: string; key: string; value: string; max: number }[]): Promise<Map<string, string>> {
  if (!items.length) return new Map()
  const r = await aiChat({
    feature: 'site_builder',
    modelHint: 'copy',
    maxTokens: 1200,
    jsonMode: true,
    temperature: 0.3,
    noCache: true,
    messages: [
      { role: 'system', content: 'Shorten each text for a store web page, keeping its meaning and voice. Stay under each max length. Indian English, no emoji. Return JSON {"<id>": "shorter text"}.' },
      { role: 'user', content: JSON.stringify(Object.fromEntries(items.map(i => [`${i.id}|${i.key}`, { text: i.value, max: i.max }]))) },
    ],
  }).catch(() => null)
  const out = r ? parseAiJson<Record<string, unknown>>(r.content) : null
  const map = new Map<string, string>()
  for (const i of items) {
    const v = out?.[`${i.id}|${i.key}`]
    if (typeof v === 'string' && v.trim() && v.length <= i.max) map.set(`${i.id}|${i.key}`, v.trim())
  }
  return map
}

/** The page with every fixable finding fixed, and the theme if a colour had to change. */
export async function fixPage(doc: PageDoc, findings: Finding[], theme: ThemeTokens): Promise<{ doc: PageDoc; theme: ThemeTokens | null; fixed: number }> {
  const next: PageDoc = { ...doc, blocks: { ...doc.blocks }, order: [...doc.order] }
  let fixed = 0
  const remove = (id: string) => {
    next.order = next.order.filter(x => x !== id)
    delete next.blocks[id]
    fixed++
  }
  const long: { id: string; key: string; value: string; max: number }[] = []
  for (const f of findings.filter(x => x.fixable && x.blockId)) {
    const [id, path] = f.blockId!.split('#')
    const b = next.blocks[id]
    if (!b) continue
    if (f.code === 'empty_data' && isSectionBlock(b.type)) remove(id)
    else if (f.code === 'empty_block') remove(id)
    else if (f.code === 'repeat' && b.type === 'product_row') remove(id)
    else if (f.code === 'busy_image') {
      next.blocks[id] = { ...b, props: { ...b.props, overlay: 'dark' } }
      fixed++
    } else if (f.code === 'phone_dense' && path) {
      const tree = cleanTree(b.props.tree).tree
      if (tree) {
        next.blocks[id] = { ...b, props: { ...b.props, tree: updateNode(tree, path, n => ({ ...n, cols: { ...(n as { cols: object }).cols, web_mobile: 2 } }) as ComposedNode) } }
        fixed++
      }
    } else if (f.code === 'too_long') {
      for (const [k, max] of Object.entries(LIMITS)) {
        const v = b.props[k]
        const limit = b.type === 'image_banner' && k === 'heading' ? BANNER_HEADING : max
        if (typeof v === 'string' && v.length > limit && !long.some(l => l.id === id && l.key === k)) long.push({ id, key: k, value: v, max: limit })
      }
    }
  }
  const short = await shorten(long)
  for (const l of long) {
    const v = short.get(`${l.id}|${l.key}`)
    const b = next.blocks[l.id]
    if (v && b) {
      next.blocks[l.id] = { ...b, props: { ...b.props, [l.key]: v } }
      fixed++
    }
  }
  // Colours.
  let newTheme: ThemeTokens | null = null
  if (findings.some(f => f.code === 'contrast')) {
    const accent = readable(theme.accent, h => paletteFrom(h)[500])
    const primary = readable(theme.primary, h => paletteFrom(h)[600])
    if (accent !== theme.accent || primary !== theme.primary) {
      newTheme = normalizeTheme({ ...theme, accent, primary })
      fixed++
    }
  }
  return { doc: next, theme: newTheme, fixed }
}

export interface CritiqueReport {
  pages: Record<string, { found: number; fixed: number; left: Finding[] }>
  found: number
  fixed: number
}

/** Checks every page of a draft and fixes what it can (two rounds at most); the theme is fixed once. */
export async function critiqueDraft(draftId: string, opts: { audience?: 'store' | 'business'; fix?: boolean } = {}): Promise<CritiqueReport> {
  const draft = await getSiteDraft(draftId)
  const report: CritiqueReport = { pages: {}, found: 0, fixed: 0 }
  if (!draft) return report
  const audience = opts.audience ?? 'store'
  let theme = normalizeTheme(draft.docs.theme?.[audience] ?? {})
  let themeChanged = false
  for (const [key, original] of Object.entries(draft.docs.pages ?? {})) {
    const ref = parsePageRefKey(key)
    if (!ref || ref.audience !== audience) continue
    let doc = original
    let first: Finding[] | null = null
    let fixed = 0
    let left: Finding[] = []
    // Up to two fixing rounds, then a last look at what is left.
    for (let round = 0; ; round++) {
      // Colour is a site-wide finding: counted on the first page only.
      left = (await critiquePage(doc, ref, theme)).filter(f => f.code !== 'contrast' || (!themeChanged && Object.keys(report.pages).length === 0))
      first ??= left
      if (!opts.fix || round >= 2 || !left.some(f => f.fixable)) break
      const r = await fixPage(doc, left, theme)
      if (!r.fixed) break
      doc = r.doc
      fixed += r.fixed
      if (r.theme) {
        theme = r.theme
        themeChanged = true
      }
    }
    if (opts.fix && doc !== original) await saveDraftPage(draftId, ref, doc, null).catch(() => null)
    report.pages[key] = { found: first?.length ?? 0, fixed, left }
    report.found += first?.length ?? 0
    report.fixed += fixed
  }
  if (opts.fix && themeChanged) await saveDraftTheme(draftId, audience, theme, null).catch(() => null)
  return report
}
