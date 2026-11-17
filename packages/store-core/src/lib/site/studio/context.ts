import { normalizeTheme, type PageKey, type SiteAudience } from '@jeffi/site-blocks'
import { queryOne } from '@/lib/shared/db'
import { storeDescriptorForPrompt } from '@/lib/catalog/brand'
import { getStoreIdentity } from '@/lib/catalog/site-controls'
import { getPublishedTheme } from '../store'
import type { DesignDirection, PlannedPage, StudioBrief, StudioCtx, StudioPlan } from './types'

// The AI Site Studio's brief, plan and design direction, installed with the site so Site Builder can change its code
// sections the way the studio does (tweakSection). Stored in the store DB as one JSON row of site_settings, key
// `site_studio_context`: { brief, plan, direction, installedAt }. A store without one (built before, or not by the
// studio) gets a context from its own name and published theme.

const KEY = 'site_studio_context'

export interface StoredStudioContext {
  brief: StudioBrief
  plan: StudioPlan
  direction: DesignDirection
  installedAt: string
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** Saves the context a site was built with; false (nothing saved) when any part is missing or malformed. */
export async function saveStudioContext(input: { brief?: unknown; plan?: unknown; direction?: unknown }): Promise<boolean> {
  const { brief, plan, direction } = input
  if (!isObj(brief) || typeof brief.storeName !== 'string' || !isObj(plan) || !Array.isArray(plan.pages) || !isObj(direction) || !isObj(direction.theme)) return false
  await queryOne(
    `INSERT INTO site_settings (key, value, data_type, description, updated_at)
     VALUES ($1, $2, 'json', 'The AI Site Studio brief, plan and design direction this site was built from', now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [KEY, JSON.stringify({ brief, plan, direction, installedAt: new Date().toISOString() })]
  )
  return true
}

export async function getStudioContext(): Promise<StoredStudioContext | null> {
  const row = await queryOne<{ value: string | null }>(`SELECT value FROM site_settings WHERE key = $1`, [KEY]).catch(() => null)
  if (!row?.value) return null
  try {
    const v = JSON.parse(row.value) as StoredStudioContext
    return isObj(v?.brief) && isObj(v?.plan) && Array.isArray(v.plan.pages) && isObj(v?.direction) && isObj(v.direction.theme) ? v : null
  } catch {
    return null
  }
}

async function fallbackBrief(): Promise<StudioBrief> {
  const [identity, summary] = await Promise.all([getStoreIdentity().catch(() => null), storeDescriptorForPrompt().catch(() => '')])
  return {
    storeName: identity?.name || 'The store',
    summary,
    category: '',
    vocabulary: [],
    audience: 'shoppers in India',
    priceTier: 'mid',
    voice: 'warm, clear and specific',
    mood: 'as the rest of the site',
    artDirection: 'as the rest of the site',
    references: [],
    logoUrl: identity?.logoUrl ?? null,
    seed: 0,
  }
}

async function fallbackDirection(audience: SiteAudience): Promise<DesignDirection> {
  const t = normalizeTheme(await getPublishedTheme(audience).catch(() => null))
  return {
    id: 'store',
    name: 'The store’s theme',
    theme: { buttonShape: 'rounded', cardStyle: 'outlined', inputStyle: 'outlined', headingCase: 'normal', headingTracking: 'normal', shadow: 'soft', ...t },
    feel: 'store',
    layoutFeel: 'match the sections already on the site',
    rationale: '',
    fontsHref: '',
  }
}

/**
 * The context to change a code section of `page` with: `draftCtx` (a Site Builder redesign draft's), the installed one,
 * else one from the store's name and theme. The page is always in the plan, so the change compiles against the page it
 * is on; `key` names it for tweakSection.
 */
export async function studioCtxFor(
  ref: { audience: SiteAudience; page: PageKey },
  draftCtx?: Pick<StoredStudioContext, 'brief' | 'plan' | 'direction'> | null
): Promise<{ ctx: StudioCtx; key: string }> {
  const stored = draftCtx ?? (await getStudioContext())
  const [brief, direction] = await Promise.all([stored?.brief ?? fallbackBrief(), stored?.direction ?? fallbackDirection(ref.audience)])
  const plan: StudioPlan = stored?.plan ?? { approach: { id: 'store', name: 'Store', description: '' }, pages: [], themed: [] }
  const key = `${ref.audience}:${ref.page}`
  const own: PlannedPage = { key, audience: ref.audience, page: ref.page, label: ref.page, optional: false, enabled: true, approach: '', sections: [], required: [] }
  const pages = plan.pages.some(p => p.key === key) ? plan.pages : [own, ...plan.pages]
  return { ctx: { brief, plan: { ...plan, pages }, direction }, key }
}
