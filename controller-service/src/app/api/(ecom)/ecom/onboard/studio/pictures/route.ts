import { NextRequest, NextResponse } from 'next/server'
import { fail, studioOf, studioView } from '@controller/lib/site-studio/http'
import { buildRunning, claimPictures } from '@controller/lib/site-studio/sessions'
import { reload, runPictures } from '@controller/lib/site-studio/build'

export const dynamic = 'force-dynamic'
export const maxDuration = 180

// The product photos of a built site, made again (its photo step made none because the image service was down).
// Part of the free generation; the pages are kept as they are.
export async function POST(request: NextRequest) {
  const ctx = await studioOf(request)
  if (ctx instanceof NextResponse) return ctx
  const { session } = ctx
  if (!Object.keys(session.pages ?? {}).length) return fail('Build your site first.', 409)
  if (buildRunning(session)) return fail('Your site is being built. Wait for it to finish first.', 409, { code: 'running' })
  if (session.progress && !(await claimPictures(session.id))) return fail('Your product photos are already being made. They will show in a minute or two.', 409, { code: 'running' })
  const r = await runPictures(session)
  if (!r.made) {
    console.error('[studio] product photos failed again:', r.error)
    return fail('Product photos could not be made right now: the image service is not available. Your pages are kept; try again later.', 503, { code: 'pictures_unavailable' })
  }
  return NextResponse.json({ ...studioView(await reload(session.id)), pictures: r.made })
}
