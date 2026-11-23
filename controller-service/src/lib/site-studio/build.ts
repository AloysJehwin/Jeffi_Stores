import 'server-only'
import {
  addPictures,
  CARD_KEY,
  generateCard,
  generatePage,
  regeneratePage,
  sampleCatalog,
  studioBudgetLeft,
  StudioAiDownError,
  StudioBudgetError,
  type DesignDirection,
  type PlannedPage,
  type SampleCatalog,
  type StudioBrief,
  type StudioCtx,
  type StudioEvent,
  type StudioPlan,
} from '@/lib/site/studio'
import { buildOrder } from '@/lib/site/studio/order'
import type { SseSend } from './http'
import { AI_UNAVAILABLE_CODE } from '@/lib/site/ai-status'
import { BUDGET_INR } from './allowance'
import { freeBudgetLeft, funded } from './funded'
import { PaidGenerationError } from '@/lib/ai/paid-generation'
import {
  finishBuild,
  getStudioSessionById,
  saveStudioPage,
  settleRebuild,
  updateStudioSession,
  type StudioProgress,
  type StudioSession,
} from './sessions'

// The live build behind the studio's generate and regenerate-page streams. Each finished page is saved at once, so a
// closed tab or a dropped connection keeps what was built; the wizard picks the session up again from the database.

export function studioCtx(s: StudioSession, plan?: StudioPlan): StudioCtx {
  return { brief: s.brief as StudioBrief, plan: plan ?? (s.plan as StudioPlan), direction: s.direction as DesignDirection, sessionId: s.id }
}

// Home first, then the header and footer, the main pages and the working pages (shared with Site Builder's redesign).
export { buildOrder }

/** A photo for every sample product (the new store is seeded with them), made last from what the free budget has left. */
const PICTURES = Number(process.env.SITE_STUDIO_SAMPLE_PICTURES ?? Infinity) // a cap; 0 turns them off
/** Photos are skipped when less than this (₹) is left, so the budget goes to pages first. */
const PICTURE_RESERVE_INR = 15
/** A sample product the photo step can still make a photo for. */
const unpictured = (p: SampleCatalog['products'][number]) => !p.images?.length && !!p.imagePrompt

// A page's finished doc travels in the database, not over the stream.
const slim = (e: StudioEvent) => (e.type === 'done' ? { type: e.type, page: e.page, skipped: e.skipped } : e)

const errText = (err: unknown) => ((err as Error)?.message || 'unknown error').slice(0, 300)

/**
 * The owner's free generation (or the resume of one that never finished), streamed page by page. Its budget is what
 * the session has left of the free cap, so a resumed build cannot spend it twice.
 */
