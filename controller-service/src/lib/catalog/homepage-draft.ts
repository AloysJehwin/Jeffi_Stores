import type { PoolClient } from 'pg'
import { query, queryOne, withTransaction } from '@/lib/shared/db'
import { randomUUID } from 'crypto'
import {
  HOMEPAGE_PAGES,
  HOMEPAGE_SURFACES,
  SECTION_META,
  rowAudience,
  rowPage,
  rowSurface,
  withDefaults,
  type HomepageAudience,
  type HomepagePage,
  type HomepageSection,
  type HomepageSurface,
} from '@/lib/catalog/homepage-sections'
import type { HeroSlide } from '@/lib/catalog/hero-slides'
import {
  HOMEPAGE_LOCK_ID,
  actorOf,
  announceDraftClosed,
  announceDraftLock,
  assertDraftHolder,
  canDiscard,
  closeDraftLockTx,
  epochFrom,
  type DraftActor,
} from '@/lib/admin/draft-locks'

/** The editing admin for the draft lock. No actor (system writers, tests) = no lock. */
export interface HomepageLockOpts {
  actor?: DraftActor
  epoch?: number | null
}

/** Lock options for a route: the signed-in admin and the tab's epoch header. */
export function homepageLockFrom(
  admin: { adminId?: string; role?: string; scopes?: string[] },
  req: { headers: { get(name: string): string | null } }
): HomepageLockOpts {
  return { actor: actorOf(admin), epoch: epochFrom(req) }
}

export type DraftSection = HomepageSection & { created_at: string; updated_at: string }
export type DraftHeroSlide = HeroSlide

export interface HomepageDraftState {
  sections: DraftSection[]
  heroSlides: DraftHeroSlide[]
}

export interface EditableHomepage extends HomepageDraftState {
  draft: { updatedAt: string | null; updatedBy: string | null } | null
}

export interface DraftDiff {
  added: number
  removed: number
  edited: number
  reordered: boolean
}

export interface HomepageDraftSummary {
  hasDraft: boolean
  updatedAt: string | null
  updatedBy: string | null
  sections: DraftDiff
  slides: DraftDiff
  /** The same diffs split by layout, for the Desktop web / Mobile web / App tabs. */
  bySurface: Record<HomepageSurface, { sections: DraftDiff; slides: DraftDiff }>
  /** The store's, by page then layout (hero slides count toward the homepage). */
  byPage: Record<HomepagePage, Record<HomepageSurface, { sections: DraftDiff; slides: DraftDiff }>>
  /** The business homepage's, by layout. */
  business: Record<HomepageSurface, { sections: DraftDiff; slides: DraftDiff }>
}

export type PublishCounts = { inserted: number; updated: number; deleted: number }
export type PublishResult = { sections: PublishCounts; heroSlides: PublishCounts }

interface DraftRow {
  id: string
  display_order: number
  surface?: HomepageSurface | null
  audience?: HomepageAudience | null
  created_at?: string
  updated_at?: string
}

const SECTION_COLUMNS = [
  'type',
  'title',
  'subtitle',
  'eyebrow',
  'cta_label',
  'cta_url',
  'config',
  'display_order',
  'is_active',
  'starts_at',
  'ends_at',
  'surface',
  'page',
  'audience',
] as const

const SLIDE_COLUMNS = [
  'title',
  'subtitle',
  'badge_text',
  'badge_color',
  'image_url',
  'image_url_mobile',
  'blurhash',
  'blurhash_mobile',
  'video_url',
  'cta_label',
  'cta_url',
  'filter_category',
  'filter_brand',
  'filter_grade',
  'filter_material',
  'filter_min_price',
  'filter_max_price',
  'filter_in_stock',
  'filter_on_sale',
  'display_order',
  'is_active',
  'surface',
  'audience',
] as const

// Draft rows copied before a column existed have no key for it; jsonb_populate_recordset gives NULL.
const NOT_NULL_DEFAULTS: Record<string, string> = {
  config: `'{}'::jsonb`,
  display_order: '0',
  is_active: 'true',
  filter_in_stock: 'false',
  filter_on_sale: 'false',
  surface: `'web'`,
  page: `'home'`,
  audience: `'store'`,
}

const liveRows = (table: 'homepage_sections' | 'hero_slides') =>
  `COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.display_order, t.created_at) FROM ${table} t), '[]'::jsonb)`

const READ_LIVE_SQL = `SELECT ${liveRows('homepage_sections')} AS sections, ${liveRows('hero_slides')} AS hero_slides`

