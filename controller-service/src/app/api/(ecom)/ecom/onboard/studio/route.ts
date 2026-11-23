import { NextRequest, NextResponse } from 'next/server'
import { studioAiAvailable, studioOwner, studioProductOf, studioSiteOf, studioView } from '@controller/lib/site-studio/http'
import { showcaseStudioState } from '@controller/lib/showcase-builder/studio'
import { getStudioSession } from '@controller/lib/site-studio/sessions'
import { studioStoreContext, syncStudioStore } from '@controller/lib/site-studio/context'

export const dynamic = 'force-dynamic'

// The owner's AI Site Studio (onboarding "Your site" step): the session, what is still free, and the store details
// the wizard already has, and whether AI generation is available now (`?fresh=1` checks again). The session first
// takes any Store-step change (no AI runs).
export async function GET(request: NextRequest) {
  const owner = await studioOwner(request)
  if (owner instanceof NextResponse) return owner
  const fresh = request.nextUrl.searchParams.get('fresh') === '1'
  if (studioProductOf(request) === 'showcase') return NextResponse.json(await showcaseStudioState(owner.id, studioSiteOf(request), { fresh }))
  const [session, store, available] = await Promise.all([getStudioSession(owner.id), studioStoreContext(owner.id), studioAiAvailable({ fresh })])
  const current = session ? await syncStudioStore(session, store).catch(() => session) : null
  return NextResponse.json({ ...studioView(current), store, ai: { available } })
}