export async function runStudioBuild(session: StudioSession, send: SseSend): Promise<StudioSession | null> {
  const id = session.id
  const ctx = studioCtx(session)
  const order = buildOrder(ctx.plan)
  const done = order.filter(p => session.pages?.[p.key]).map(p => p.key)
  const failed: string[] = []
  let pictures: StudioProgress['pictures']
  const progress = (page?: string, message?: string): StudioProgress => ({ page, done: [...done], failed: [...failed], total: order.length, message, at: new Date().toISOString(), ...(pictures ? { pictures } : {}) })
  const outOfBudget = (from: PlannedPage) => {
    for (const rest of order) if (!done.includes(rest.key) && !failed.includes(rest.key)) failed.push(rest.key)
    send('page-failed', { key: from.key, label: from.label, error: 'The free generation budget ran out before this page.' })
  }
  send('start', { total: order.length, done, pages: order.map(p => ({ key: p.key, label: p.label })) })
  try {
    await funded(id, freeBudgetLeft(session), async () => {
      if (!session.catalog) {
        send('status', { message: 'Choosing sample products for your preview' })
        await updateStudioSession(id, { progress: progress(undefined, 'Choosing sample products') })
        // Photos come after the pages (below); until then the Image part draws placeholders.
        const catalog = await sampleCatalog(ctx.brief, { images: 0 })
        await updateStudioSession(id, { catalog })
        send('catalog', { products: catalog.products.length, categories: catalog.categories.length })
      }
      // The site's product card, which every product list on the pages draws; without one the store's card stands in.
      if (session.product !== 'showcase' && ctx.brief.kind !== 'showcase' && !session.pages?.[CARD_KEY] && studioBudgetLeft() > 0) {
        send('status', { message: 'Designing your product card' })
        await updateStudioSession(id, { progress: progress(undefined, 'Designing your product card') })
        try {
          await saveStudioPage(id, CARD_KEY, await generateCard(ctx))
        } catch (err) {
          if (err instanceof StudioAiDownError) throw err
          if (!(err instanceof StudioBudgetError)) console.error('[studio] product card failed:', errText(err))
        }
      }
      for (const p of order) {
        if (done.includes(p.key)) continue
        if (studioBudgetLeft() <= 0) {
          outOfBudget(p)
          break
        }
        send('page', { key: p.key, label: p.label, sections: p.sections.length })
        await updateStudioSession(id, { progress: progress(p.key, `Designing ${p.label}`) })
        try {
          const doc = await generatePage(ctx, p, e => send('progress', slim(e)))
          if (!doc.order.length) throw new Error('no section could be written')
          done.push(p.key)
          await saveStudioPage(id, p.key, doc, progress(p.key, `${p.label} is ready`))
          send('page-done', { key: p.key, label: p.label })
        } catch (err) {
          if (err instanceof StudioBudgetError) {
            outOfBudget(p)
            break
          }
          if (err instanceof StudioAiDownError) throw err
          failed.push(p.key)
          console.error(`[studio] ${p.key} failed:`, errText(err))
          send('page-failed', { key: p.key, label: p.label, error: 'This page could not be designed. You can rebuild it once the rest is done.' })
        }
      }
      // Kept out of the store's gallery (skipGallery); a failure or a low budget leaves the placeholders.
      if (PICTURES > 0 && done.includes('store:home') && studioBudgetLeft() > PICTURE_RESERVE_INR) {
        const catalog = (await getStudioSessionById(id))?.catalog as SampleCatalog | null
        if (catalog && catalog.products.some(unpictured)) {
          send('status', { message: 'Adding product photos' })
          await updateStudioSession(id, { progress: progress(undefined, 'Adding product photos') })
          pictures = await addPictures(catalog, ctx.brief, PICTURES).catch(err => ({ made: 0, error: errText(err) }))
          if (pictures.made > 0) {
            await updateStudioSession(id, { catalog })
            send('catalog', { products: catalog.products.length, pictures: true })
          } else {
            console.error('[studio] product photos failed:', pictures.error)
            send('status', { message: 'Product photos could not be made right now' })
          }
        }
      }
    })
  } catch (err) {
    console.error('[studio] build failed:', errText(err))
    await updateStudioSession(id, { progress: progress(undefined, 'The build stopped') })
    if (err instanceof StudioAiDownError) {
      send('error', { error: `${err.message} The pages already built are kept.`, code: AI_UNAVAILABLE_CODE })
      return finishBuild(id, false, `${err.message} The pages already built are kept.`)
    }
    return finishBuild(id, false, 'The AI stopped before your site was finished. Try again: the pages already built are kept.')
  }
  await updateStudioSession(id, { progress: progress(undefined, failed.length ? `${done.length} of ${order.length} pages built` : 'Every page is built') })
  const homeOk = done.includes('store:home')
  return finishBuild(id, homeOk, homeOk ? undefined : 'The home page could not be designed. Try again: the pages already built are kept.')
}

/**
 * The product photos again, for a built site whose photo step stopped short (the image service was down, or the
 * budget ran out): the products still without one.
 */
export async function runPictures(session: StudioSession): Promise<{ made: number; error?: string }> {
  const catalog = session.catalog as SampleCatalog | null
  const missing = catalog?.products.filter(unpictured).length ?? 0
  const budget = Math.max(PICTURE_RESERVE_INR, freeBudgetLeft(session))
  const r = !catalog?.products.length
    ? { made: 0, error: 'There are no sample products to photograph.' }
    : !missing
      ? { made: catalog.products.filter(x => x.images?.length).length }
      : await funded(session.id, budget, () => addPictures(catalog, studioCtx(session).brief, PICTURES)).catch(err => ({ made: 0, error: errText(err) }))
  // Always written: it also releases the route's claim on the step.
  const p = session.progress
  await updateStudioSession(session.id, { ...(r.made && missing ? { catalog } : {}), ...(p ? { progress: { ...p, pictures: r, at: new Date().toISOString() } } : {}) })
  return r
}

