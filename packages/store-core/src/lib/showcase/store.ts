import type { PageDoc, ThemeTokens } from '@jeffi/site-blocks'
import { controlPlanePool, RESERVED_LABELS } from '@/lib/tenant-registry/shared'
import { emptyShowcaseContent, SHOWCASE_PRICE_INR, SHOWCASE_TRIAL_DAYS, type ShowcaseBusiness, type ShowcaseContent, type ShowcaseSite, type ShowcaseStatus } from './types'
import { SHOWCASE_SLUG_RE, showcaseSlugFromHost } from './host'

const FLAGSHIP_TENANT_ID = '00000000-0000-0000-0000-000000000000'

// Showcase data access: showcase_sites and showcase_leads, through the control-plane pool (a Showcase-only
// workspace has no store database). Callers check ownership (getOwnedShowcase) before changing a site; charging
// for hosting lives in the controller (lib/showcase/billing.ts).

const COLS = `id, tenant_id, owner_id, slug, status, business, content, page, theme, paid_until, trial_ends_at, renew, free_generation_used_at,
  generations, custom_domain, published_at, created_at, updated_at, pause_reason, charge_failed_at, last_charge_error,
  (SELECT t.status FROM tenants t WHERE t.id = showcase_sites.tenant_id) AS tenant_status`

type Row = Record<string, any>

const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null)
// jsonb parameters go as JSON text: node-postgres would send a top-level array as a Postgres array.
const json = (v: unknown) => (v == null ? null : JSON.stringify(v))

/** The site row plus the billing state the dashboard shows (not part of the shared ShowcaseSite contract). */
export interface ShowcaseSiteRow extends ShowcaseSite {
  pauseReason: 'owner' | 'unpaid' | null
  chargeFailedAt: string | null
  lastChargeError: string | null
  /** Its workspace is suspended or terminated: the site is not served (and not charged) whatever its status. */
  workspaceSuspended: boolean
}

function toSite(r: Row): ShowcaseSiteRow {
  return {
    id: r.id,
    tenantId: r.tenant_id ?? null,
    ownerId: r.owner_id,
    slug: r.slug,
    status: r.status as ShowcaseStatus,
    business: { name: '', ...(r.business ?? {}) } as ShowcaseBusiness,
    content: { ...emptyShowcaseContent(), ...(r.content ?? {}) } as ShowcaseContent,
    page: (r.page ?? null) as PageDoc | null,
    theme: (r.theme ?? null) as ThemeTokens | null,
    paidUntil: iso(r.paid_until),
    trialEndsAt: iso(r.trial_ends_at),
    renew: !!r.renew,
    freeGenerationUsedAt: iso(r.free_generation_used_at),
    generations: Number(r.generations ?? 0),
    customDomain: r.custom_domain ?? null,
    publishedAt: iso(r.published_at),
    createdAt: iso(r.created_at)!,
    updatedAt: iso(r.updated_at)!,
    pauseReason: r.pause_reason ?? null,
    chargeFailedAt: iso(r.charge_failed_at),
    lastChargeError: r.last_charge_error ?? null,
    workspaceSuspended: r.tenant_status === 'suspended' || r.tenant_status === 'terminated',
  }
}

async function one(sql: string, params: unknown[]): Promise<ShowcaseSiteRow | null> {
  const r = await controlPlanePool().query(sql, params)
  return r.rows[0] ? toSite(r.rows[0]) : null
}

// ── Reads ────────────────────────────────────────────────────────────────────

export const getShowcaseById = (id: string) => one(`SELECT ${COLS} FROM showcase_sites WHERE id = $1`, [id])

export const getShowcaseBySlug = (slug: string) => one(`SELECT ${COLS} FROM showcase_sites WHERE slug = $1`, [slug.toLowerCase()])

/** The site a request host addresses: site-{slug}.<root>, site-{slug}.localhost, or a custom domain. */
export async function getShowcaseByHost(host: string): Promise<ShowcaseSiteRow | null> {
  const slug = showcaseSlugFromHost(host)
  if (slug) return getShowcaseBySlug(slug)
  const h = host.toLowerCase().split(':')[0].trim()
  return h ? one(`SELECT ${COLS} FROM showcase_sites WHERE custom_domain = $1`, [h]) : null
}

/** The owner's sites, newest first. */
export async function listShowcasesByOwner(ownerId: string): Promise<ShowcaseSiteRow[]> {
  const r = await controlPlanePool().query(`SELECT ${COLS} FROM showcase_sites WHERE owner_id = $1 ORDER BY created_at DESC`, [ownerId])
  return r.rows.map(toSite)
}

