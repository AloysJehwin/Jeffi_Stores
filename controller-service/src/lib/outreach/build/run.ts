import { cleanAnswers, planShowcase, runStudioWithModel, showcaseBrief, type DesignDirection, type StudioModel } from '@/lib/site/studio'
import { getShowcaseById, recordShowcaseGeneration, type ShowcaseSiteRow } from '@/lib/showcase/store'
import { SHOWCASE_PAGE_KEY } from '@/lib/showcase/types'
import { runShowcaseBuild } from '@controller/lib/showcase-builder/build'
import { copyStudioPage, publishOwnerShowcase } from '@controller/lib/showcase-builder/publish'
import { detailsAnswers, startShowcaseStudio } from '@controller/lib/showcase-builder/studio'
import { runPageRebuild } from '@controller/lib/site-studio/build'
import { freeBudgetLeft, funded } from '@controller/lib/site-studio/funded'
import { BUDGET_INR, SHOWCASE_FREE_CAP_INR } from '@controller/lib/site-studio/allowance'
import type { SseSend } from '@controller/lib/site-studio/http'
import { claimBuild, claimRebuild, getStudioSession, getStudioSessionById, updateStudioSession, type StudioSession } from '@controller/lib/site-studio/sessions'
import { ensureOutreachSystemOwner } from '../claim'
import { getContact } from '../contacts'
import { recordEvent } from '../events'
import { briefHash, readBrief, studioAnswersOf } from './brief'
import { finishRun, readBuild, withContact, writeExtra } from './state'
import { directionOf, pickTheme, wornTheme } from './sketch'

// The full generation, run in the background while the call goes on (never awaited by a tool). It is the studio's own
// Showcase generation: the first is the site's free one (runShowcaseBuild: claimed, counted, starter content and
// mood pictures, the page copied onto the draft); each follow-up is the studio's "design this page again"
// (runPageRebuild) on the newer brief. Both run platform-funded (runStudioFunded: ai_usage priced but no store's
// wallet touched; the outreach owner has no workspace to bill) and on the faster model. A failure leaves the page as
// it was (the sketch, or the last design) and is recorded in outreach_events; nothing is thrown to the caller.

const MODELS: StudioModel[] = ['deep', 'agent', 'fast']
/** The gateway hint the outreach build writes on: Sonnet ('agent') unless OUTREACH_STUDIO_MODEL says otherwise. */
export const outreachModel = (): StudioModel => MODELS.find(m => m === process.env.OUTREACH_STUDIO_MODEL) ?? 'agent'

/** The free generation is used for the first design while this much of its budget (₹) is left. */
const MIN_FIRST_INR = 40
/** How long a run waits for the studio when a change holds it. */
const CLAIM_WAIT_MS = 90_000

const quiet: SseSend = () => {}
const errText = (err: unknown) => ((err as Error)?.message || String(err) || 'unknown error').slice(0, 300)

async function waitFor<T>(claim: () => Promise<T | null>, ms = CLAIM_WAIT_MS): Promise<T | null> {
  const until = Date.now() + ms
  for (;;) {
    const got = await claim()
    if (got || Date.now() >= until) return got
    await new Promise(r => setTimeout(r, 2000))
  }
}

/** The studio's page onto the site: a draft takes it at once; a live one (still the outreach owner's) is published again. */
export async function pushPage(site: ShowcaseSiteRow, session: StudioSession | null): Promise<boolean> {
  if (!session?.pages?.[SHOWCASE_PAGE_KEY]) return false
  if (site.status === 'draft') return copyStudioPage(site, session)
  if (site.status === 'live') return (await publishOwnerShowcase(site.ownerId, site.id)).ok
  return false
}

type RunResult = { ok: boolean; kind: 'first' | 'follow_up'; error?: string; spentInr?: number }