const READ_DRAFT_SQL = `SELECT d.sections, d.hero_slides, d.updated_at,
       COALESCE(NULLIF(TRIM(CONCAT_WS(' ', u.first_name, u.last_name)), ''), u.email) AS updated_by_name
  FROM homepage_drafts d
  LEFT JOIN admins a ON a.id = d.updated_by
  LEFT JOIN users u ON u.id = a.user_id
 WHERE d.id = true`

const ENSURE_DRAFT_SQL = `INSERT INTO homepage_drafts (id, sections, hero_slides, updated_by)
SELECT true, ${liveRows('homepage_sections')}, ${liveRows('hero_slides')}, $1::uuid
ON CONFLICT (id) DO NOTHING`

const LOCK_DRAFT_SQL = `SELECT sections, hero_slides FROM homepage_drafts WHERE id = true FOR UPDATE`

const WRITE_DRAFT_SQL = `UPDATE homepage_drafts
   SET sections = $1::jsonb, hero_slides = $2::jsonb, updated_by = $3::uuid, updated_at = now()
 WHERE id = true`

const DELETE_DRAFT_SQL = `DELETE FROM homepage_drafts WHERE id = true`

interface TableSpec {
  table: 'homepage_sections' | 'hero_slides'
  upsert: string
}

function tableSpec(table: TableSpec['table'], columns: readonly string[]): TableSpec {
  const value = (c: string) => (NOT_NULL_DEFAULTS[c] ? `COALESCE(d.${c}, ${NOT_NULL_DEFAULTS[c]})` : `d.${c}`)
  const tuple = (alias: string) => `(${columns.map(c => `${alias}.${c}`).join(', ')})`
  return {
    table,
    upsert: `INSERT INTO ${table} AS t (id, ${columns.join(', ')}, created_at, updated_at)
SELECT d.id, ${columns.map(value).join(', ')}, COALESCE(d.created_at, now()), COALESCE(d.updated_at, now())
  FROM jsonb_populate_recordset(NULL::${table}, $1::jsonb) AS d
ON CONFLICT (id) DO UPDATE SET ${columns.map(c => `${c} = EXCLUDED.${c}`).join(', ')}, updated_at = now()
 WHERE ${tuple('t')} IS DISTINCT FROM ${tuple('EXCLUDED')}
RETURNING (xmax = 0) AS inserted`,
  }
}

const SECTIONS = tableSpec('homepage_sections', SECTION_COLUMNS)
const SLIDES = tableSpec('hero_slides', SLIDE_COLUMNS)

const SECTION_DIFF_FIELDS = SECTION_COLUMNS.filter(c => c !== 'display_order')
const SLIDE_DIFF_FIELDS = SLIDE_COLUMNS.filter(c => c !== 'display_order')
const TIME_FIELDS = new Set(['starts_at', 'ends_at'])

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

class Unchanged extends Error {
  constructor(readonly result: unknown) {
    super('homepage draft unchanged')
  }
}

const asArray = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : [])
// Rows saved before the surface / page / audience columns existed read as web / home / store, so diffs and
// per-tab views agree.
const asRows = <T extends DraftRow>(value: unknown): T[] =>
  asArray<T>(value).map(r => ({ ...r, surface: rowSurface(r), audience: rowAudience(r) }))
const asSections = (value: unknown): DraftSection[] => asRows<DraftSection>(value).map(r => ({ ...r, page: rowPage(r) }))
const asUuid = (id: string | null | undefined) => (id && UUID_RE.test(id) ? id : null)
const isUndefinedTable = (err: unknown) => (err as { code?: string } | null)?.code === '42P01'

function toIso(value: unknown): string | null {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(String(value))
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function canonical(value: unknown): string {
  return JSON.stringify(value ?? null, (_key, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map(k => [k, v[k]])
        )
      : v
  )
}

function comparable(field: string, value: unknown): string {
  if (value === undefined || value === null || value === '') return 'null'
  if (TIME_FIELDS.has(field)) {
    const ms = Date.parse(String(value))
    if (!Number.isNaN(ms)) return String(ms)
  }
  return canonical(value)
}

function sortByDisplayOrder<T extends DraftRow>(rows: T[]): T[] {
  const created = (r: T) => Date.parse(r.created_at ?? '') || 0
  return [...rows].sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0) || created(a) - created(b))
}

export function nextDisplayOrder(rows: { display_order: number }[]): number {
  return rows.length ? Math.max(...rows.map(r => Number(r.display_order) || 0)) + 1 : 0
}

/** Assigns only the values that differ and bumps updated_at when anything did; returns whether it changed. */
export function applyDraftPatch(row: object, updates: Record<string, unknown>): boolean {
  const target = row as Record<string, unknown>
  let changed = false
  for (const [key, value] of Object.entries(updates)) {
    if (canonical(target[key]) === canonical(value)) continue
    target[key] = value
    changed = true
  }
  if (changed) target.updated_at = new Date().toISOString()
  return changed
}