/** The workspace's sites, newest first. */
export async function listShowcasesByTenant(tenantId: string): Promise<ShowcaseSiteRow[]> {
  const r = await controlPlanePool().query(`SELECT ${COLS} FROM showcase_sites WHERE tenant_id = $1 ORDER BY created_at DESC`, [tenantId])
  return r.rows.map(toSite)
}

/** The site when this owner owns it, else null. */
export const getOwnedShowcase = (siteId: string, ownerId: string) =>
  one(`SELECT ${COLS} FROM showcase_sites WHERE id = $1 AND owner_id = $2`, [siteId, ownerId])

// ── Create and save ──────────────────────────────────────────────────────────

/** Whether a slug can be taken: its format, the platform's reserved words, and not in use. */
export async function checkShowcaseSlug(raw: string): Promise<{ ok: true; slug: string } | { ok: false; error: string }> {
  const slug = (raw || '').toLowerCase().trim()
  if (!SHOWCASE_SLUG_RE.test(slug)) return { ok: false, error: 'Use 3–58 lowercase letters, numbers or hyphens, not starting or ending with a hyphen.' }
  if (RESERVED_LABELS.has(slug)) return { ok: false, error: `"${slug}" is reserved.` }
  const taken = await controlPlanePool().query(`SELECT 1 FROM showcase_sites WHERE slug = $1`, [slug])
  if (taken.rowCount) return { ok: false, error: `site-${slug} is already taken.` }
  return { ok: true, slug }
}

/**
 * A new draft site. With a workspace, Showcase is also added to its services (tenants.service_types), which shows
 * Showcase in its console.
 */
export async function createShowcaseDraft(input: {
  ownerId: string
  tenantId?: string | null
  slug: string
  business: ShowcaseBusiness
  content?: ShowcaseContent
  page?: PageDoc | null
  theme?: ThemeTokens | null
}): Promise<{ ok: true; site: ShowcaseSiteRow } | { ok: false; error: string }> {
  const check = await checkShowcaseSlug(input.slug)
  if (!check.ok) return check
  const pool = controlPlanePool()
  try {
    const r = await pool.query(
      `INSERT INTO showcase_sites (owner_id, tenant_id, slug, business, content, page, theme)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb) RETURNING ${COLS}`,
      [input.ownerId, input.tenantId ?? null, check.slug, json(input.business), json(input.content ?? emptyShowcaseContent()), json(input.page), json(input.theme)]
    )
    if (input.tenantId) await addShowcaseService(input.tenantId)
    return { ok: true, site: toSite(r.rows[0]) }
  } catch (e: any) {
    if (e?.code === '23505') return { ok: false, error: `site-${check.slug} is already taken.` }
    throw e
  }
}

async function addShowcaseService(tenantId: string): Promise<void> {
  await controlPlanePool().query(
    `UPDATE tenants SET service_types = (SELECT array_agg(DISTINCT x) FROM unnest(service_types || '{showcase}'::text[]) x), updated_at = now()
      WHERE id = $1 AND NOT ('showcase' = ANY(service_types))`,
    [tenantId]
  )
}

/** Change any of the site's business, content, page and theme; the others stay. */
export async function updateShowcase(
  siteId: string,
  patch: Partial<{ business: ShowcaseBusiness; content: ShowcaseContent; page: PageDoc | null; theme: ThemeTokens | null }>
): Promise<ShowcaseSiteRow | null> {
  const sets: string[] = []
  const params: unknown[] = [siteId]
  for (const key of ['business', 'content', 'page', 'theme'] as const) {
    if (!(key in patch)) continue
    if ((key === 'business' || key === 'content') && patch[key] == null) continue
    params.push(json(patch[key]))
    sets.push(`${key} = $${params.length}::jsonb`)
  }
  if (!sets.length) return getShowcaseById(siteId)
  return one(`UPDATE showcase_sites SET ${sets.join(', ')}, updated_at = now() WHERE id = $1 RETURNING ${COLS}`, params)
}

export const saveShowcaseBusiness = (siteId: string, business: ShowcaseBusiness) => updateShowcase(siteId, { business })
export const saveShowcaseContent = (siteId: string, content: ShowcaseContent) => updateShowcase(siteId, { content })
export const saveShowcasePage = (siteId: string, page: PageDoc | null) => updateShowcase(siteId, { page })
export const saveShowcaseTheme = (siteId: string, theme: ThemeTokens | null) => updateShowcase(siteId, { theme })

/** Move the site to a workspace (whose wallet pays for it); Showcase is added to its services. */
export async function setShowcaseTenant(siteId: string, tenantId: string): Promise<ShowcaseSiteRow | null> {
  const site = await one(`UPDATE showcase_sites SET tenant_id = $2, updated_at = now() WHERE id = $1 RETURNING ${COLS}`, [siteId, tenantId])
  if (site) await addShowcaseService(tenantId)
  return site
}

