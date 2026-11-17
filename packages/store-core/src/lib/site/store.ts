import type { PoolClient } from 'pg'
import {
  emptyDoc,
  mergeDocs,
  normalizeDoc,
  normalizeTheme,
  pageRefKey,
  parsePageRefKey,
  surfaceAllows,
  type PageDoc,
  type PageRef,
  type SiteAudience,
  type SiteSurface,
  type ThemeTokens,
  validateDoc,
} from '@jeffi/site-blocks'
import { queryMany, queryOne, withTransaction } from '@/lib/shared/db'
import { tenantCacheKey } from '@/lib/catalog/site-controls'
import {
  AUDIENCE_COLUMN_SQL,
  PAGE_COLUMN_SQL,
  SURFACE_COLUMN_SQL,
} from '@/lib/catalog/homepage-data'
import {
  HOMEPAGE_AUDIENCES,
  HOMEPAGE_PAGES,
  HOMEPAGE_SURFACES,
  rowAudience,
  rowPage,
  rowSurface,
  withDefaults,
  type HomepagePage,
  type HomepageSection,
} from '@/lib/catalog/homepage-sections'
import type { HeroSlide } from '@/lib/catalog/hero-slides'
import type { HomepageDraftState } from '@/lib/catalog/homepage-draft'
import { siteRegistry } from './blocks'
import { CodeSectionInvalid, recompileCodeSections } from './code/compile'
import { DEFAULT_FOOTER_COLUMNS, DEFAULT_NAV } from './chrome-types'
import { docToRows, sectionsToDoc } from './legacy'
import { isListingKey, listingBetweenDoc } from './listing'

// Site Builder storage: published documents per layout (site_pages), the theme (site_theme), drafts (site_drafts) and
// history (site_versions). While a store's `site_builder_enabled` setting is off, or nothing has been imported yet,
// every page keeps rendering from the homepage tables.

const FLAG_KEY = 'site_builder_enabled'
const TTL_MS = 15_000
const KEEP_VERSIONS = 20

type Cached<T> = { at: number; value: T }
const flagCache = new Map<string, Cached<boolean>>()
const pageCache = new Map<string, Cached<PublishedRow[]>>()
const themeCache = new Map<string, Cached<ThemeTokens | null>>()

async function cached<T>(map: Map<string, Cached<T>>, key: string, load: () => Promise<T>): Promise<T> {
  const k = `${await tenantCacheKey()}:${key}`
  const hit = map.get(k)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value
  const value = await load()
  map.set(k, { at: Date.now(), value })
  return value
}

export function invalidateSiteCache() {
  flagCache.clear()
  pageCache.clear()
  themeCache.clear()
}

// ── Flag ──────────────────────────────────────────────────────────────────────────────────────────

export async function siteBuilderEnabled(): Promise<boolean> {
  return cached(flagCache, 'flag', async () => {
    const row = await queryOne<{ value: string | null }>(`SELECT value FROM site_settings WHERE key = $1`, [FLAG_KEY]).catch(() => null)
    return row?.value === 'true'
  })
}

