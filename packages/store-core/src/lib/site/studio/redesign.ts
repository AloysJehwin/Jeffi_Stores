import { randomUUID } from 'crypto'
import { googleFontsHref, normalizeTheme, type PageDoc, type PageKey, type SiteAudience, type SiteSurface, type ThemeTokens } from '@jeffi/site-blocks'
import { query, queryMany, queryOne } from '@/lib/shared/db'
import { metered, runMetered } from '@/lib/ai/cost-meter'
import { storeDescriptorForPrompt } from '@/lib/catalog/brand'
import { getBusinessValues, getStorefrontContent, getStoreIdentity } from '@/lib/catalog/site-controls'
import { CARD_PAGE } from '../code/ast'
import { CARD_KEY } from '../card'
import { createSiteDraft, getPublishedTheme, saveDraftPage, saveDraftTheme } from '../store'
import { AI_UNAVAILABLE_CODE, AI_UNAVAILABLE_MESSAGE } from '../ai-status'
import { newSeed, StudioAiDownError, StudioBudgetError, STUDIO_BUDGET_INR, studioBudgetLeft } from './ai'
import { brief as writeBrief, cleanAnswers, readRefs } from './brief'
import { getStudioContext, type StoredStudioContext } from './context'
import { directions, shuffleColours } from './directions'
import { generateCard, generatePage, regeneratePage } from './generate'
import { parseStudioKey } from './install'
import { buildOrder } from './order'
import { APPROACHES, plan as planSite, specPage } from './plan'
import { UI_STYLES, uiStyle, type UiStyle, type UiStyleId } from './ui-styles'
import type { DesignDirection, PlannedPage, StudioBrief, StudioCtx, StudioPlan, StudioTheme } from './types'

// Site Builder's "Redesign my whole site with AI" and "Design this page again": the AI Site Studio's pipeline for a
// live store. The brief is the studio's (kept with the site at install, refreshed with today's details) or one written
// from the store's settings and catalogue; the design direction is the site's own, or a UI style the owner picks, with
// a site they like and their colours or new ones. A fresh plan, the product card and every page are written section by
// section into a new Site Builder draft, desktop and phone alike as install does; nothing is live until published. The
// data parts read the store's real catalogue and its photos stay (no sample catalogue, no pictures). The brief, plan and
// direction sit on the draft (docs.studio) for its later AI changes and for publishing. Progress and a page's redo each
// have a small site_settings row of their own (the draft's docs hold every page, too big to rewrite every few seconds)
// for the admin to poll and pick up after a refresh; one build runs per store at a time (the lock row).

/** No progress for this long: the build died with its process (a deploy, a restart). */
export const STALE_MS = 10 * 60_000
const STALE_SQL = `interval '10 minutes'`
const LOCK_KEY = 'site_studio_redesign'
const LOCK_NOTE = 'The AI site redesign running for this store: run id and draft (taken over once quiet for 10 minutes)'
const progressKey = (draftId: string) => `site_redesign:${draftId}`
const redoKey = (draftId: string) => `site_redesign_page:${draftId}`
/** A stopped free build carries on free while this much of its budget (₹ of provider cost) is left. */
const RESUME_MIN_INR = 25
/** Progress inside a page is written at most this often. */
const BEAT_MS = 15_000
/**
 * A page designed again on its own: the most it spends (₹ of provider cost), billed per call like any Site Builder AI.
 * Pages average about ₹30; a home page of eight sections with repairs can take twice that.
 */
export const PAGE_REDO_BUDGET_INR = () => Number(process.env.SITE_PAGE_REDO_BUDGET_INR || 100)
// Business pages share the store's header, footer and announcement bar.
const CHROME = new Set<PageKey>(['header', 'footer', 'announcement'])

export type RedesignDesign = 'keep' | UiStyleId

export interface RedesignInput {
  /** Keep the site's design direction, or one of the studio's UI styles. */
  design: RedesignDesign
  /** A site the owner likes (https), read for a new style's colours, type and layout feel. */
  reference?: string | null
  /** Keep the theme's colours, or new ones (the AI's in a new style, a fresh palette when keeping the design). */
  colours: 'keep' | 'new'
}

export interface RedesignPage {
  key: string
  label: string
  status: 'waiting' | 'building' | 'done' | 'failed' | 'skipped'
  sections?: number
  written?: number
}