// ── Lifecycle ────────────────────────────────────────────────────────────────

export type ShowcaseTransition =
  | { ok: true; site: ShowcaseSiteRow }
  | { ok: false; code: 'not_found' | 'no_page' | 'draft' | 'payment_due'; error: string; site?: ShowcaseSiteRow }

const PAYMENT_DUE = 'Hosting for this site is unpaid. Pay from the Showcase page to bring it back.'

/**
 * Put the site live. The first publish starts the trial (trial_ends_at = paid_until = now + SHOWCASE_TRIAL_DAYS), gives
 * the site a workspace if it has none (ensureShowcaseWorkspace: its subscription pays, its console manages the site)
 * and opens its trial billing line; publishing a live site again changes nothing; a paused one resumes while its
 * hosting is paid (resumeShowcase). The first publish also cuts the site's preview links to 30 minutes.
 */
export async function publishShowcase(siteId: string): Promise<ShowcaseTransition> {
  const draft = await getShowcaseById(siteId)
  if (draft?.status === 'draft' && draft.page && !draft.tenantId) {
    const { ensureShowcaseWorkspace } = await import('./workspace')
    await ensureShowcaseWorkspace(draft).catch(e => console.error(`[showcase] no workspace for ${siteId}:`, e?.message || e))
  }
  const first = await one(
    `UPDATE showcase_sites
        SET status = 'live', pause_reason = NULL, published_at = COALESCE(published_at, now()),
            trial_ends_at = COALESCE(trial_ends_at, paid_until, now() + make_interval(days => $2::int)),
            paid_until = COALESCE(paid_until, now() + make_interval(days => $2::int)), updated_at = now()
      WHERE id = $1 AND status = 'draft' AND page IS NOT NULL
      RETURNING ${COLS}`,
    [siteId, SHOWCASE_TRIAL_DAYS]
  )
  if (first) {
    if (first.tenantId && first.trialEndsAt && Date.parse(first.trialEndsAt) > Date.now()) await openTrialLine(first.tenantId, first.id, first.trialEndsAt).catch(() => {})
    // Preview links stay up for 30 minutes from here, with a way to the live site.
    const { shortenPreviewAfterPublish } = await import('./preview-token')
    await shortenPreviewAfterPublish(first.id).catch(() => {})
    return { ok: true, site: first }
  }
  const site = await getShowcaseById(siteId)
  if (!site) return { ok: false, code: 'not_found', error: 'Site not found.' }
  if (!site.page) return { ok: false, code: 'no_page', error: 'Make the page before publishing.', site }
  if (site.status === 'live') return { ok: true, site }
  return resumeShowcase(siteId)
}

// The billing sweep also opens missed ones (controller lib/billing/sweep.ts syncShowcaseLines). The platform's own
// sites are not billed.
async function openTrialLine(tenantId: string, siteId: string, trialEndsAt: string): Promise<void> {
  if (tenantId === FLAGSHIP_TENANT_ID) return
  await controlPlanePool().query(
    `INSERT INTO billing_lines (tenant_id, kind, ref, amount_paise, status, trial_ends_at)
     VALUES ($1, 'showcase_site', $2, $3, 'trial', $4)
     ON CONFLICT (tenant_id, kind, ref) WHERE status <> 'ended' DO NOTHING`,
    [tenantId, siteId, SHOWCASE_PRICE_INR * 100, trialEndsAt]
  )
}

/** Take the site offline: `owner` from the console, `unpaid` when its hosting lapsed. Its data and leads stay. */
export async function pauseShowcase(siteId: string, reason: 'owner' | 'unpaid' = 'owner'): Promise<ShowcaseSiteRow | null> {
  const paused = await one(
    `UPDATE showcase_sites SET status = 'paused', pause_reason = $2, updated_at = now() WHERE id = $1 AND status = 'live' RETURNING ${COLS}`,
    [siteId, reason]
  )
  return paused ?? getShowcaseById(siteId)
}

/** Back online while its hosting is paid; otherwise `payment_due` (the controller charges a month, then resumes). */
export async function resumeShowcase(siteId: string): Promise<ShowcaseTransition> {
  const resumed = await one(
    `UPDATE showcase_sites SET status = 'live', pause_reason = NULL, updated_at = now()
      WHERE id = $1 AND status = 'paused' AND page IS NOT NULL AND paid_until > now()
      RETURNING ${COLS}`,
    [siteId]
  )
  if (resumed) return { ok: true, site: resumed }
  const site = await getShowcaseById(siteId)
  if (!site) return { ok: false, code: 'not_found', error: 'Site not found.' }
  if (site.status === 'live') return { ok: true, site }
  if (site.status === 'draft') return { ok: false, code: 'draft', error: 'Publish the site first.', site }
  if (!site.page) return { ok: false, code: 'no_page', error: 'Make the page before publishing.', site }
  return { ok: false, code: 'payment_due', error: PAYMENT_DUE, site }
}

