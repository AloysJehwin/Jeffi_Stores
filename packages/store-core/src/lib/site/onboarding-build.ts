import type { NextRequest } from 'next/server'
import { queryOne } from '@/lib/shared/db'
import { platformFunding, runPlatformFunded } from '@/lib/ai/billing'
import { aiSiteStatus, buildSiteInDraft, startAiSiteDraft, type SiteAgentInput } from './agent'
import { importLegacyLayouts, publishSiteDraft, setSiteBuilderEnabled } from './store'
import { afterSiteChange } from './after-publish'
import { installStudioSite } from './studio/install'
import type { StudioSiteInput } from './studio/types'
import { markFreeSiteGenerationUsed } from './site-generation'
import { themeOfDirection } from './themes/catalog'

// A new store's first site, built by the AI after payment (the controller's build_site provisioning step) on a
// platform-funded budget, or the site the owner already made in the AI Site Studio, installed as it is. The site is
// published and Site Builder made live, so the store opens with it. The state sits in site_settings so a retried step
// finds the build already running or done instead of starting another.

const KEY = 'site_ai_build'
const STALE_MS = 15 * 60_000

export interface OnboardingBuild {
  status: 'running' | 'done' | 'failed'
  step?: string
  draftId?: string
  style?: string
  summary?: string
  pages?: number
  pictures?: number
  spentInr?: number
  error?: string
  startedAt: string
  finishedAt?: string
  /** A ready-made theme (lib/site/themes) installed with the owner's free generation unused: the store keeps its own. */
  theme?: boolean
}

async function save(state: OnboardingBuild) {
  await queryOne(
    `INSERT INTO site_settings (key, value, data_type, description, updated_at)
     VALUES ($1, $2, 'json', 'The AI-built first site of this store', now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [KEY, JSON.stringify(state)]
  )
  // The store's first site is live: that was its free full generation (Site Builder charges the next one).
  if (state.status === 'done' && !state.theme) await markFreeSiteGenerationUsed().catch(err => console.warn('[site-build] free generation flag', (err as Error).message))
}

/** The build's state; while it runs, with the step the agent is on. */
export async function getOnboardingBuild(): Promise<OnboardingBuild | null> {
  const row = await queryOne<{ value: string | null }>(`SELECT value FROM site_settings WHERE key = $1`, [KEY]).catch(() => null)
  if (!row?.value) return null
  let state: OnboardingBuild
  try {
    state = JSON.parse(row.value)
  } catch {
    return null
  }
  if (state.status === 'running' && state.draftId) {
    const ai = await aiSiteStatus(state.draftId).catch(() => null)
    if (typeof ai?.step === 'string') state.step = ai.step
  }
  return state
}

/** Starts the build unless one is running or done; returns its state. */
export async function startOnboardingBuild(input: SiteAgentInput, budgetInr: number, request: Pick<NextRequest, 'headers'>): Promise<OnboardingBuild> {
  const current = await getOnboardingBuild()
  if (current?.status === 'done') return current
  if (current?.status === 'running' && Date.now() - Date.parse(current.startedAt) < STALE_MS) return current
  // Pages the store already has become the draft's base, so publishing replaces them cleanly.
  await importLegacyLayouts(null)
  const draftId = await startAiSiteDraft(null)
  const state: OnboardingBuild = { status: 'running', step: 'Reading your brief', draftId, startedAt: new Date().toISOString() }
  await save(state)
  const headers = new Headers({ host: request.headers.get('host') ?? '' })
  void runPlatformFunded('site-build', budgetInr, () => finish(state, input, { headers })).catch(err => console.error('[site-build]', err))
  return state
}

async function finish(state: OnboardingBuild, input: SiteAgentInput, request: Pick<NextRequest, 'headers'>) {
  const r = await buildSiteInDraft(state.draftId!, input, null)
  const spentInr = platformFunding()?.spentInr
  if (!r.ok) return save({ ...state, status: 'failed', step: 'The AI could not finish', error: r.error, spentInr, finishedAt: new Date().toISOString() })
  try {
    await publishSiteDraft(state.draftId!, null)
    await setSiteBuilderEnabled(true)
    await afterSiteChange(request)
  } catch (err) {
    return save({ ...state, status: 'failed', step: 'Publishing failed', error: (err as Error).message?.slice(0, 200), spentInr, finishedAt: new Date().toISOString() })
  }
  await save({ status: 'done', step: 'Your site is live', style: r.style, summary: r.summary, pages: r.pages, pictures: r.pictures, spentInr, startedAt: state.startedAt, finishedAt: new Date().toISOString() })
}

/** Installs the owner's AI Site Studio site (no AI calls) unless an install is running or done; returns its state. */
export async function startStudioInstall(input: StudioSiteInput, request: Pick<NextRequest, 'headers'>): Promise<OnboardingBuild> {
  const current = await getOnboardingBuild()
  if (current?.status === 'done') return current
  if (current?.status === 'running' && Date.now() - Date.parse(current.startedAt) < STALE_MS) return current
  // A ready-made theme's site used no AI: unless the studio's free generation went before it, the store keeps its own.
  const theme = !!themeOfDirection(input.direction) && input.freeUsed === false
  const state: OnboardingBuild = { status: 'running', step: 'Installing your site', style: input.style, startedAt: new Date().toISOString(), ...(theme ? { theme } : {}) }
  await save(state)
  const headers = new Headers({ host: request.headers.get('host') ?? '' })
  void installStudioSite(input, null, { request: { headers } })
    .then(r => save({ ...state, status: 'done', step: 'Your site is live', pages: r.pages, pictures: 0, summary: r.skipped.length ? `${r.skipped.length} page layouts were skipped` : undefined, finishedAt: new Date().toISOString() }))
    .catch(err => save({ ...state, status: 'failed', step: 'Installing failed', error: (err as Error).message?.slice(0, 200), finishedAt: new Date().toISOString() }))
    .catch(err => console.error('[site-build] studio install', err))
  return state
}