/** Who switched it is in the admin audit log (site_settings.updated_by points at users, not admins). */
export async function setSiteBuilderEnabled(on: boolean): Promise<void> {
  await queryOne(
    `INSERT INTO site_settings (key, value, data_type, description, updated_at)
     VALUES ($1, $2, 'boolean', 'Render customer pages from Site Builder documents', now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [FLAG_KEY, on ? 'true' : 'false']
  )
  invalidateSiteCache()
}

// ── Published documents ───────────────────────────────────────────────────────────────────────────

interface PublishedRow {
  audience: SiteAudience
  surface: SiteSurface
  page_key: string
  slug: string
  published_doc: PageDoc
  version: number
  title: string | null
}

const publishedOn = (surface: SiteSurface) =>
  cached(pageCache, `pages:${surface}`, () =>
    queryMany<PublishedRow>(
      `SELECT audience, surface, page_key, slug, published_doc, version, title FROM site_pages WHERE surface = $1`,
      [surface]
    ).catch(() => [])
  )

export async function getPublishedPage(ref: PageRef): Promise<{ doc: PageDoc; version: number; title: string | null } | null> {
  const row = (await publishedOn(ref.surface)).find(
    r => r.audience === ref.audience && r.page_key === ref.page && r.slug === (ref.slug ?? '')
  )
  return row ? { doc: normalizeDoc(row.published_doc), version: row.version, title: row.title ?? null } : null
}

/** Custom pages (`/p/<slug>`) that have a published layout, for the editor's page picker. */
export function listCustomPages(): Promise<{ slug: string; title: string | null }[]> {
  return queryMany<{ slug: string; title: string | null }>(
    `SELECT DISTINCT ON (slug) slug, title FROM site_pages WHERE page_key = 'custom' AND slug <> '' ORDER BY slug`
  ).catch(() => [])
}

/**
 * The homepage-pipeline rows for one surface (every homepage page, both audiences) from its published documents, or
 * null while Site Builder is off or nothing is imported yet (the caller then reads the homepage tables).
 */
export async function siteLayoutState(surface: SiteSurface): Promise<HomepageDraftState | null> {
  if (!(await siteBuilderEnabled())) return null
  const rows = await publishedOn(surface)
  if (rows.length === 0) return null
  return docsToState(rows.map(r => ({ ref: { audience: r.audience, surface: r.surface, page: r.page_key as PageRef['page'], slug: r.slug }, doc: r.published_doc })))
}

function docsToState(docs: { ref: PageRef; doc: PageDoc }[]): HomepageDraftState {
  const state: HomepageDraftState = { sections: [], heroSlides: [] }
  for (const { ref, doc } of docs) {
    if (ref.slug || !HOMEPAGE_PAGES.includes(ref.page as HomepagePage)) continue
    const part = docToRows(isListingKey(ref.page) ? listingBetweenDoc(doc) : doc, { audience: ref.audience, surface: ref.surface, page: ref.page as HomepagePage })
    state.sections.push(...part.sections)
    if (ref.page === 'home') state.heroSlides.push(...part.heroSlides)
  }
  return state
}

/** A draft's documents over the published ones, as homepage-pipeline rows for one surface (preview). */
export async function siteDraftState(draftId: string, surface: SiteSurface): Promise<HomepageDraftState | null> {
  const draft = await getSiteDraft(draftId)
  if (!draft) return null
  const docs = new Map<string, { ref: PageRef; doc: PageDoc }>()
  for (const r of await queryMany<PublishedRow>(`SELECT audience, surface, page_key, slug, published_doc, version FROM site_pages WHERE surface = $1`, [surface])) {
    const ref = { audience: r.audience, surface: r.surface, page: r.page_key as PageRef['page'], slug: r.slug }
    docs.set(pageRefKey(ref), { ref, doc: r.published_doc })
  }
  for (const [key, doc] of Object.entries(draft.docs.pages ?? {})) {
    const ref = parsePageRefKey(key)
    if (ref && ref.surface === surface) docs.set(key, { ref, doc })
  }
  return docsToState([...docs.values()])
}

// ── Theme ─────────────────────────────────────────────────────────────────────────────────────────

/** The published theme, or null when the store has none (the built-in look applies). */
export async function getPublishedTheme(audience: SiteAudience = 'store'): Promise<ThemeTokens | null> {
  if (!(await siteBuilderEnabled())) return null
  return cached(themeCache, `theme:${audience}`, async () => {
    const row = await queryOne<{ tokens: Partial<ThemeTokens> }>(`SELECT tokens FROM site_theme WHERE audience = $1`, [audience]).catch(() => null)
    return row ? normalizeTheme(row.tokens) : null
  })
}

// ── Import from the homepage tables ───────────────────────────────────────────────────────────────

/**
 * Writes a published document for every layout the homepage tables have (the store homepage of a surface with no
 * sections gets the built-in layout), skipping layouts that already have one. Returns how many were created.
 */
export async function importLegacyLayouts(adminId: string | null): Promise<number> {
  const sections = await queryMany<HomepageSection>(
    `SELECT id, type, title, subtitle, eyebrow, cta_label, cta_url, config, display_order, is_active, starts_at, ends_at,
            created_at, ${SURFACE_COLUMN_SQL('s')}, ${PAGE_COLUMN_SQL('s')}, ${AUDIENCE_COLUMN_SQL('s')}
       FROM homepage_sections s`
  )
  const slides = await queryMany<HeroSlide>(
    `SELECT h.*, ${SURFACE_COLUMN_SQL('h')}, ${AUDIENCE_COLUMN_SQL('h')} FROM hero_slides h`
  )
  let created = 0
  await withTransaction(async client => {
    for (const audience of HOMEPAGE_AUDIENCES) {
      for (const surface of HOMEPAGE_SURFACES) {
        for (const page of HOMEPAGE_PAGES) {
          if (audience === 'business' && page !== 'home') continue
          if (!surfaceAllows(surface, page)) continue
          const own = sections.filter(s => rowAudience(s) === audience && rowSurface(s) === surface && rowPage(s) === page)
          const rows = audience === 'store' && page === 'home' ? withDefaults(own) : own
          if (rows.length === 0) continue
          const layoutSlides = page === 'home' ? slides.filter(s => rowAudience(s) === audience && rowSurface(s) === surface) : []
          // Kept whole, not validated against today's page rules: every section was allowed when it was added.
          const doc = sectionsToDoc(rows, layoutSlides)
          const ref: PageRef = { audience, surface, page, slug: '' }
          const r = await client.query(
            `INSERT INTO site_pages (audience, surface, page_key, slug, published_doc, version, published_by)
             VALUES ($1, $2, $3, '', $4, 1, $5)
             ON CONFLICT (audience, surface, page_key, slug) DO NOTHING`,
            [audience, surface, page, JSON.stringify(doc), adminId]
          )
          if (r.rowCount) {
            created++
            await recordVersion(client, 'page', pageRefKey(ref), 1, doc, adminId)
          }
        }
      }
      // The site-wide header and footer start as today's built-in links (business pages share the store's).
      if (audience === 'store') {
        for (const surface of ['web', 'web_mobile'] as const) {
          const chrome: [PageRef['page'], PageDoc][] = [
            ['header', chromeDoc([{ type: 'nav_links', props: { links: DEFAULT_NAV } }])],
            ['footer', chromeDoc(DEFAULT_FOOTER_COLUMNS.map(c => ({ type: 'footer_column', props: c })))],
          ]
          for (const [page, doc] of chrome) {
            const r = await client.query(
              `INSERT INTO site_pages (audience, surface, page_key, slug, published_doc, version, published_by)
               VALUES ('store', $1, $2, '', $3, 1, $4) ON CONFLICT (audience, surface, page_key, slug) DO NOTHING`,
              [surface, page, JSON.stringify(doc), adminId]
            )
            if (r.rowCount) {
              created++
              await recordVersion(client, 'page', pageRefKey({ audience: 'store', surface, page, slug: '' }), 1, doc, adminId)
            }
          }
        }
      }
    }
  })
  invalidateSiteCache()
  return created
}

function chromeDoc(blocks: { type: string; props: Record<string, unknown> }[]): PageDoc {
  const withIds = blocks.map(b => ({ ...b, id: crypto.randomUUID(), v: 1 }))
  return normalizeDoc({ blocks: Object.fromEntries(withIds.map(b => [b.id, b])), order: withIds.map(b => b.id) })
}

// ── Drafts ────────────────────────────────────────────────────────────────────────────────────────

export interface SiteDraftDocs {
  pages?: Record<string, PageDoc>
  theme?: Partial<Record<SiteAudience, Partial<ThemeTokens>>>
}
interface SiteDraftBase {
  pages?: Record<string, { version: number; doc: PageDoc }>
  theme?: Partial<Record<SiteAudience, { version: number; tokens: Partial<ThemeTokens> }>>
}
export interface SiteDraft {
  id: string
  title: string | null
  author_admin_id: string | null
  docs: SiteDraftDocs
  base: SiteDraftBase
  updated_at: string
}

export class SiteDocInvalid extends Error {
  constructor(readonly issues: { blockId?: string; message: string }[]) {
    super(issues[0]?.message ?? 'Invalid page')
  }
}

export async function createSiteDraft(adminId: string | null, title?: string | null): Promise<string> {
  const row = await queryOne<{ id: string }>(
    `INSERT INTO site_drafts (title, author_admin_id, updated_by) VALUES ($1, $2, $2) RETURNING id`,
    [title?.trim() || null, adminId]
  )
  return row!.id
}

export function getSiteDraft(id: string): Promise<SiteDraft | null> {
  return queryOne<SiteDraft>(`SELECT id, title, author_admin_id, docs, base, updated_at FROM site_drafts WHERE id = $1`, [id])
}

export async function listSiteDrafts(): Promise<Pick<SiteDraft, 'id' | 'title' | 'author_admin_id' | 'updated_at'>[]> {
  return queryMany(`SELECT id, title, author_admin_id, updated_at FROM site_drafts ORDER BY updated_at DESC`)
}

/** Saves one page's document into the draft (validated); the first save records the published version it starts from. */
export async function saveDraftPage(draftId: string, ref: PageRef, input: unknown, adminId: string | null): Promise<PageDoc> {
  if (!surfaceAllows(ref.surface, ref.page)) throw new SiteDocInvalid([{ message: 'That page has no layout on this surface' }])
  const result = validateDoc(input, siteRegistry, ref)
  if (!result.ok) throw new SiteDocInvalid(result.issues)
  const doc = await recompileCodeSections(result.doc, { page: ref.page }).catch(e => {
    throw e instanceof CodeSectionInvalid ? new SiteDocInvalid(e.issues) : e
  })
  const key = pageRefKey(ref)
  const live = await getLivePage(ref)
  const r = await queryOne<{ id: string }>(
    `UPDATE site_drafts
        SET docs = jsonb_set(jsonb_set(docs, '{pages}', COALESCE(docs -> 'pages', '{}'::jsonb)), ARRAY['pages', $2], $3::jsonb),
            base = CASE WHEN base -> 'pages' ? $2 THEN base
                        ELSE jsonb_set(jsonb_set(base, '{pages}', COALESCE(base -> 'pages', '{}'::jsonb)), ARRAY['pages', $2], $4::jsonb) END,
            updated_by = $5, updated_at = now()
      WHERE id = $1 RETURNING id`,
    [draftId, key, JSON.stringify(doc), JSON.stringify({ version: live?.version ?? 0, doc: live?.doc ?? emptyDoc() }), adminId]
  )
  if (!r) throw new Error('Draft not found')
  return doc
}

export async function saveDraftTheme(draftId: string, audience: SiteAudience, tokens: Partial<ThemeTokens>, adminId: string | null) {
  const clean = normalizeTheme(tokens)
  const live = await queryOne<{ tokens: Partial<ThemeTokens>; version: number }>(`SELECT tokens, version FROM site_theme WHERE audience = $1`, [audience])
  const r = await queryOne(
    `UPDATE site_drafts
        SET docs = jsonb_set(jsonb_set(docs, '{theme}', COALESCE(docs -> 'theme', '{}'::jsonb)), ARRAY['theme', $2], $3::jsonb),
            base = CASE WHEN base -> 'theme' ? $2 THEN base
                        ELSE jsonb_set(jsonb_set(base, '{theme}', COALESCE(base -> 'theme', '{}'::jsonb)), ARRAY['theme', $2], $4::jsonb) END,
            updated_by = $5, updated_at = now()
      WHERE id = $1 RETURNING id`,
    [draftId, audience, JSON.stringify(clean), JSON.stringify({ version: live?.version ?? 0, tokens: live?.tokens ?? {} }), adminId]
  )
  if (!r) throw new Error('Draft not found')
  return clean
}

export async function discardSiteDraft(id: string): Promise<boolean> {
  const r = await queryOne<{ id: string }>(`DELETE FROM site_drafts WHERE id = $1 RETURNING id`, [id])
  return !!r
}

async function getLivePage(ref: PageRef, client?: PoolClient): Promise<{ doc: PageDoc; version: number } | null> {
  const sql = `SELECT published_doc, version FROM site_pages WHERE audience = $1 AND surface = $2 AND page_key = $3 AND slug = $4${client ? ' FOR UPDATE' : ''}`
  const params = [ref.audience, ref.surface, ref.page, ref.slug ?? '']
  const row = client
    ? (await client.query<{ published_doc: PageDoc; version: number }>(sql, params)).rows[0]
    : await queryOne<{ published_doc: PageDoc; version: number }>(sql, params)
  return row ? { doc: normalizeDoc(row.published_doc), version: row.version } : null
}

async function recordVersion(client: PoolClient, target: 'page' | 'theme', key: string, version: number, doc: unknown, adminId: string | null) {
  await client.query(
    `INSERT INTO site_versions (target, target_key, version, doc, published_by) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (target, target_key, version) DO NOTHING`,
    [target, key, version, JSON.stringify(doc), adminId]
  )
  await client.query(
    `DELETE FROM site_versions WHERE target = $1 AND target_key = $2 AND version <= $3`,
    [target, key, version - KEEP_VERSIONS]
  )
}

const titleFromSlug = (slug: string) => slug.split('-').filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(' ')

async function writePage(client: PoolClient, ref: PageRef, doc: PageDoc, version: number, adminId: string | null) {
  await client.query(
    `INSERT INTO site_pages (audience, surface, page_key, slug, published_doc, version, published_at, published_by, title)
     VALUES ($1, $2, $3, $4, $5, $6, now(), $7, $8)
     ON CONFLICT (audience, surface, page_key, slug)
     DO UPDATE SET published_doc = EXCLUDED.published_doc, version = EXCLUDED.version, published_at = now(),
                   published_by = EXCLUDED.published_by, title = COALESCE(site_pages.title, EXCLUDED.title), updated_at = now()`,
    [ref.audience, ref.surface, ref.page, ref.slug ?? '', JSON.stringify(doc), version, adminId, ref.slug ? titleFromSlug(ref.slug) : null]
  )
  await recordVersion(client, 'page', pageRefKey(ref), version, doc, adminId)
}

/**
 * Publishes every page and theme in the draft: each page is merged three-way (the version the draft started from,
 * live now, the draft) so others' publishes since are kept, then the draft is deleted. Returns the pages written and
 * the blocks both sides changed (the draft's version won).
 */
export async function publishSiteDraft(draftId: string, adminId: string | null) {
  const result = await withTransaction(async client => {
    const draft = (await client.query<SiteDraft>(`SELECT * FROM site_drafts WHERE id = $1 FOR UPDATE`, [draftId])).rows[0]
    if (!draft) return null
    const pages: string[] = []
    const conflicts: Record<string, string[]> = {}
    for (const [key, draftDoc] of Object.entries(draft.docs.pages ?? {})) {
      const ref = parsePageRefKey(key)
      if (!ref) continue
      const live = await getLivePage(ref, client)
      const base = draft.base.pages?.[key]?.doc ?? emptyDoc()
      const merged = mergeDocs(normalizeDoc(base), live?.doc ?? emptyDoc(), normalizeDoc(draftDoc))
      if (merged.conflicts.length) conflicts[key] = merged.conflicts
      await writePage(client, ref, merged.doc, (live?.version ?? 0) + 1, adminId)
      pages.push(key)
    }
    for (const [audience, tokens] of Object.entries(draft.docs.theme ?? {})) {
      const clean = normalizeTheme(tokens)
      const live = (await client.query<{ version: number }>(`SELECT version FROM site_theme WHERE audience = $1 FOR UPDATE`, [audience])).rows[0]
      const version = (live?.version ?? 0) + 1
      await client.query(
        `INSERT INTO site_theme (audience, tokens, version, published_at, published_by, updated_at) VALUES ($1, $2, $3, now(), $4, now())
         ON CONFLICT (audience) DO UPDATE SET tokens = EXCLUDED.tokens, version = EXCLUDED.version, published_at = now(),
                                             published_by = EXCLUDED.published_by, updated_at = now()`,
        [audience, JSON.stringify(clean), version, adminId]
      )
      await recordVersion(client, 'theme', audience, version, clean, adminId)
    }
    await client.query(`DELETE FROM site_drafts WHERE id = $1`, [draftId])
    return { pages, conflicts, theme: Object.keys(draft.docs.theme ?? {}) }
  })
  invalidateSiteCache()
  return result
}

export function listPageVersions(ref: PageRef) {
  return queryMany<{ version: number; published_at: string; published_by: string | null }>(
    `SELECT version, published_at, published_by FROM site_versions WHERE target = 'page' AND target_key = $1 ORDER BY version DESC`,
    [pageRefKey(ref)]
  )
}

/** Republishes an earlier version of a page as its newest version. */
export async function rollbackPage(ref: PageRef, version: number, adminId: string | null): Promise<number | null> {
  const next = await withTransaction(async client => {
    const old = (
      await client.query<{ doc: PageDoc }>(`SELECT doc FROM site_versions WHERE target = 'page' AND target_key = $1 AND version = $2`, [pageRefKey(ref), version])
    ).rows[0]
    if (!old) return null
    const live = await getLivePage(ref, client)
    const v = (live?.version ?? 0) + 1
    await writePage(client, ref, normalizeDoc(old.doc), v, adminId)
    return v
  })
  invalidateSiteCache()
  return next
}