export const setShowcaseRenew = (siteId: string, renew: boolean) =>
  one(`UPDATE showcase_sites SET renew = $2, updated_at = now() WHERE id = $1 RETURNING ${COLS}`, [siteId, renew])

// ── AI generations ───────────────────────────────────────────────────────────

/** Marks the site's one free generation used; true only for the call that got it (two at once can't both). */
export async function claimFreeShowcaseGeneration(siteId: string): Promise<boolean> {
  const r = await controlPlanePool().query(
    `UPDATE showcase_sites SET free_generation_used_at = now(), updated_at = now() WHERE id = $1 AND free_generation_used_at IS NULL`,
    [siteId]
  )
  return (r.rowCount ?? 0) > 0
}

/** Counts a finished generation (and, with `free`, marks the free one used); returns the new count. */
export async function recordShowcaseGeneration(siteId: string, opts: { free?: boolean } = {}): Promise<number> {
  const r = await controlPlanePool().query(
    `UPDATE showcase_sites
        SET generations = generations + 1,
            free_generation_used_at = CASE WHEN $2 THEN COALESCE(free_generation_used_at, now()) ELSE free_generation_used_at END,
            updated_at = now()
      WHERE id = $1 RETURNING generations`,
    [siteId, !!opts.free]
  )
  return Number(r.rows[0]?.generations ?? 0)
}

// ── Leads ────────────────────────────────────────────────────────────────────

export interface ShowcaseLead {
  id: string
  siteId: string
  name: string
  phone: string | null
  email: string | null
  message: string | null
  createdAt: string
  readAt: string | null
}

const toLead = (r: Row): ShowcaseLead => ({
  id: r.id,
  siteId: r.site_id,
  name: r.name,
  phone: r.phone ?? null,
  email: r.email ?? null,
  message: r.message ?? null,
  createdAt: iso(r.created_at)!,
  readAt: iso(r.read_at),
})

const LEAD_COLS = 'id, site_id, name, phone, email, message, created_at, read_at'

export async function insertShowcaseLead(
  siteId: string,
  lead: { name: string; phone?: string | null; email?: string | null; message?: string | null; sessionId?: string | null }
): Promise<ShowcaseLead> {
  const r = await controlPlanePool().query(
    `INSERT INTO showcase_leads (site_id, name, phone, email, message, session_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${LEAD_COLS}`,
    [siteId, lead.name, lead.phone || null, lead.email || null, lead.message || null, lead.sessionId || null]
  )
  return toLead(r.rows[0])
}

/** Newest first. `unread` lists only those not yet read; `total` and `unread` count the whole inbox. */
export async function listShowcaseLeads(
  siteId: string,
  opts: { limit?: number; offset?: number; unread?: boolean } = {}
): Promise<{ leads: ShowcaseLead[]; total: number; unread: number }> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200)
  const offset = Math.max(opts.offset ?? 0, 0)
  const pool = controlPlanePool()
  const [rows, counts] = await Promise.all([
    pool.query(
      `SELECT ${LEAD_COLS} FROM showcase_leads WHERE site_id = $1 ${opts.unread ? 'AND read_at IS NULL' : ''}
        ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [siteId, limit, offset]
    ),
    pool.query(`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE read_at IS NULL)::int AS unread FROM showcase_leads WHERE site_id = $1`, [siteId]),
  ])
  return { leads: rows.rows.map(toLead), total: counts.rows[0]?.total ?? 0, unread: counts.rows[0]?.unread ?? 0 }
}

export async function countUnreadShowcaseLeads(siteId: string): Promise<number> {
  const r = await controlPlanePool().query(`SELECT COUNT(*)::int AS n FROM showcase_leads WHERE site_id = $1 AND read_at IS NULL`, [siteId])
  return r.rows[0]?.n ?? 0
}

/** Mark some (or `all`) of the site's leads read, or unread again with read = false; returns how many changed. */
export async function markShowcaseLeadsRead(siteId: string, ids: string[] | 'all', read = true): Promise<number> {
  if (ids !== 'all' && !ids.length) return 0
  const r = await controlPlanePool().query(
    `UPDATE showcase_leads SET read_at = ${read ? 'now()' : 'NULL'}
      WHERE site_id = $1 AND read_at IS ${read ? 'NULL' : 'NOT NULL'} ${ids === 'all' ? '' : 'AND id = ANY($2::uuid[])'}`,
    ids === 'all' ? [siteId] : [siteId, ids]
  )
  return r.rowCount ?? 0
}
