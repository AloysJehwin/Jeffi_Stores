import { randomUUID } from 'crypto'
import { normalizeDoc, validateDoc, type Block, type PageDoc, type PageKey } from '@jeffi/site-blocks'
import { siteRegistry } from '../blocks'
import { CODE_SECTION, checkPageParts, compileSection, type CompiledSection } from '../code/compile'
import { studioPageOf } from '../studio/showcase'
import type { StudioPlan } from '../studio/types'
import { SHOWCASE_TEMPLATES, STORE_TEMPLATES } from './templates/index'
import { THEME_STYLES, isThemeStyle, type ThemeAvailable, type ThemeStyleId } from './catalog'

// A ready-made theme's pages: the JSON a style's templates were generated into (templates/<style>.json for a store,
// templates/showcase-<style>.json for a Showcase), turned into studio page docs. Templates hold only each section's
// source: it is compiled here against today's code engine (once per process, then reused), and every use gets fresh
// block ids. A missing or incomplete template makes its style unavailable, never broken.

export type ThemeProduct = 'store' | 'showcase'

export interface TemplateSection {
  label: string
  source: string
}

export interface TemplatePage {
  label: string
  sections: TemplateSection[]
}

/** templates/<style>.json */
export interface ThemeTemplateFile {
  version: 1
  style: ThemeStyleId
  product: ThemeProduct
  generatedAt: string
  /** The plan the pages were written from (their sections' intents, for "design this page again"). */
  plan?: StudioPlan | null
  /** By studio key: `store:home`, `store:card`, `showcase:home`. */
  pages: Record<string, TemplatePage>
}

/** What a store theme cannot do without; the other pages fall back to the listing's design or the built-in page. */
export const STORE_CORE_PAGES = ['store:home', 'store:header', 'store:footer', 'store:products', 'store:product', 'store:cart', 'store:checkout']
export const SHOWCASE_HOME = 'showcase:home'

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

function readPage(raw: unknown): TemplatePage | null {
  if (!isObj(raw) || !Array.isArray(raw.sections)) return null
  const sections = raw.sections
    .filter(isObj)
    .map(s => ({ label: typeof s.label === 'string' && s.label.trim() ? s.label.trim().slice(0, 80) : 'Section', source: typeof s.source === 'string' ? s.source : '' }))
    .filter(s => s.source.trim())
  return sections.length ? { label: typeof raw.label === 'string' ? raw.label : '', sections } : null
}

const files = new Map<string, ThemeTemplateFile | null>()

/** A style's template for a product, read and checked once; null when there is none (or it is malformed). */
export function templateFile(style: ThemeStyleId, product: ThemeProduct): ThemeTemplateFile | null {
  const key = `${product}:${style}`
  if (files.has(key)) return files.get(key)!
  const raw = (product === 'showcase' ? SHOWCASE_TEMPLATES : STORE_TEMPLATES)[style]
  let file: ThemeTemplateFile | null = null
  if (isObj(raw) && isObj(raw.pages)) {
    const pages = Object.fromEntries(
      Object.entries(raw.pages)
        .filter(([k]) => (product === 'showcase' ? k === SHOWCASE_HOME : k.startsWith('store:') && !!studioPageOf(k)))
        .map(([k, v]) => [k, readPage(v)] as const)
        .filter((e): e is readonly [string, TemplatePage] => !!e[1])
    )
    file = {
      version: 1,
      style,
      product,
      generatedAt: typeof raw.generatedAt === 'string' ? raw.generatedAt : '',
      plan: isObj(raw.plan) && Array.isArray(raw.plan.pages) ? (raw.plan as unknown as StudioPlan) : null,
      pages,
    }
  }
  files.set(key, file)
  return file
}

/** The style can be applied: its template has every page the product cannot do without. */
export function templateReady(style: ThemeStyleId, product: ThemeProduct): boolean {
  const f = templateFile(style, product)
  return !!f && (product === 'showcase' ? [SHOWCASE_HOME] : STORE_CORE_PAGES).every(k => !!f.pages[k])
}

/** The styles that can be applied for a product, with the pages each brings (as Site Builder page keys). */
export function themeAvailability(product: ThemeProduct): ThemeAvailable {
  return Object.fromEntries(
    THEME_STYLES.filter(s => templateReady(s, product)).map(s => {
      const keys = Object.keys(templateFile(s, product)!.pages)
      return [s, { pages: keys.length, keys: keys.map(k => (k === SHOWCASE_HOME ? 'showcase' : studioPageOf(k))).filter((k): k is PageKey => !!k) }]
    })
  )
}

// Compiled sections by page and source: the same template compiles the same way, whatever palette or store wears it.
const compiled = new Map<string, Promise<CompiledSection | null>>()

function compileOnce(source: string, page: PageKey): Promise<CompiledSection | null> {
  const key = `${page}\u0000${source}`
  let hit = compiled.get(key)
  if (!hit) {
    hit = compileSection(source, { page })
      .then(r => {
        if (!r.ok) console.warn(`[themes] a ${page} section no longer compiles:`, r.issues[0]?.message)
        return r.ok ? r.section : null
      })
      .catch(err => {
        console.warn('[themes] compile failed:', (err as Error).message)
        compiled.delete(key)
        return null
      })
    compiled.set(key, hit)
  }
  return hit
}

/** One template page as a fresh studio page doc (null when none of its sections compiles). */
async function pageDoc(key: string, page: TemplatePage): Promise<PageDoc | null> {
  const at = key === SHOWCASE_HOME ? 'showcase' : studioPageOf(key)
  if (!at) return null
  const v = siteRegistry.get(CODE_SECTION)?.v ?? 1
  const blocks: Block[] = []
  for (const s of page.sections) {
    const c = await compileOnce(s.source, at)
    if (c) blocks.push({ id: randomUUID(), type: CODE_SECTION, v, props: { label: s.label, source: s.source, compiled: structuredClone(c) } })
  }
  if (!blocks.length) return null
  const doc = normalizeDoc({ blocks: Object.fromEntries(blocks.map(b => [b.id, b])), order: blocks.map(b => b.id) })
  // A page that lost a part it needs (the payment step, add to cart) is left out: the store's own page stands in.
  const missing = checkPageParts(doc, at, null)
  if (missing.length) {
    console.warn(`[themes] ${key} left out:`, missing[0].message)
    return null
  }
  return validateDoc(doc, siteRegistry, { audience: 'store', surface: 'web', page: at }).doc
}

/**
 * A style's pages for a product as studio page docs by key (`store:home`…), each with fresh block ids; `keys` limits
 * them (a preview needs only the page shown and the chrome). Null when the style is not ready.
 */
export async function themePages(style: unknown, product: ThemeProduct, keys?: string[]): Promise<Record<string, PageDoc> | null> {
  if (!isThemeStyle(style) || !templateReady(style, product)) return null
  const f = templateFile(style, product)!
  const out: Record<string, PageDoc> = {}
  for (const [key, page] of Object.entries(f.pages)) {
    if (keys && !keys.includes(key)) continue
    const doc = await pageDoc(key, page)
    if (doc?.order.length) out[key] = doc
  }
  return out
}
