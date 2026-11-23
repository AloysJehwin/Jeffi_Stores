import 'server-only'
import { controlPlanePool } from '@/lib/tenant-registry'
import type { PageDoc, ThemeTokens } from '@jeffi/site-blocks'
import type { StudioProduct } from '@/lib/site/studio/types'
import { SHOWCASE_PAGE_KEY } from '@/lib/showcase/types'

// One AI Site Studio per owner and product (site_studio_sessions): the onboarding "Your site" step writes the store's,
// the preview reads it and the build_site provisioning step installs it; the Showcase signup writes the owner's
// 'showcase' one, which is published with the Showcase. JSON columns hold the pipeline's own types
// (packages/store-core/src/lib/site/studio); this module only stores them.

export type { StudioProduct }
export type StudioStatus = 'brief' | 'plan' | 'direction' | 'building' | 'ready' | 'failed'

/** The page a product's site cannot do without: the store's home page, a Showcase's one page. */
export const homeKeyOf = (product: StudioProduct | null | undefined) => (product === 'showcase' ? SHOWCASE_PAGE_KEY : 'store:home')

export interface StudioProgress {
  page?: string
  done: string[]
  failed: string[]
  /** Free retries used per page that failed in the free generation. */
  retries?: Record<string, number>
  total: number
  message?: string
  at: string
  /** The product-photo step: how many were made, and why it stopped when it made none. */
  pictures?: { made: number; error?: string; running?: boolean; at?: string }
}

export interface StudioSession {
  id: string
  owner_id: string
  product: StudioProduct
  status: StudioStatus
  answers: Record<string, unknown>
  brief: unknown | null
  plan: unknown | null
  directions: unknown[]
  direction: unknown | null
  catalog: unknown | null
  pages: Record<string, PageDoc>
  theme: ThemeTokens | null
  progress: StudioProgress | null
  error: string | null
  /** Platform-funded AI spend so far, ₹. */
  spent_inr: number
  free_used_at: string | null
  generated_at: string | null
  tweaks_today: number
  tweaks_day: string | null
  /** The owner's free corrections used today, across their studios (site_studio_corrections). */
  corrections_today?: number
  tenant_id: string | null
  installed_at: string | null
  created_at: string
  updated_at: string
}

const COLS = `id, owner_id, product, status, answers, brief, plan, directions, direction, catalog, pages, theme, progress, error,
  spent_inr::float8 AS spent_inr, free_used_at, generated_at, tweaks_today, to_char(tweaks_day, 'YYYY-MM-DD') AS tweaks_day, tenant_id, installed_at,
  created_at, updated_at,
  COALESCE((SELECT c.used FROM site_studio_corrections c WHERE c.owner_id = site_studio_sessions.owner_id
    AND c.day = (now() AT TIME ZONE 'Asia/Kolkata')::date), 0) AS corrections_today`

/** homeKeyOf in SQL, for the row's own product. */
const HOME_SQL = `(CASE WHEN product = 'showcase' THEN '${SHOWCASE_PAGE_KEY}' ELSE 'store:home' END)`

/** A build that has not written for this long died with its process; it may be resumed. */
export const BUILD_STALE_MS = 10 * 60_000

const pool = () => controlPlanePool()

export async function getStudioSession(ownerId: string, product: StudioProduct = 'store'): Promise<StudioSession | null> {
  const r = await pool().query<StudioSession>(`SELECT ${COLS} FROM site_studio_sessions WHERE owner_id = $1 AND product = $2`, [ownerId, product])
  return r.rows[0] ?? null
}

export async function getStudioSessionById(id: string): Promise<StudioSession | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null
  const r = await pool().query<StudioSession>(`SELECT ${COLS} FROM site_studio_sessions WHERE id = $1`, [id])
  return r.rows[0] ?? null
}

export const buildRunning = (s: Pick<StudioSession, 'status' | 'updated_at'>) =>
  s.status === 'building' && Date.now() - Date.parse(s.updated_at) < BUILD_STALE_MS

/**
 * Claims the photo step for one request, so a second tab or a reload cannot pay for the same photos again. The claim
 * lapses after 4 minutes (the route gives up at 3) in case its process died; the step's result replaces it.
 */
export async function claimPictures(id: string): Promise<boolean> {
  const r = await pool().query(
    `UPDATE site_studio_sessions
        SET progress = jsonb_set(progress, '{pictures}', jsonb_build_object('made', 0, 'running', true, 'at', now()))
      WHERE id = $1 AND progress IS NOT NULL
        AND NOT coalesce((progress->'pictures'->>'running')::boolean AND (progress->'pictures'->>'at')::timestamptz > now() - interval '4 minutes', false)`,
    [id],
  )
  return r.rowCount === 1
}

