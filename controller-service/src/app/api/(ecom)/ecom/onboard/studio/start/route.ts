import { NextRequest, NextResponse } from 'next/server'
import { cleanAnswers } from '@/lib/site/studio'
import { aiUnavailable, fail, readJson, studioOwner, studioProductOf, studioSiteOf, studioView } from '@controller/lib/site-studio/http'
import { buildRunning, getStudioSession, startStudioSession, updateStudioSession } from '@controller/lib/site-studio/sessions'
import { studioStoreAnswers, studioStoreContext } from '@controller/lib/site-studio/context'
import { ownedShowcase } from '@controller/lib/showcase-builder/site'
import { startShowcaseStudio } from '@controller/lib/showcase-builder/studio'

export const dynamic = 'force-dynamic'

// Opens the owner's studio (or, with `restart`, clears it back to the brief), with the answers the wizard already
// knows filled in: the store's name, what it sells, its logo, tagline and story, contacts and social links.
export async function POST(request: NextRequest) {
  const owner = await studioOwner(request)
  if (owner instanceof NextResponse) return owner
  const down = await aiUnavailable()
  if (down) return down
  const body = (await readJson(request)) ?? {}
  const restart = body.restart === true
  const product = studioProductOf(request)
  const current = await getStudioSession(owner.id, product, studioSiteOf(request))
  if (restart && current && buildRunning(current)) return fail('Your site is being built. Wait for it to finish first.', 409)
  // A Showcase site's studio starts from its Details (saved first, as the draft site; ?site= names it).
  if (product === 'showcase') {
    const site = await ownedShowcase(owner.id, studioSiteOf(request))
    if (!site) return fail('Save your business details first.', 409)
    return NextResponse.json(studioView(await startShowcaseStudio(owner.id, site, restart)))
  }
  let session = await startStudioSession(owner.id, restart)
  if (!Object.keys(session.answers ?? {}).length) {
    const store = await studioStoreContext(owner.id)
    const given = typeof body.prefill === 'object' && body.prefill ? (body.prefill as Record<string, unknown>) : {}
    const answers = cleanAnswers({
      sell: store.categories.join(', '),
      ...studioStoreAnswers(store),
      ...given,
    })
    session = (await updateStudioSession(session.id, { answers: answers as unknown as Record<string, unknown> })) ?? session
  }
  return NextResponse.json(studioView(session))
}
