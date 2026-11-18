import { NextRequest, NextResponse } from 'next/server'
import { aiUnavailable, fail, readJson, sseResponse, studioOf, studioView } from '@controller/lib/site-studio/http'
import { buildRunning, claimBuild } from '@controller/lib/site-studio/sessions'
import { AFTER_LIVE, allowanceOf } from '@controller/lib/site-studio/allowance'
import { reload, runStudioBuild } from '@controller/lib/site-studio/build'
import { showcaseGenerate } from '@controller/lib/showcase-builder/generate'
import { themeOfDirection } from '@/lib/site/themes/catalog'

export const dynamic = 'force-dynamic'
export const maxDuration = 900

// The owner's free full-site generation, streamed (text/event-stream) page by page, home first:
//   start {total, done, pages} · status {message} · catalog · page {key, label, sections}
//   progress <StudioEvent> · page-done {key} · page-failed {key, error} · done <session view> · error {error}
// Once per owner: a build that never finished resumes; after a finished one, another waits until the store is live.
// A Showcase (?product=showcase) has its one page built; after the free generation, each is charged to the wallet.
export async function POST(request: NextRequest) {
  const ctx = await studioOf(request)
  if (ctx instanceof NextResponse) return ctx
  const { session } = ctx
  if (session.product === 'showcase') return showcaseGenerate(ctx.owner, session, await readJson(request))
  if (!session.direction) return fail('Choose a design direction first.', 409)
  // A ready-made theme's site counts as built: the free generation waits for "Design with AI instead" (a fresh brief).
  if (themeOfDirection(session.direction)) return fail('Your site comes from a ready-made theme. Choose “Design with AI instead” to have the AI design it.', 409, { code: 'theme' })
  if (allowanceOf(session).free === 'used') return fail(AFTER_LIVE, 403, { code: 'after_live' })
  const down = await aiUnavailable()
  if (down) return down
  const claimed = await claimBuild(session.id)
  if (!claimed) {
    if (buildRunning(session)) return fail('Your site is already being built.', 409, { code: 'running' })
    return fail(AFTER_LIVE, 403, { code: 'after_live' })
  }
  return sseResponse(async send => {
    await runStudioBuild(claimed, send)
    send('done', studioView(await reload(claimed.id)))
  })
}