/**
 * The owner's studio, created on first use. `restart` clears the brief and everything after it; the free generation
 * and the day's tweak count stay with the owner, and a site already installed into a store stays installed there.
 */
export async function startStudioSession(ownerId: string, restart = false, product: StudioProduct = 'store'): Promise<StudioSession> {
  const r = await pool().query<StudioSession>(
    `INSERT INTO site_studio_sessions (owner_id, product) VALUES ($1, $3)
     ON CONFLICT (owner_id, product) DO UPDATE SET
       status = 'brief', answers = '{}'::jsonb, brief = NULL, plan = NULL, directions = '[]'::jsonb, direction = NULL,
       catalog = NULL, pages = '{}'::jsonb, theme = NULL, progress = NULL, error = NULL, tenant_id = NULL,
       installed_at = NULL, updated_at = now()
     WHERE $2::boolean
     RETURNING ${COLS}`,
    [ownerId, restart, product]
  )
  return r.rows[0] ?? (await getStudioSession(ownerId, product))!
}

type Patch = Partial<
  Pick<StudioSession, 'status' | 'answers' | 'brief' | 'plan' | 'directions' | 'direction' | 'catalog' | 'pages' | 'theme' | 'progress' | 'error'>
>
const JSON_COLS = new Set(['answers', 'brief', 'plan', 'directions', 'direction', 'catalog', 'pages', 'theme', 'progress'])

export async function updateStudioSession(id: string, patch: Patch): Promise<StudioSession | null> {
  const keys = Object.keys(patch) as (keyof Patch)[]
  if (!keys.length) return getStudioSessionById(id)
  const sets = keys.map((k, i) => `${k} = $${i + 2}${JSON_COLS.has(k) ? '::jsonb' : ''}`)
  const values = keys.map(k => (JSON_COLS.has(k) ? (patch[k] == null ? null : JSON.stringify(patch[k])) : patch[k]))
  const r = await pool().query<StudioSession>(
    `UPDATE site_studio_sessions SET ${sets.join(', ')}, updated_at = now() WHERE id = $1 RETURNING ${COLS}`,
    [id, ...values]
  )
  return r.rows[0] ?? null
}

/** Adds what one platform-funded AI run spent (lib/site/studio studioSpentInr). */
export async function addStudioSpend(id: string, inr: number): Promise<void> {
  if (!(inr > 0)) return
  await pool().query(`UPDATE site_studio_sessions SET spent_inr = spent_inr + $2 WHERE id = $1`, [id, Math.round(inr * 10_000) / 10_000])
}

/** Saves one page as it is built, so a dropped connection keeps every finished page. */
export async function saveStudioPage(id: string, key: string, doc: PageDoc, progress?: StudioProgress): Promise<void> {
  await pool().query(
    `UPDATE site_studio_sessions SET pages = jsonb_set(pages, ARRAY[$2::text], $3::jsonb, true),
       progress = COALESCE($4::jsonb, progress), updated_at = now() WHERE id = $1`,
    [id, key, JSON.stringify(doc), progress ? JSON.stringify(progress) : null]
  )
}

/**
 * Takes the build for this request: the free generation is claimed on its first run (free_used_at), and a run that
 * never finished (generated_at unset) may resume. Null when another build is running or the free one was used up.
 */
export async function claimBuild(id: string): Promise<StudioSession | null> {
  const r = await pool().query<StudioSession>(
    `UPDATE site_studio_sessions
        SET status = 'building', free_used_at = COALESCE(free_used_at, now()), error = NULL, updated_at = now()
      WHERE id = $1 AND generated_at IS NULL AND direction IS NOT NULL
        AND (status <> 'building' OR updated_at < now() - make_interval(secs => $2))
      RETURNING ${COLS}`,
    [id, BUILD_STALE_MS / 1000]
  )
  return r.rows[0] ?? null
}

/**
 * A Showcase's paid generation (its free one is used): the whole page designed again, charged to the wallet. Takes the
 * session like claimBuild, without the once-only rule; the page built before stays until the new one replaces it.
 */
export async function claimPaidBuild(id: string): Promise<StudioSession | null> {
  const r = await pool().query<StudioSession>(
    `UPDATE site_studio_sessions SET status = 'building', error = NULL, updated_at = now()
      WHERE id = $1 AND product = 'showcase' AND direction IS NOT NULL
        AND (status <> 'building' OR updated_at < now() - make_interval(secs => $2))
      RETURNING ${COLS}`,
    [id, BUILD_STALE_MS / 1000]
  )
  return r.rows[0] ?? null
}