/** A page that failed in the free generation, tried again: free, at most this many times per page. */
export const FREE_RETRIES = 2

/** One page planned and designed again (the owner's "regenerate page", or a free retry of a page that failed). */
/** Runs a rebuild's AI work and save on a budget; a paid correction (./corrections.ts) charges the wallet instead. */
export type RebuildRunner = <T>(budgetInr: number, fn: () => Promise<T>) => Promise<{ result: T; chargedInr: number }>

export async function runPageRebuild(session: StudioSession, key: string, send: SseSend, opts: { retry?: boolean; run?: RebuildRunner } = {}): Promise<StudioSession | null> {
  const ctx = studioCtx(session)
  const run: RebuildRunner = opts.run ?? (async (budgetInr, fn) => ({ result: await funded(session.id, budgetInr, fn), chargedInr: 0 }))
  if (key === CARD_KEY) return rebuildCard(session, ctx, send, run)
  const current = ctx.plan.pages.find(p => p.key === key)
  if (!current) {
    await settleRebuild(session.id)
    throw new Error('That page is not in your plan')
  }
  send('page', { key, label: current.label, sections: current.sections.length })
  // A retry counts against the free budget's remainder; a rebuild against its own page budget.
  const budget = opts.retry ? Math.min(BUDGET_INR.page, freeBudgetLeft(session)) : BUDGET_INR.page
  const tried = (ok: boolean) => {
    const p = session.progress
    if (!opts.retry || !p) return undefined
    const retries = { ...(p.retries ?? {}), [key]: (p.retries?.[key] ?? 0) + 1 }
    return ok
      ? { ...p, retries, failed: p.failed.filter(k => k !== key), done: [...new Set([...p.done, key])] }
      : { ...p, retries }
  }
  try {
    // Saved inside the run, so a page that can't be saved isn't charged.
    const { chargedInr } = await run(budget, async () => {
      const { page, doc } = await regeneratePage(ctx, current, e => send('progress', slim(e)))
      if (!doc.order.length) throw new Error('no section could be written')
      await updateStudioSession(session.id, { plan: { ...ctx.plan, pages: ctx.plan.pages.map(p => (p.key === key ? page : p)) }, ...(tried(true) ? { progress: tried(true) } : {}) })
      await saveStudioPage(session.id, key, doc)
    })
    send('page-done', { key, label: current.label, chargedInr })
    return settleRebuild(session.id, undefined, { completes: opts.retry })
  } catch (err) {
    console.error(`[studio] ${opts.retry ? 'retry' : 'rebuild'} ${key} failed:`, errText(err))
    const p = tried(false)
    if (p) await updateStudioSession(session.id, { progress: p })
    await settleRebuild(session.id)
    if (err instanceof StudioAiDownError || err instanceof PaidGenerationError) throw err
    throw new Error(opts.retry ? 'This page could not be designed this time. Your other pages are kept.' : 'This page could not be designed again right now. Your current version is kept.')
  }
}

/** The product card designed again, on a page's budget; the current one is kept when it fails. */
async function rebuildCard(session: StudioSession, ctx: StudioCtx, send: SseSend, run: RebuildRunner): Promise<StudioSession | null> {
  const label = 'Product card'
  send('page', { key: CARD_KEY, label, sections: 1 })
  try {
    const { chargedInr } = await run(BUDGET_INR.page, async () => saveStudioPage(session.id, CARD_KEY, await generateCard(ctx)))
    send('page-done', { key: CARD_KEY, label, chargedInr })
    return settleRebuild(session.id)
  } catch (err) {
    console.error('[studio] rebuild product card failed:', errText(err))
    await settleRebuild(session.id)
    if (err instanceof StudioAiDownError || err instanceof PaidGenerationError) throw err
    throw new Error('The product card could not be designed again right now. Your current card is kept.')
  }
}

export const reload = (id: string) => getStudioSessionById(id)
