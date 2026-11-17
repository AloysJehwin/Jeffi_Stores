import { NextRequest, NextResponse } from 'next/server'
import { aiUnavailable, fail, readJson, sseResponse, studioOf, studioView } from '@controller/lib/site-studio/http'
import { buildRunning, claimRebuild, refundTweaks, spendTweaks } from '@controller/lib/site-studio/sessions'
import { COST, TWEAKS_PER_DAY } from '@controller/lib/site-studio/allowance'
import { FREE_RETRIES, reload, runPageRebuild } from '@controller/lib/site-studio/build'
import { freeBudgetLeft } from '@controller/lib/site-studio/funded'
import { CARD_KEY, type StudioPlan } from '@/lib/site/studio'
import { showcaseGenerate } from '@controller/lib/showcase-builder/generate'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// Plans and designs one page again (body: { page: "store:about" }), streamed like generate. Counts as several of the
// day's free tweaks. With { retry: true }, a page that failed in the free generation is tried again for free (at most
// FREE_RETRIES times per page, within the free budget).
export async function POST(request: NextRequest) {
  const ctx = await studioOf(request)
  if (ctx instanceof NextResponse) return ctx
  const { session } = ctx
  const body = await readJson(request)
  const key = typeof body?.page === 'string' ? body.page : ''
  // The site's product card isn't a planned page, but a store can design it again like one.
  const card = key === CARD_KEY && session.product !== 'showcase'
  if (!card && !(session.plan as StudioPlan | null)?.pages.some(p => p.key === key)) return fail('That page is not in your plan')
  const retry = body?.retry === true
  // A Showcase's one page designed again is a generation (free while the free one lasts, then charged).
  if (session.product === 'showcase' && !retry) return showcaseGenerate(ctx.owner, session, body)
  if (buildRunning(session)) return fail('Your site is being built. Wait for it to finish first.', 409, { code: 'running' })
  const down = await aiUnavailable()
  if (down) return down
  if (retry) {
    if (!session.progress?.failed.includes(key)) return fail('Only a page that failed can be retried for free.')
    if ((session.progress.retries?.[key] ?? 0) >= FREE_RETRIES) return fail('This page was already retried twice. Use “Design this page again” instead.', 429)
    if (freeBudgetLeft(session) <= 0) return fail('The free generation budget is used up. You can design this page again with your free changes.', 429)
  } else {
    if (!Object.keys(session.pages ?? {}).length) return fail('Build your site first.', 409)
    if (!(await spendTweaks(session.id, COST.regenerate, TWEAKS_PER_DAY))) return fail('You have used today’s free changes. Come back tomorrow for more.', 429)
  }
  const claimed = await claimRebuild(session.id, { allowEmpty: retry })
  if (!claimed) {
    if (!retry) await refundTweaks(session.id, COST.regenerate)
    return fail('Your site is busy. Try again in a moment.', 409, { code: 'running' })
  }
  return sseResponse(async send => {
    try {
      await runPageRebuild(claimed, key, send, { retry })
    } catch (err) {
      if (!retry) await refundTweaks(claimed.id, COST.regenerate)
      send('page-failed', { key, error: (err as Error).message })
    }
    send('done', studioView(await reload(claimed.id)))
  })
}
