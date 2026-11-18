import 'server-only'
import { generatePage, regeneratePage, StudioAiDownError, StudioBudgetError, type PlannedPage, type StudioEvent } from '@/lib/site/studio'
import { PaidGenerationError, runPaidGeneration } from '@/lib/ai/paid-generation'
import { SHOWCASE_PAGE_KEY, SHOWCASE_REDESIGN_PRICE_INR } from '@/lib/showcase/types'
import { claimFreeShowcaseGeneration, recordShowcaseGeneration, type ShowcaseSiteRow } from '@/lib/showcase/store'
import { AI_UNAVAILABLE_CODE } from '@/lib/site/ai-status'
import { studioCtx } from '@controller/lib/site-studio/build'
import { freeBudgetLeft, funded } from '@controller/lib/site-studio/funded'
import { SHOWCASE_FREE_CAP_INR } from '@controller/lib/site-studio/allowance'
import type { SseSend } from '@controller/lib/site-studio/http'
import { copyStudioPage } from './publish'
import { addStarterContent } from './starter'
import { finishBuild, saveStudioPage, settlePaidBuild, updateStudioSession, type StudioProgress, type StudioSession } from '@controller/lib/site-studio/sessions'

// A Showcase's generations, streamed like the store's build (start · page · progress · page-done | page-failed), so
// the studio's build step follows them unchanged. The first is free (platform-funded on what is left of the ₹150 free
// budget, resumable); later ones are redesigns for SHOWCASE_REDESIGN_PRICE_INR, flat, from the workspace's AI wallet
// (lib/ai/paid-generation.ts), and design the page again from a fresh plan.

const slim = (e: StudioEvent) => (e.type === 'done' ? { type: e.type, page: e.page, skipped: e.skipped } : e)
const errText = (err: unknown) => ((err as Error)?.message || 'unknown error').slice(0, 300)

export const WALLET_URL = '/dashboard/wallet'

const progressOf = (page: PlannedPage, state: 'building' | 'done' | 'failed', message?: string): StudioProgress => ({
  page: page.key,
  done: state === 'done' ? [page.key] : [],
  failed: state === 'failed' ? [page.key] : [],
  total: 1,
  message,
  at: new Date().toISOString(),
})

/** A draft site takes each new page at once (the console can publish it); a live one only when the owner publishes. */
async function draftPage(site: ShowcaseSiteRow | null, s: StudioSession | null): Promise<StudioSession | null> {
  if (site?.status === 'draft' && s) await copyStudioPage(site, s).catch(err => console.warn('[showcase] draft page not saved:', errText(err)))
  return s
}

const pageOf = (s: StudioSession) => studioCtx(s).plan?.pages?.find(p => p.key === SHOWCASE_PAGE_KEY) ?? null

/** The free generation (claimed by claimBuild), or the resume of one that never finished. */
export async function runShowcaseBuild(session: StudioSession, site: ShowcaseSiteRow | null, send: SseSend): Promise<StudioSession | null> {
  const id = session.id
  const ctx = studioCtx(session)
  const page = pageOf(session)
  if (!page) return finishBuild(id, false, 'Your page is not planned yet. Answer the questions again.')
  send('start', { total: 1, done: [], pages: [{ key: page.key, label: page.label }] })
  if (site) await claimFreeShowcaseGeneration(site.id).catch(() => false)
  try {
    const doc = await funded(id, freeBudgetLeft(session), async () => {
      send('page', { key: page.key, label: page.label, sections: page.sections.length })
      await updateStudioSession(id, { progress: progressOf(page, 'building', `Designing ${page.label}`) })
      // Alongside the page: starter services, questions and mood pictures where the business gave none.
      const [doc] = await Promise.all([generatePage(ctx, page, e => send('progress', slim(e))), site ? addStarterContent(site, ctx.brief) : null])
      return doc
    })
    if (!doc.order.length) throw new Error('no section could be written')
    await saveStudioPage(id, page.key, doc, progressOf(page, 'done', 'Your page is ready'))
    send('page-done', { key: page.key, label: page.label })
    if (site) await recordShowcaseGeneration(site.id, { free: true }).catch(err => console.warn('[showcase] generation not counted:', errText(err)))
    return draftPage(site, await finishBuild(id, true))
  } catch (err) {
    console.error('[showcase] free generation failed:', errText(err))
    const message =
      err instanceof StudioAiDownError
        ? `${err.message} Try again in a little while.`
        : err instanceof StudioBudgetError
          ? 'The free generation budget ran out before your page was finished.'
          : 'The AI stopped before your page was finished. Try again: it is still free.'
    await updateStudioSession(id, { progress: progressOf(page, 'failed', message) })
    send('page-failed', { key: page.key, label: page.label, error: message })
    if (err instanceof StudioAiDownError) send('error', { error: message, code: AI_UNAVAILABLE_CODE })
    return finishBuild(id, false, message)
  }
}