export function applyDraftOrder<T extends DraftRow>(rows: T[], order: unknown[]): T[] {
  const position = new Map<string, number>()
  order.forEach((id, i) => {
    if (typeof id === 'string' && !position.has(id)) position.set(id, i)
  })
  for (const row of rows) {
    const next = position.get(row.id)
    if (next !== undefined) applyDraftPatch(row, { display_order: next })
  }
  return sortByDisplayOrder(rows)
}

export class SurfaceNotEmpty extends Error {
  constructor(public surface: HomepageSurface) {
    super(`The ${surface} layout already has its own sections or slides`)
  }
}

export type CopySurfaceResult = { sections: number; slides: number; replaced: number }

/** The next display_order on one page's layout. */
export function nextDisplayOrderOn(
  rows: HomepageSection[],
  page: HomepagePage,
  surface: HomepageSurface,
  audience: HomepageAudience = 'store'
): number {
  return nextDisplayOrder(
    rows.filter(r => rowPage(r) === page && rowSurface(r) === surface && rowAudience(r) === audience)
  )
}

/**
 * Copies one surface's layout of a page onto another so it can be edited apart from the source. Rows
 * get fresh ids (publish upserts by id, so reusing them would move the originals) and `created_at` is
 * now, so the copies sort after nothing from before. A store homepage source with no saved sections
 * contributes the built-in default layout, which is what that surface is showing; hero slides are
 * the homepage's. `audience` is the target homepage and `fromAudience` the source (the store's, to
 * start the business homepage from it); types the target can't use are left out. Refuses to
 * overwrite unless `replace`.
 */
export function copySurfaceLayout(
  draft: HomepageDraftState,
  from: HomepageSurface,
  to: HomepageSurface,
  opts: {
    page?: HomepagePage
    audience?: HomepageAudience
    fromAudience?: HomepageAudience
    replace?: boolean
    now?: string
    newId?: () => string
  } = {}
): CopySurfaceResult {
  const audience = opts.audience ?? 'store'
  const fromAudience = opts.fromAudience ?? audience
  if (from === to && fromAudience === audience) throw new Error('Source and target surface are the same')
  const page = opts.page ?? 'home'
  const home = page === 'home'
  const now = opts.now ?? new Date().toISOString()
  const newId = opts.newId ?? randomUUID
  const onPage = (r: HomepageSection) => rowPage(r) === page
  const isTarget = (r: DraftRow) => rowSurface(r) === to && rowAudience(r) === audience
  const isSource = (r: DraftRow) => rowSurface(r) === from && rowAudience(r) === fromAudience
  const onTarget = (r: HomepageSection) => onPage(r) && isTarget(r as DraftSection)
  const slideOnTarget = (r: DraftRow) => home && isTarget(r)
  const replaced = draft.sections.filter(onTarget).length + draft.heroSlides.filter(slideOnTarget).length
  if (replaced > 0 && !opts.replace) throw new SurfaceNotEmpty(to)

  const sourceSections = sortByDisplayOrder(draft.sections.filter(r => onPage(r) && isSource(r)))
  const usable = (s: HomepageSection) => SECTION_META[s.type]?.audiences?.includes(audience) ?? true
  const sections: DraftSection[] = (home && fromAudience === 'store' ? withDefaults(sourceSections) : sourceSections)
    .filter(usable)
    .map((s, i) => ({
      ...(s as DraftSection),
      id: newId(),
      surface: to,
      page,
      audience,
      display_order: i,
      created_at: now,
      updated_at: now,
    }))
  const slides: DraftHeroSlide[] = home
    ? sortByDisplayOrder(draft.heroSlides.filter(isSource)).map((s, i) => ({
        ...s,
        id: newId(),
        surface: to,
        audience,
        display_order: i,
        created_at: now,
        updated_at: now,
      }))
    : []

  draft.sections = [...draft.sections.filter(r => !onTarget(r)), ...sections]
  draft.heroSlides = [...draft.heroSlides.filter(r => !slideOnTarget(r)), ...slides]
  return { sections: sections.length, slides: slides.length, replaced }
}

export function endsBeforeStart(startsAt: unknown, endsAt: unknown): boolean {
  if (!startsAt || !endsAt) return false
  return Date.parse(String(endsAt)) <= Date.parse(String(startsAt))
}