async function runOnce(contactId: string): Promise<RunResult> {
  const contact = await getContact(contactId)
  const site = contact?.showcase_site_id ? await getShowcaseById(contact.showcase_site_id) : null
  if (!contact || !site) return { ok: false, kind: 'first', error: 'no site to build' }
  const system = await ensureOutreachSystemOwner()
  if (site.ownerId !== system.id) return { ok: false, kind: 'first', error: 'the site was claimed' }
  const brief = readBrief(contact.extra)
  const session = (await getStudioSession(system.id, 'showcase', site.id)) ?? (await startShowcaseStudio(system.id, site))
  const answers = cleanAnswers({ ...session.answers, ...detailsAnswers(site), ...studioAnswersOf(brief) }) as unknown as Record<string, unknown>
  // The theme the sketch wears, unless the owner asked for another look or colour.
  const worn = wornTheme(session.direction)
  const themeId = pickTheme(brief.style, contactId, worn)
  const direction = (themeId === worn && session.direction ? session.direction : directionOf(themeId)) as DesignDirection
  const theme = direction.theme
  const kind: RunResult['kind'] = !session.generated_at && freeBudgetLeft(session) >= MIN_FIRST_INR ? 'first' : 'follow_up'
  const spent = async () => Number((await getStudioSessionById(session.id))?.spent_inr ?? 0)

  return runStudioWithModel(outreachModel(), async (): Promise<RunResult> => {
    if (kind === 'first') {
      const { b, p } = await funded(session.id, BUDGET_INR.small, async () => {
        const b = await showcaseBrief(answers)
        return { b, p: await planShowcase(b) }
      })
      await updateStudioSession(session.id, { answers, brief: b, plan: p, direction, theme })
      const claimed = await waitFor(() => claimBuild(session.id))
      if (!claimed) return { ok: false, kind, error: 'the studio was busy' }
      const done = await runShowcaseBuild(claimed, (await getShowcaseById(site.id)) ?? site, quiet)
      const ok = done?.status === 'ready' && !!done.pages?.[SHOWCASE_PAGE_KEY]
      return { ok, kind, spentInr: await spent(), ...(ok ? {} : { error: done?.error ?? 'the generation stopped' }) }
    }
    // The brief again from what is known now; "design this page again" plans the page afresh from it.
    const b = await funded(session.id, BUDGET_INR.small, () => showcaseBrief(answers))
    await updateStudioSession(session.id, { answers, brief: b, direction, theme })
    const claimed = await waitFor(() => claimRebuild(session.id, { allowEmpty: true }))
    if (!claimed) return { ok: false, kind, error: 'the studio was busy' }
    await runPageRebuild(claimed, SHOWCASE_PAGE_KEY, quiet, { run: async (_budget, fn) => ({ result: await funded(claimed.id, SHOWCASE_FREE_CAP_INR(), fn), chargedInr: 0 }) })
    const fresh = await getShowcaseById(site.id)
    if (fresh) await pushPage(fresh, await getStudioSessionById(claimed.id))
    await recordShowcaseGeneration(site.id).catch(err => console.warn('[outreach-build] generation not counted:', errText(err)))
    return { ok: true, kind, spentInr: await spent() }
  })
}

/** Runs the claimed generation and any follow-up queued behind it; never throws. */
export function startRun(contactId: string, runId: string): void {
  void runLoop(contactId, runId).catch(err => console.error('[outreach-build] run crashed:', errText(err)))
}

export async function runLoop(contactId: string, runId: string): Promise<void> {
  for (;;) {
    const t0 = Date.now()
    let r: RunResult
    try {
      r = await runOnce(contactId)
    } catch (err) {
      r = { ok: false, kind: 'first', error: errText(err) }
    }
    const ms = Date.now() - t0
    if (!r.ok) console.warn(`[outreach-build] ${r.kind} generation failed for ${contactId}: ${r.error}`)
    await recordEvent(contactId, r.ok ? 'build_finished' : 'build_failed', {
      actor: 'build',
      data: { kind: r.kind, ms, ...(r.spentInr !== undefined ? { spent_inr: r.spentInr } : {}), ...(r.error ? { error: r.error } : {}) },
    }).catch(() => {})
    const again = await withContact(contactId, async (c, tx) => {
      const f = finishRun(readBuild(c.extra), runId, { ok: r.ok, ms, error: r.error }, briefHash(readBrief(c.extra)))
      if (!f) return false
      await writeExtra(tx, contactId, { build: f.next })
      if (f.again) await recordEvent(contactId, 'build_started', { actor: 'build', data: { build: f.next.builds, follow_up: true } }, tx)
      return f.again
    }).catch(err => {
      console.error('[outreach-build] run state not saved:', errText(err))
      return false
    })
    if (!again) return
  }
}