/**
 * A redesign (claimed by claimPaidBuild): the page planned and designed again for SHOWCASE_REDESIGN_PRICE_INR from the
 * workspace's wallet. The price is held before the AI starts and kept only once the new page is saved; a run that fails
 * gives it back. When the wallet can't hold it nothing runs and the session is as it was. The page built before stays
 * until the new one replaces it.
 */
export async function runShowcasePaidBuild(session: StudioSession, site: ShowcaseSiteRow & { tenantId: string }, send: SseSend): Promise<{ session: StudioSession | null; chargedInr: number }> {
  const id = session.id
  const ctx = studioCtx(session)
  const current = pageOf(session)
  if (!current) return { session: await settlePaidBuild(id, 'Your page is not planned yet. Answer the questions again.'), chargedInr: 0 }
  const hadPage = !!session.pages?.[SHOWCASE_PAGE_KEY]
  send('start', { total: 1, done: [], pages: [{ key: current.key, label: current.label }], paid: true })
  try {
    const { chargedInr } = await runPaidGeneration(
      {
        tenantId: site.tenantId,
        capInr: SHOWCASE_REDESIGN_PRICE_INR,
        // As much AI as the free design gets; what it costs above the price is the platform's.
        flat: { budgetInr: SHOWCASE_FREE_CAP_INR() },
        // Unique per run: a ref that already ran is refused.
        ref: `showcase:${site.id}:${Date.now().toString(36)}`,
        label: `Showcase redesign for site-${site.slug}`.slice(0, 80),
        feature: 'showcase_generation',
      },
      // Everything up to the saved page, so a run that fails before it is not charged.
      async () => {
        send('page', { key: current.key, label: current.label, sections: current.sections.length })
        await updateStudioSession(id, { progress: progressOf(current, 'building', `Designing ${current.label}`) })
        // Starter services, FAQs and mood pictures fill any list still empty, as on the free design.
        const [made] = await Promise.all([
          hadPage ? regeneratePage(ctx, current, e => send('progress', slim(e))) : generatePage(ctx, current, e => send('progress', slim(e))).then(doc => ({ page: current, doc })),
          Promise.resolve()
            .then(() => addStarterContent(site, ctx.brief))
            .catch(err => console.warn('[showcase] starter content not added:', errText(err))),
        ])
        if (!made.doc.order.length) throw new Error('no section could be written')
        await updateStudioSession(id, { plan: { ...ctx.plan, pages: ctx.plan.pages.map(p => (p.key === current.key ? made.page : p)) } })
        await saveStudioPage(id, current.key, made.doc, progressOf(current, 'done', 'Your page is ready'))
      }
    )
    send('page-done', { key: current.key, label: current.label, chargedInr })
    await recordShowcaseGeneration(site.id).catch(err => console.warn('[showcase] generation not counted:', errText(err)))
    return { session: await draftPage(site, await settlePaidBuild(id)), chargedInr }
  } catch (err) {
    if (err instanceof PaidGenerationError) {
      send('error', { ...err.body(), priceInr: SHOWCASE_REDESIGN_PRICE_INR, topUpUrl: WALLET_URL })
      return { session: await settlePaidBuild(id, err.message), chargedInr: 0 }
    }
    console.error('[showcase] paid generation failed:', errText(err))
    const message =
      err instanceof StudioAiDownError
        ? `${err.message} Your page is as it was, and you were not charged.`
        : 'The page could not be designed again right now. Your page is as it was, and you were not charged.'
    send('page-failed', { key: current.key, label: current.label, error: message })
    if (err instanceof StudioAiDownError) send('error', { error: message, code: AI_UNAVAILABLE_CODE })
    return { session: await settlePaidBuild(id, message), chargedInr: 0 }
  }
}