async function readDraft() {
  try {
    return await queryOne<{
      sections: unknown
      hero_slides: unknown
      updated_at: unknown
      updated_by_name: string | null
    }>(READ_DRAFT_SQL)
  } catch (err) {
    if (isUndefinedTable(err)) return null
    throw err
  }
}

async function readLive(): Promise<HomepageDraftState> {
  const row = await queryOne<{ sections: unknown; hero_slides: unknown }>(READ_LIVE_SQL)
  return { sections: asSections(row?.sections), heroSlides: asRows(row?.hero_slides) }
}

export async function getEditableHomepage(): Promise<EditableHomepage> {
  const draft = await readDraft()
  if (!draft) return { ...(await readLive()), draft: null }
  return {
    sections: sortByDisplayOrder(asSections(draft.sections)),
    heroSlides: sortByDisplayOrder(asRows<DraftHeroSlide>(draft.hero_slides)),
    draft: { updatedAt: toIso(draft.updated_at), updatedBy: draft.updated_by_name ?? null },
  }
}

// A publish committed while we waited on the lock deletes the row; copy the new live state and retry.
async function lockDraft(client: PoolClient, updatedBy: string | null): Promise<HomepageDraftState> {
  for (let attempt = 0; attempt < 3; attempt++) {
    await client.query(ENSURE_DRAFT_SQL, [updatedBy])
    const { rows } = await client.query(LOCK_DRAFT_SQL)
    if (rows[0]) return { sections: asSections(rows[0].sections), heroSlides: asRows(rows[0].hero_slides) }
  }
  throw new Error('Homepage draft is unavailable')
}

/**
 * Runs `mutate` against the locked draft, creating it from the live tables on first edit, and writes
 * both arrays back. A mutate that changes nothing rolls back, so it never leaves a fresh draft behind.
 * With `lock.actor` the caller must hold the draft lock (DraftLockError otherwise); an unclaimed
 * draft is claimed, all inside the same transaction.
 */
export async function withHomepageDraft<T>(
  adminId: string | null,
  mutate: (draft: HomepageDraftState) => T | Promise<T>,
  lock: HomepageLockOpts = {}
): Promise<T> {
  const updatedBy = asUuid(adminId)
  let held: Awaited<ReturnType<typeof assertDraftHolder>> = null
  try {
    const out = await withTransaction(async client => {
      const draft = await lockDraft(client, updatedBy)
      held = await assertDraftHolder(client, lock.actor, 'homepage', HOMEPAGE_LOCK_ID, { epoch: lock.epoch })
      const before = JSON.stringify(draft)
      const result = await mutate(draft)
      if (JSON.stringify(draft) === before) throw new Unchanged(result)
      await client.query(WRITE_DRAFT_SQL, [JSON.stringify(draft.sections), JSON.stringify(draft.heroSlides), updatedBy])
      return result
    })
    await announceDraftLock(lock.actor, 'homepage', HOMEPAGE_LOCK_ID, held)
    return out
  } catch (err) {
    if (err instanceof Unchanged) return err.result as T
    throw err
  }
}

async function publishRows(client: PoolClient, spec: TableSpec, rows: DraftRow[]): Promise<PublishCounts> {
  const upserted = await client.query<{ inserted: boolean }>(spec.upsert, [JSON.stringify(rows)])
  const deleted = await client.query(`DELETE FROM ${spec.table} WHERE NOT (id = ANY($1::uuid[]))`, [
    rows.map(r => r.id),
  ])
  const inserted = upserted.rows.filter(r => r.inserted).length
  return { inserted, updated: upserted.rows.length - inserted, deleted: deleted.rowCount ?? 0 }
}

/**
 * Copies the draft onto the live tables in one transaction and deletes it. Null when there is no draft.
 * With `lock.actor` the draft lock is asserted and closed in that transaction.
 */
export async function publishHomepageDraft(lock: HomepageLockOpts = {}): Promise<PublishResult | null> {
  let closed: Awaited<ReturnType<typeof closeDraftLockTx>> = null
  const out = await withTransaction(async client => {
    const { rows } = await client.query(LOCK_DRAFT_SQL)
    if (!rows[0]) return null
    await assertDraftHolder(client, lock.actor, 'homepage', HOMEPAGE_LOCK_ID, { epoch: lock.epoch })
    const sections = await publishRows(client, SECTIONS, asArray(rows[0].sections))
    const heroSlides = await publishRows(client, SLIDES, asArray(rows[0].hero_slides))
    await client.query(DELETE_DRAFT_SQL)
    closed = await closeDraftLockTx(client, lock.actor, 'homepage', HOMEPAGE_LOCK_ID, 'published')
    return { sections, heroSlides }
  })
  await announceDraftClosed(lock.actor, 'homepage', HOMEPAGE_LOCK_ID, closed, 'published')
  return out
}