/** A redesign's progress (its site_settings row) while and after it builds into its draft. */
export interface RedesignProgress {
  kind: 'studio'
  status: 'running' | 'done' | 'failed'
  step: string
  /** The design direction's name. */
  style?: string
  pages: RedesignPage[]
  note?: string
  error?: string
  code?: string
  /** Free (the store's free generation, or the platform's own store), else charged to the AI wallet. */
  free: boolean
  /** Provider cost (₹) this draft's free builds spent, so a resumed one spends only what is left. */
  spentInr?: number
  startedAt: string
  at: string
  /** Written after the run: lib/site/site-generation.ts. */
  charge?: { free: boolean; chargedInr?: number; capInr?: number }
}

export interface RedesignResult {
  ok: boolean
  built: number
  total: number
  style?: string
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const now = () => new Date().toISOString()
const errText = (err: unknown) => ((err as Error)?.message || 'unknown error').slice(0, 300)
const gone = (err: unknown) => (err as Error)?.message === 'Draft not found'
const styleOf = (input: RedesignInput) => (input.design === 'keep' ? null : uiStyle(input.design))

/** The brief, plan and direction a redesign left on its draft (docs.studio), or null. */
export function draftStudio(s: unknown): StudioCtx | null {
  return isObj(s) && isObj(s.brief) && typeof s.brief.storeName === 'string' && isObj(s.plan) && Array.isArray(s.plan.pages) && isObj(s.direction) && isObj(s.direction.theme)
    ? { brief: s.brief as unknown as StudioBrief, plan: s.plan as unknown as StudioPlan, direction: s.direction as unknown as DesignDirection }
    : null
}

/** The draft's own studio context (a redesign's), for its AI changes; null for any other draft. */
export async function draftStudioContext(draftId: string): Promise<StudioCtx | null> {
  const row = await queryOne<{ studio: unknown }>(`SELECT docs -> 'studio' AS studio FROM site_drafts WHERE id = $1`, [draftId]).catch(() => null)
  return draftStudio(row?.studio)
}

async function saveDraftStudio(draftId: string, ctx: Pick<StudioCtx, 'brief' | 'plan' | 'direction'>): Promise<boolean> {
  const { brief, plan, direction } = ctx
  const r = await queryOne<{ id: string }>(`UPDATE site_drafts SET docs = jsonb_set(docs, '{studio}', $2::jsonb), updated_at = now() WHERE id = $1 RETURNING id`, [draftId, JSON.stringify({ brief, plan, direction })])
  return !!r
}

// A redesign's or a page redo's state row, written only while its draft exists: false when the draft is gone (a failed
// write is not a reason to stop).
async function putState(key: string, draftId: string, json: string): Promise<boolean> {
  const r = await queryOne<{ key: string }>(
    `INSERT INTO site_settings (key, value, data_type, description, updated_at)
     SELECT $1::varchar, $2::text, 'json', 'Site Builder AI progress of one draft', now() WHERE EXISTS (SELECT 1 FROM site_drafts WHERE id = $3)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
     RETURNING key`,
    [key, json, draftId]
  ).catch(() => 'error' as const)
  return r === 'error' || !!r
}

async function readState<T>(key: string): Promise<T | null> {
  const row = await queryOne<{ value: string | null }>(`SELECT value FROM site_settings WHERE key = $1`, [key]).catch(() => null)
  try {
    const v = row?.value ? JSON.parse(row.value) : null
    return isObj(v) ? (v as T) : null
  } catch {
    return null
  }
}

/** The run's charge beside its progress (lib/site/site-generation.ts). */
export async function noteRedesignCharge(draftId: string, charge: NonNullable<RedesignProgress['charge']>): Promise<void> {
  await query(`UPDATE site_settings SET value = jsonb_set(value::jsonb, '{charge}', $2::jsonb)::text, updated_at = now() WHERE key = $1`, [progressKey(draftId), JSON.stringify(charge)])
}

// ── One build per store ───────────────────────────────────────────────────────────────────────────

/** Takes the store's one redesign slot for a run: null while another build holds it (one quiet for STALE_MS is taken over). */
export async function claimRedesign(draftId = ''): Promise<string | null> {
  const run = randomUUID()
  const row = await queryOne<{ value: string }>(
    `INSERT INTO site_settings (key, value, data_type, description, updated_at) VALUES ($1, $2, 'string', $3, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
      WHERE site_settings.updated_at IS NULL OR site_settings.updated_at < now() - ${STALE_SQL}
     RETURNING value`,
    [LOCK_KEY, `${run}:${draftId}`, LOCK_NOTE]
  )
  return row ? run : null
}

export async function bindRedesign(run: string, draftId: string): Promise<void> {
  await query(`UPDATE site_settings SET value = $2, updated_at = now() WHERE key = $1 AND value LIKE $3`, [LOCK_KEY, `${run}:${draftId}`, `${run}:%`])
}

/** The run's heartbeat on the lock: false once another run took the lock over (this one should stop). */
export async function beatRedesign(run: string): Promise<boolean> {
  const row = await queryOne<{ value: string }>(`UPDATE site_settings SET updated_at = now() WHERE key = $1 AND value LIKE $2 RETURNING value`, [LOCK_KEY, `${run}:%`]).catch(() => 'error' as const)
  return row === 'error' || !!row
}

export async function releaseRedesign(run: string): Promise<void> {
  await query(`DELETE FROM site_settings WHERE key = $1 AND value LIKE $2`, [LOCK_KEY, `${run}:%`])
}

/** The store's redesign that is running, or stopped before it finished (its process died), with its progress. */
export async function activeRedesign(): Promise<{ draftId: string; ai: Record<string, unknown> } | null> {
  const row = await queryOne<{ value: string | null }>(`SELECT value FROM site_settings WHERE key = $1`, [LOCK_KEY]).catch(() => null)
  const draftId = row?.value?.split(':')[1]
  if (!draftId) return null
  const ai = await redesignStatus(draftId).catch(() => null)
  return ai ? { draftId, ai } : null
}

/** A new draft for a redesign to fill; the state rows of drafts deleted or published since go. */
export async function startRedesignDraft(adminId: string | null): Promise<string> {
  await query(
    `DELETE FROM site_settings s WHERE (s.key LIKE 'site\\_redesign:%' OR s.key LIKE 'site\\_redesign\\_page:%')
        AND NOT EXISTS (SELECT 1 FROM site_drafts d WHERE d.id::text = split_part(s.key, ':', 2))`
  ).catch(() => {})
  return createSiteDraft(adminId, 'AI redesign (building…)')
}

// ── Status ────────────────────────────────────────────────────────────────────────────────────────

const freeLeft = (p: RedesignProgress) => (p.free ? STUDIO_BUDGET_INR() - Number(p.spentInr || 0) : 0)

function viewOf(ai: unknown, hasStudio: boolean): Record<string, unknown> | null {
  if (!isObj(ai)) return null
  if (ai.kind !== 'studio') return ai
  const p = ai as unknown as RedesignProgress
  const stopped = p.status === 'running' && !(Date.now() - Date.parse(p.at) < STALE_MS)
  const status = stopped ? 'stopped' : p.status
  const resumable = status !== 'running' && hasStudio && (p.pages ?? []).some(x => x.status !== 'done')
  const { spentInr: _spent, ...rest } = p
  return {
    ...rest,
    status,
    ...(stopped ? { step: 'The build stopped before it finished' } : {}),
    resumable,
    resumeFree: resumable && freeLeft(p) > RESUME_MIN_INR,
  }
}

// A draft's build: a redesign's progress row, else what the older generator kept on the draft (docs.ai). Undefined
// when there is no such draft.
async function buildOf(draftId: string): Promise<{ ai: unknown; hasStudio: boolean } | undefined> {
  const [draft, progress] = await Promise.all([
    queryOne<{ ai: unknown; studio: boolean | null }>(`SELECT docs -> 'ai' AS ai, jsonb_typeof(docs #> '{studio,plan,pages}') = 'array' AS studio FROM site_drafts WHERE id = $1`, [draftId]),
    readState<RedesignProgress>(progressKey(draftId)),
  ])
  return draft ? { ai: progress ?? draft.ai, hasStudio: !!draft.studio } : undefined
}

/**
 * A draft's AI build as the admin shows it: a redesign's progress (stopped once it went quiet), or the older
 * generator's; null when it has none, undefined when there is no such draft.
 */
export async function redesignStatus(draftId: string): Promise<Record<string, unknown> | null | undefined> {
  const b = await buildOf(draftId)
  return b && viewOf(b.ai, b.hasStudio)
}

/** A stopped or unfinished redesign to carry on in its own draft, free while its free budget lasts; null when none. */
export async function resumableRedesign(draftId: string): Promise<{ draftId: string; freeBudgetInr: number } | null> {
  const b = await buildOf(draftId)
  const v = b ? viewOf(b.ai, b.hasStudio) : null
  if (!v || v.kind !== 'studio' || !v.resumable) return null
  const left = freeLeft(b!.ai as RedesignProgress)
  return { draftId, freeBudgetInr: left > RESUME_MIN_INR ? Math.round(left * 100) / 100 : 0 }
}

// ── Brief and direction ───────────────────────────────────────────────────────────────────────────

/** What the store says about itself today (name, tagline, about, logo, contacts, socials), cleaned like the studio's answers. */
async function storeDetails() {
  const [identity, content, business] = await Promise.all([
    getStoreIdentity().catch(() => null),
    getStorefrontContent().catch(() => null),
    getBusinessValues().catch(() => null),
  ])
  return cleanAnswers({
    sell: '',
    storeName: identity?.name ?? '',
    tagline: content?.metaTagline ?? '',
    about: content?.aboutCopy ?? '',
    logoUrl: identity?.logoUrl ?? '',
    contact: { phone: identity?.phone, whatsapp: identity?.whatsapp, email: identity?.email, address: business?.sellerAddress },
    socials: identity?.socials ?? {},
  })
}

/** The catalogue in brief: top categories, brands, a few products, how many and a typical price. */
async function catalogue() {
  const [cats, brands, products, stats] = await Promise.all([
    queryMany<{ name: string }>(`SELECT name FROM categories WHERE is_active = true AND parent_category_id IS NULL ORDER BY display_order NULLS LAST, name LIMIT 12`).catch(() => []),
    queryMany<{ name: string }>(`SELECT name FROM brands WHERE is_active = true ORDER BY name LIMIT 10`).catch(() => []),
    queryMany<{ name: string }>(`SELECT name FROM products WHERE is_active = true ORDER BY is_featured DESC NULLS LAST, created_at DESC LIMIT 12`).catch(() => []),
    queryOne<{ n: string; median: string | null }>(`SELECT count(*) AS n, percentile_cont(0.5) WITHIN GROUP (ORDER BY base_price) AS median FROM products WHERE is_active = true`).catch(() => null),
  ])
  const median = stats?.median != null ? Number(stats.median) : null
  return { categories: cats.map(c => c.name), brands: brands.map(b => b.name), products: products.map(p => p.name), count: Number(stats?.n ?? 0), medianInr: Number.isFinite(median) ? median : null }
}

type Catalogue = Awaited<ReturnType<typeof catalogue>>

const sellLine = (c: Catalogue) =>
  [
    c.categories.length ? `Categories: ${c.categories.join(', ')}.` : '',
    c.brands.length ? `Brands: ${c.brands.join(', ')}.` : '',
    c.products.length ? `Products such as ${c.products.join('; ')}.` : '',
    c.count ? `${c.count} products${c.medianInr ? `, typically about ₹${Math.round(c.medianInr)}` : ''}.` : '',
  ]
    .filter(Boolean)
    .join(' ')
    .slice(0, 1200)

const tierOf = (median: number | null): StudioBrief['priceTier'] => (median == null ? 'mid' : median < 500 ? 'value' : median < 3000 ? 'mid' : median < 15000 ? 'premium' : 'luxury')

/**
 * The redesign's brief: the studio's, with today's name, tagline, about, logo and contacts and a new seed (a different
 * plan), in the picked style; else one written from the store's settings and catalogue (one AI call).
 */
async function redesignBrief(stored: StoredStudioContext | null, input: RedesignInput): Promise<StudioBrief> {
  const st = styleOf(input)
  const details = await storeDetails()
  const reference = st && input.reference ? [input.reference] : []
  if (stored?.brief && stored.brief.kind !== 'showcase') {
    const { kind: _kind, ...b } = stored.brief
    return {
      ...b,
      storeName: details.storeName || b.storeName,
      tagline: details.tagline ?? b.tagline,
      about: details.about ?? b.about,
      contact: details.contact ?? b.contact,
      socials: details.socials ?? b.socials,
      logoUrl: details.logoUrl ?? b.logoUrl ?? null,
      uiStyle: st ? st.id : (b.uiStyle ?? null),
      // A new style starts from its own look: the sites they liked before go unless they give one now.
      references: st ? await readRefs(reference) : (b.references ?? []),
      seed: newSeed(),
    }
  }
  const c = await catalogue()
  return writeBrief({ ...details, sell: sellLine(c) || (await storeDescriptorForPrompt().catch(() => '')), uiStyle: st?.id ?? null, references: reference })
}

/** A brief from the store's settings and catalogue without an AI call (one page designed on a store the studio never built). */
async function localBrief(): Promise<StudioBrief> {
  const [d, c, summary] = await Promise.all([storeDetails(), catalogue(), storeDescriptorForPrompt().catch(() => '')])
  const name = d.storeName || 'The store'
  return {
    storeName: name,
    summary: summary || `${name}, an online store.`,
    category: c.categories.slice(0, 4).join(', ') || 'what its catalogue shows',
    vocabulary: [...c.categories, ...c.brands].slice(0, 12),
    audience: 'shoppers in India',
    priceTier: tierOf(c.medianInr),
    voice: 'warm, clear and specific',
    mood: 'in keeping with the rest of the site',
    artDirection: 'Natural light, clean backgrounds, true-to-life colour',
    references: [],
    uiStyle: null,
    logoUrl: d.logoUrl ?? null,
    tagline: d.tagline,
    about: d.about,
    contact: d.contact,
    socials: d.socials,
    seed: newSeed(),
  }
}

const SHAPE = ['radius', 'buttonStyle', 'density', 'buttonShape', 'cardStyle', 'inputStyle', 'headingCase', 'headingTracking', 'shadow'] as const

/** The UI style a theme's shape is closest to. */
function closestStyle(t: Partial<StudioTheme>): UiStyle {
  let best = UI_STYLES[0]
  let score = -1
  for (const s of UI_STYLES) {
    const n = SHAPE.filter(k => s.tokens[k] === t[k]).length
    if (n > score) [best, score] = [s, n]
  }
  return best
}

const withTheme = (d: DesignDirection, theme: Partial<ThemeTokens> | null | undefined): DesignDirection => {
  if (!theme) return d
  const t = { ...d.theme, ...normalizeTheme({ ...d.theme, ...theme }) } as StudioTheme
  return { ...d, theme: t, fontsHref: googleFontsHref(t) }
}

/**
 * The site's design as it is now: the studio's direction with the theme as it stands since (the owner's changes in
 * Site Builder win; a draft's own theme over the published one), or the theme in the UI style its shape is closest to.
 */
async function currentDirection(stored: StoredStudioContext | null, draftTheme?: Partial<ThemeTokens> | null): Promise<DesignDirection> {
  const published = await getPublishedTheme('store').catch(() => null)
  if (stored?.direction) return withTheme(withTheme(stored.direction, published), draftTheme)
  const t = normalizeTheme({ ...(published ?? {}), ...(draftTheme ?? {}) })
  const st = closestStyle(t)
  const theme = { ...st.tokens, ...t } as StudioTheme
  return { id: 'store', name: 'Your current design', theme, feel: st.feel, layoutFeel: st.rules, rationale: 'The store’s own theme.', fontsHref: googleFontsHref(theme) }
}

const withColours = (d: DesignDirection, from: StudioTheme): DesignDirection => ({ ...d, theme: { ...d.theme, primary: from.primary, accent: from.accent, neutral: from.neutral } })

async function redesignDirection(b: StudioBrief, current: DesignDirection, input: RedesignInput): Promise<DesignDirection> {
  if (!styleOf(input)) return input.colours === 'new' ? shuffleColours(b, current) : current
  // In the picked style; with a site they like, its look comes first.
  const [d] = await directions(b, b.references.length ? 2 : 1)
  return input.colours === 'keep' ? withColours(d, current.theme) : d
}

/** The store and, when the plan has the business portal (or the studio planned it), the business pages. */
async function audiencesFor(stored: StoredStudioContext | null): Promise<SiteAudience[]> {
  if (stored?.plan.pages.some(p => p.audience === 'business')) return ['store', 'business']
  const { getHomepagePlan } = await import('@/lib/catalog/homepage-plan')
  return (await getHomepagePlan().catch(() => null))?.business ? ['store', 'business'] : ['store']
}

/** The design the next "keep my design" redesign keeps, for the admin. */
export interface CurrentDesign {
  name: string
  uiStyle: string | null
  /** The site was built by the studio (its brief and plan are kept). */
  studio: boolean
  colours: { primary: string; accent: string; neutral: string }
}

export async function currentDesign(): Promise<CurrentDesign> {
  const stored = await getStudioContext()
  const d = await currentDirection(stored)
  return { name: d.name, uiStyle: stored?.brief.uiStyle ?? null, studio: !!stored, colours: { primary: d.theme.primary, accent: d.theme.accent, neutral: d.theme.neutral } }
}

// ── The build ─────────────────────────────────────────────────────────────────────────────────────

/** A studio page doc into the draft (desktop and phone unless told otherwise). */
async function savePage(draftId: string, key: string, doc: PageDoc, adminId: string | null, surfaces: SiteSurface[] = ['web', 'web_mobile']): Promise<void> {
  const at = parseStudioKey(key)
  if (!at || (at.audience === 'business' && CHROME.has(at.page))) return
  for (const surface of surfaces) await saveDraftPage(draftId, { audience: at.audience, surface, page: at.page, slug: '' }, doc, adminId)
}

/**
 * The whole site designed again into the draft: brief, direction, plan (all kept on the draft), the theme, the
 * product card, then every page in build order, each saved as it finishes. Stops at the budget (the rest keep their
 * current design) or when Claude stops answering, keeping what was built. `resume` carries on a stopped build from
 * its draft's plan, building only what it has not. Never throws.
 */
export async function redesignInDraft(
  draftId: string,
  input: RedesignInput,
  adminId: string | null,
  o: { free: boolean; resume?: boolean; heartbeat?: () => Promise<boolean> }
): Promise<RedesignResult> {
  const prior = o.resume ? await readState<RedesignProgress>(progressKey(draftId)) : null
  const state: RedesignProgress = prior
    ? { ...prior, charge: undefined, note: undefined, error: undefined, code: undefined, status: 'running', step: 'Carrying on with the remaining pages', free: o.free, at: now() }
    : { kind: 'studio', status: 'running', step: 'Reading your store', pages: [], free: o.free, spentInr: 0, startedAt: now(), at: now() }
  state.pages = state.pages ?? []
  const spentBefore = o.free ? Number(state.spentInr || 0) : 0
  let alive = true
  // A deleted draft, or a lock another run took over (this one went quiet too long), stops the build: no more AI calls.
  const stop = new AbortController()
  const quit = () => {
    alive = false
    stop.abort()
  }
  const stopped = (err: unknown) => gone(err) || stop.signal.aborted
  let last = 0
  let chain: Promise<unknown> = Promise.resolve()
  // Serialised writes of the progress, each also the lock's heartbeat.
  const save = (force = true) => {
    if (!alive || (!force && Date.now() - last < BEAT_MS)) return chain
    last = Date.now()
    state.at = now()
    if (o.free) state.spentInr = Math.round((spentBefore + (metered()?.costInr ?? 0)) * 100) / 100
    const json = JSON.stringify(state)
    chain = chain
      .then(async () => {
        if (!alive) return
        if ((o.heartbeat && !(await o.heartbeat())) || !(await putState(progressKey(draftId), draftId, json))) quit()
      })
      .catch(() => {})
    return chain
  }

  try {
    let ctx = o.resume ? await draftStudioContext(draftId) : null
    if (o.resume && !ctx) throw new Error('This draft has no plan to carry on from')
    if (!ctx) {
      await save()
      if (!alive) throw new Error('Draft not found')
      const stored = await getStudioContext()
      const brief = await redesignBrief(stored, input)
      state.step = 'Choosing your design'
      await save()
      const direction = await redesignDirection(brief, await currentDirection(stored), input)
      state.style = direction.name
      state.step = 'Planning every page'
      await save()
      const plan = await planSite(brief, await audiencesFor(stored))
      ctx = { brief, plan, direction }
      if (!(await saveDraftStudio(draftId, ctx))) throw new Error('Draft not found')
      for (const audience of ['store', 'business'] as const) await saveDraftTheme(draftId, audience, direction.theme, adminId)
      state.pages = [{ key: CARD_KEY, label: 'Product card', status: 'waiting' }, ...buildOrder(plan).map(p => ({ key: p.key, label: p.label, status: 'waiting' as const }))]
    } else state.pages = state.pages.map(p => (p.status === 'done' ? p : { key: p.key, label: p.label, status: 'waiting' }))
    await save()
    const run: StudioCtx = { ...ctx, signal: stop.signal }

    const card = state.pages.find(p => p.key === CARD_KEY)
    if (card && card.status !== 'done' && alive) {
      if (studioBudgetLeft() <= 0) throw new StudioBudgetError()
      card.status = 'building'
      state.step = 'Designing your product card'
      await save()
      try {
        await savePage(draftId, CARD_KEY, await generateCard(run), adminId)
        card.status = 'done'
      } catch (err) {
        if (err instanceof StudioAiDownError || err instanceof StudioBudgetError || stopped(err)) throw err
        console.error('[redesign] product card failed:', errText(err))
        card.status = 'failed'
      }
      await save()
    }

    for (const p of buildOrder(ctx.plan)) {
      let e = state.pages.find(x => x.key === p.key)
      if (!e) state.pages.push((e = { key: p.key, label: p.label, status: 'waiting' }))
      if (e.status === 'done') continue
      if (!alive) break
      if (studioBudgetLeft() <= 0) throw new StudioBudgetError()
      const page = e
      Object.assign(page, { status: 'building', sections: p.sections.length, written: 0 })
      state.step = `Designing ${p.label}`
      await save()
      try {
        const doc = await generatePage(run, p, ev => {
          if (ev.type !== 'section') return
          if (ev.status === 'done') page.written = (page.written ?? 0) + 1
          void save(false)
        })
        if (!doc.order.length) throw new Error('no section could be written')
        await savePage(draftId, p.key, doc, adminId)
        page.status = 'done'
      } catch (err) {
        if (err instanceof StudioAiDownError || err instanceof StudioBudgetError || stopped(err)) {
          page.status = 'waiting'
          throw err
        }
        console.error(`[redesign] ${p.key} failed:`, errText(err))
        page.status = 'failed'
      }
      await save()
    }
  } catch (err) {
    const left = state.pages.filter(p => p.status === 'waiting' || p.status === 'building')
    if (err instanceof StudioBudgetError) {
      for (const p of left) p.status = 'skipped'
      if (left.length) {
        state.note = `This build’s AI budget ran out before ${left.length} page${left.length === 1 ? '' : 's'} (${left
          .slice(0, 4)
          .map(p => p.label)
          .join(', ')}${left.length > 4 ? '…' : ''}). They keep their current design: carry on with them, or design one again from its page in the draft.`
      }
    } else if (stopped(err)) quit()
    else if (err instanceof StudioAiDownError) {
      state.error = `${AI_UNAVAILABLE_MESSAGE} The pages already designed are kept.`
      state.code = AI_UNAVAILABLE_CODE
    } else {
      console.error('[redesign] build failed:', errText(err))
      state.error = 'The AI stopped before your site was finished. The pages already designed are kept.'
    }
  }

  const built = state.pages.filter(p => p.status === 'done').length
  const total = state.pages.length
  if (alive) {
    state.status = built && !state.error ? 'done' : 'failed'
    if (!built && !state.error) state.error = state.note ? 'The AI budget ran out before any page was designed.' : 'No page could be designed this time. Try again in a while.'
    state.step = built === total && total ? 'Every page is designed' : `${built} of ${total} designed`
    await save()
    if (state.style) await query(`UPDATE site_drafts SET title = $2 WHERE id = $1`, [draftId, `AI redesign: ${state.style}`.slice(0, 120)]).catch(() => {})
  }
  return { ok: built > 0, built, total, style: state.style }
}

// ── One page designed again ───────────────────────────────────────────────────────────────────────

export interface PageRedoJob {
  /** `${audience}:${page}` */
  key: string
  status: 'running' | 'done' | 'failed'
  surfaces: SiteSurface[]
  startedAt: string
  at: string
  error?: string
  code?: string
  /** Sections that could not be written (the page kept the rest). */
  skipped?: number
}

/** A page redo that did not start: 404 no draft, 400 not a page the studio designs, 409 the draft is busy. */
export class PageRedoRefused extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409
  ) {
    super(message)
    this.name = 'PageRedoRefused'
  }
}