/** After a paid generation: ready while the page exists (the new one, or the one it failed to replace). */
export async function settlePaidBuild(id: string, error?: string): Promise<StudioSession | null> {
  const r = await pool().query<StudioSession>(
    `UPDATE site_studio_sessions SET status = CASE WHEN pages ? ${HOME_SQL} THEN 'ready' ELSE 'failed' END, error = $2, updated_at = now()
      WHERE id = $1 RETURNING ${COLS}`,
    [id, error ?? null]
  )
  return r.rows[0] ?? null
}

export async function finishBuild(id: string, ok: boolean, error?: string): Promise<StudioSession | null> {
  const r = await pool().query<StudioSession>(
    `UPDATE site_studio_sessions
        SET status = $2::varchar, generated_at = CASE WHEN $2::varchar = 'ready' THEN now() ELSE generated_at END, error = $3, updated_at = now()
      WHERE id = $1 RETURNING ${COLS}`,
    [id, ok ? 'ready' : 'failed', error ?? null]
  )
  return r.rows[0] ?? null
}

/** Takes a built site for one page's rebuild (regenerate-page, a tweak's big brother); null while anything runs. A free
 *  retry of a failed page may run before any page exists. */
export async function claimRebuild(id: string, opts: { allowEmpty?: boolean } = {}): Promise<StudioSession | null> {
  const r = await pool().query<StudioSession>(
    `UPDATE site_studio_sessions SET status = 'building', error = NULL, updated_at = now()
      WHERE id = $1 AND direction IS NOT NULL AND (${opts.allowEmpty ? 'true' : "pages <> '{}'::jsonb"})
        AND (status IN ('ready','failed') OR (status = 'building' AND updated_at < now() - make_interval(secs => $2)))
      RETURNING ${COLS}`,
    [id, BUILD_STALE_MS / 1000]
  )
  return r.rows[0] ?? null
}

/** After a page rebuild: ready while the home page exists; generated_at is left as the full build set it. A retry that
 *  brings the home page in completes the free generation (generated_at), as a full build would have. */
export async function settleRebuild(id: string, error?: string, opts: { completes?: boolean } = {}): Promise<StudioSession | null> {
  const r = await pool().query<StudioSession>(
    `UPDATE site_studio_sessions SET status = CASE WHEN pages ? ${HOME_SQL} THEN 'ready' ELSE 'failed' END, error = $2,
            generated_at = CASE WHEN $3::boolean AND generated_at IS NULL AND pages ? ${HOME_SQL} THEN now() ELSE generated_at END,
            updated_at = now()
      WHERE id = $1 RETURNING ${COLS}`,
    [id, error ?? null, !!opts.completes]
  )
  return r.rows[0] ?? null
}

/** Counts `cost` against today's design help (IST day); false when the day's allowance is spent. */
export async function spendTweaks(id: string, cost: number, perDay: number): Promise<boolean> {
  const r = await pool().query(
    `UPDATE site_studio_sessions
        SET tweaks_today = CASE WHEN tweaks_day = (now() AT TIME ZONE 'Asia/Kolkata')::date THEN tweaks_today ELSE 0 END + $2,
            tweaks_day = (now() AT TIME ZONE 'Asia/Kolkata')::date, updated_at = now()
      WHERE id = $1
        AND CASE WHEN tweaks_day = (now() AT TIME ZONE 'Asia/Kolkata')::date THEN tweaks_today ELSE 0 END + $2 <= $3
      RETURNING id`,
    [id, cost, perDay]
  )
  return (r.rowCount ?? 0) > 0
}

/** Gives back tweaks charged for work that failed. */
export async function refundTweaks(id: string, cost: number): Promise<void> {
  await pool().query(`UPDATE site_studio_sessions SET tweaks_today = GREATEST(0, tweaks_today - $2) WHERE id = $1`, [id, cost])
}

/** The site to install into a store: the owner's finished studio, unless it already went into another store. */
export async function studioSiteForTenant(tenantId: string): Promise<StudioSession | null> {
  const r = await pool().query<StudioSession>(
    `SELECT ${COLS} FROM site_studio_sessions
      WHERE owner_id IN (SELECT owner_id FROM owner_tenants WHERE tenant_id = $1) AND product = 'store'
        AND status = 'ready' AND pages <> '{}'::jsonb AND (tenant_id IS NULL OR tenant_id = $1)
      LIMIT 1`,
    [tenantId]
  )
  return r.rows[0] ?? null
}

/** Binds the session to the store installing it (so no other store takes it), and stamps the install once done. */
export async function markStudioInstalled(id: string, tenantId: string, done: boolean): Promise<void> {
  await pool().query(
    `UPDATE site_studio_sessions SET tenant_id = $2,
       installed_at = CASE WHEN $3::boolean THEN COALESCE(installed_at, now()) ELSE installed_at END, updated_at = now()
     WHERE id = $1`,
    [id, tenantId, done]
  )
}