/** With `lock.actor`: the holder or an owner role (audited) discards, and the lock closes with the row. */
export async function discardHomepageDraft(lock: HomepageLockOpts = {}): Promise<boolean> {
  const actor = lock.actor
  if (!actor?.adminId) {
    const result = await query(DELETE_DRAFT_SQL)
    return (result.rowCount ?? 0) > 0
  }
  const allowed = await canDiscard(actor, 'homepage', HOMEPAGE_LOCK_ID)
  if (!allowed.ok) throw allowed.error
  let closed: Awaited<ReturnType<typeof closeDraftLockTx>> = null
  const discarded = await withTransaction(async client => {
    const result = await client.query(DELETE_DRAFT_SQL)
    if (!result.rowCount) return false
    closed = await closeDraftLockTx(client, actor, 'homepage', HOMEPAGE_LOCK_ID, 'discarded')
    return true
  })
  await announceDraftClosed(actor, 'homepage', HOMEPAGE_LOCK_ID, closed, 'discarded')
  return discarded
}

function diffRows(draft: DraftRow[], live: DraftRow[], fields: readonly string[]): DraftDiff {
  const liveById = new Map(live.map(r => [r.id, r]))
  const draftIds = new Set(draft.map(r => r.id))
  const value = (row: DraftRow, field: string) => (row as unknown as Record<string, unknown>)[field]
  let added = 0
  let edited = 0
  for (const row of draft) {
    const prev = liveById.get(row.id)
    if (!prev) added++
    else if (fields.some(f => comparable(f, value(row, f)) !== comparable(f, value(prev, f)))) edited++
  }
  const draftOrder = sortByDisplayOrder(draft)
    .map(r => r.id)
    .filter(id => liveById.has(id))
  const liveOrder = sortByDisplayOrder(live)
    .map(r => r.id)
    .filter(id => draftIds.has(id))
  return {
    added,
    removed: live.filter(r => !draftIds.has(r.id)).length,
    edited,
    reordered: draftOrder.some((id, i) => id !== liveOrder[i]),
  }
}

const noChanges = (): DraftDiff => ({ added: 0, removed: 0, edited: 0, reordered: false })

function diffState(draft: HomepageDraftState, live: HomepageDraftState) {
  return {
    sections: diffRows(draft.sections, live.sections, SECTION_DIFF_FIELDS),
    slides: diffRows(draft.heroSlides, live.heroSlides, SLIDE_DIFF_FIELDS),
  }
}

const onSurface = (
  state: HomepageDraftState,
  surface: HomepageSurface,
  page?: HomepagePage,
  audience?: HomepageAudience
): HomepageDraftState => {
  const mine = (r: DraftRow) => r.surface === surface && (!audience || rowAudience(r) === audience)
  return {
    sections: state.sections.filter(s => mine(s) && (!page || s.page === page)),
    heroSlides: page && page !== 'home' ? [] : state.heroSlides.filter(mine),
  }
}

const perSurface = <T>(fn: (surface: HomepageSurface) => T) =>
  Object.fromEntries(HOMEPAGE_SURFACES.map(s => [s, fn(s)])) as Record<HomepageSurface, T>

const perPage = <T>(fn: (page: HomepagePage) => T) =>
  Object.fromEntries(HOMEPAGE_PAGES.map(p => [p, fn(p)])) as Record<HomepagePage, T>

export async function getHomepageDraftSummary(): Promise<HomepageDraftSummary> {
  const draft = await readDraft()
  if (!draft) {
    const none = () => ({ sections: noChanges(), slides: noChanges() })
    return {
      hasDraft: false,
      updatedAt: null,
      updatedBy: null,
      ...none(),
      bySurface: perSurface(none),
      byPage: perPage(() => perSurface(none)),
      business: perSurface(none),
    }
  }
  const live = await readLive()
  const state: HomepageDraftState = { sections: asSections(draft.sections), heroSlides: asRows(draft.hero_slides) }
  return {
    hasDraft: true,
    updatedAt: toIso(draft.updated_at),
    updatedBy: draft.updated_by_name ?? null,
    ...diffState(state, live),
    bySurface: perSurface(surface => diffState(onSurface(state, surface), onSurface(live, surface))),
    byPage: perPage(page =>
      perSurface(surface =>
        diffState(onSurface(state, surface, page, 'store'), onSurface(live, surface, page, 'store'))
      )
    ),
    business: perSurface(surface =>
      diffState(onSurface(state, surface, 'home', 'business'), onSurface(live, surface, 'home', 'business'))
    ),
  }
}