/** The store's context outside a redesign draft: the studio's (in the theme as it stands) or one from the store itself. */
async function siteCtx(draftTheme?: Partial<ThemeTokens> | null): Promise<StudioCtx> {
  const stored = await getStudioContext()
  if (stored) return { brief: stored.brief, plan: stored.plan, direction: await currentDirection(stored, draftTheme) }
  return { brief: await localBrief(), plan: { approach: { ...APPROACHES[1] }, pages: [], themed: [] }, direction: await currentDirection(null, draftTheme) }
}

const redoError = (err: unknown): { error: string; code?: string } =>
  err instanceof StudioAiDownError
    ? { error: AI_UNAVAILABLE_MESSAGE, code: AI_UNAVAILABLE_CODE }
    : { error: 'This page could not be designed again right now. Your current version is kept.' }

async function redoPage(
  draftId: string,
  own: StudioCtx | null,
  draftTheme: Partial<ThemeTokens> | null | undefined,
  audience: SiteAudience,
  page: PageKey,
  job: PageRedoJob,
  adminId: string | null,
  keepWords: string[] = []
): Promise<void> {
  const key = job.key
  let skipped = 0
  let last = 0
  const write = (patch: Partial<PageRedoJob> = {}) => putState(redoKey(draftId), draftId, JSON.stringify(Object.assign(job, patch, { at: now() })))
  try {
    const base = own ? { ...own, direction: withTheme(own.direction, draftTheme) } : await siteCtx(draftTheme)
    // "Keep my words": what the owner wrote on the page goes to the AI with the brief.
    const ctx = keepWords.length ? { ...base, brief: { ...base.brief, keepWords } } : base
    let doc: PageDoc
    let planned: PlannedPage | null = null
    if (page === CARD_PAGE) doc = await generateCard(ctx)
    else {
      // A page the plan lacks (or holds without sections) is planned from its pools first, then afresh by the AI.
      const has = ctx.plan.pages.find(p => p.key === key)
      const fresh = has?.sections.length ? null : specPage(ctx.brief, audience, page, ctx.plan.approach.id)
      const plan = fresh ? { ...ctx.plan, pages: has ? ctx.plan.pages.map(p => (p.key === key ? fresh : p)) : [...ctx.plan.pages, fresh] } : ctx.plan
      const r = await regeneratePage({ ...ctx, plan }, key, ev => {
        if (ev.type !== 'section') return
        if (ev.status === 'skipped') skipped++
        if (Date.now() - last > BEAT_MS) {
          last = Date.now()
          void write()
        }
      })
      doc = r.doc
      planned = r.page
    }
    if (!doc.order.length) throw new Error('no section could be written')
    for (const surface of job.surfaces) await saveDraftPage(draftId, { audience, surface, page, slug: '' }, doc, adminId)
    // The redesign's plan learns the page's new sections (later changes and a publish keep them).
    if (own && planned) {
      const pages = own.plan.pages.some(p => p.key === key) ? own.plan.pages.map(p => (p.key === key ? planned! : p)) : [...own.plan.pages, planned]
      await saveDraftStudio(draftId, { ...own, plan: { ...own.plan, pages } })
    }
    await write({ status: 'done', ...(skipped ? { skipped } : {}) })
  } catch (err) {
    if (gone(err)) return
    console.error(`[page-redo] ${key} failed:`, errText(err))
    await write({ status: 'failed', ...redoError(err) })
  }
}

/**
 * One page of a draft (or its product card) designed again by the studio writer: planned afresh and written section
 * by section in the background, into the draft for `surfaces`, on the draft's redesign context, else the store's.
 * Billed per AI call to the store's AI wallet like any Site Builder AI (never the whole-site free generation), and
 * stopped at PAGE_REDO_BUDGET_INR of provider cost. Returns the job once it is claimed (one per draft at a time).
 */
export async function startPageRedo(
  draftId: string,
  ref: { audience: SiteAudience; page: PageKey },
  surfaces: SiteSurface[],
  adminId: string | null,
  opts: { keepWords?: string[] } = {}
): Promise<PageRedoJob> {
  const draft = await queryOne<{ studio: unknown; theme: Partial<Record<SiteAudience, Partial<ThemeTokens>>> | null }>(
    `SELECT docs -> 'studio' AS studio, docs -> 'theme' AS theme FROM site_drafts WHERE id = $1`,
    [draftId]
  )
  if (!draft) throw new PageRedoRefused('Draft not found', 404)
  const card = ref.page === CARD_PAGE
  if (card ? ref.audience !== 'store' : !specPage({ seed: 0 } as StudioBrief, ref.audience, ref.page)) throw new PageRedoRefused('The AI does not design this page', 400)
  if ((await redesignStatus(draftId))?.status === 'running') throw new PageRedoRefused('The AI is still designing this draft: wait for it to finish', 409)
  const job: PageRedoJob = { key: `${ref.audience}:${ref.page}`, status: 'running', surfaces: [...new Set(surfaces)], startedAt: now(), at: now() }
  const claimed = await queryOne<{ key: string }>(
    `INSERT INTO site_settings (key, value, data_type, description, updated_at)
     SELECT $1::varchar, $2::text, 'json', 'Site Builder AI page redo of one draft', now() WHERE EXISTS (SELECT 1 FROM site_drafts WHERE id = $3)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
      WHERE site_settings.value::jsonb ->> 'status' IS DISTINCT FROM 'running' OR site_settings.updated_at < now() - ${STALE_SQL}
     RETURNING key`,
    [redoKey(draftId), JSON.stringify(job), draftId]
  )
  if (!claimed) throw new PageRedoRefused('The AI is already designing a page of this draft', 409)
  const theme = draft.theme?.[ref.audience] ?? draft.theme?.store
  void runMetered(PAGE_REDO_BUDGET_INR(), () => redoPage(draftId, draftStudio(draft.studio), theme, ref.audience, ref.page, { ...job }, adminId, opts.keepWords ?? [])).catch(err =>
    console.error('[page-redo]', errText(err))
  )
  return job
}

/** The draft's page redo, failed once it went quiet. */
export async function pageRedoStatus(draftId: string): Promise<PageRedoJob | null> {
  const j = await readState<PageRedoJob>(redoKey(draftId))
  if (!j) return null
  return j.status === 'running' && !(Date.now() - Date.parse(j.at) < STALE_MS) ? { ...j, status: 'failed', error: 'The AI stopped before it finished. Your current version is kept.' } : j
}
