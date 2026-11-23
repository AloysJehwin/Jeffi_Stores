import { NextRequest, NextResponse } from 'next/server'
import { directions, newDirection, shuffleColours, type DesignDirection, type StudioBrief } from '@/lib/site/studio'
import { aiDownFrom, aiUnavailable, fail, readJson, studioOf, studioView } from '@controller/lib/site-studio/http'
import { refundTweaks, spendTweaks, updateStudioSession } from '@controller/lib/site-studio/sessions'
import { COST, HELP_PER_DAY } from '@controller/lib/site-studio/allowance'
import { funded, preBuildBudget } from '@controller/lib/site-studio/funded'
import { designLocked } from '@controller/lib/site-studio/rules'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

// Design directions. action:
//   generate  three directions (the first set is free; `ask` is the owner's free-text override)
//   shuffle   a new palette for direction `index` (no AI)
//   new       replaces direction `index` with a different one (`ask` optional)
export async function POST(request: NextRequest) {
  const ctx = await studioOf(request)
  if (ctx instanceof NextResponse) return ctx
  const { session } = ctx
  const b = session.brief as StudioBrief | null
  if (!b || !session.plan) return fail('Answer the questions first.', 409)
  const lock = designLocked(session)
  if (lock) return fail(lock, 409)
  const body = await readJson(request)
  const action = body?.action
  const ask = typeof body?.ask === 'string' ? body.ask.trim().slice(0, 300) || undefined : undefined
  const shown = (session.directions ?? []) as DesignDirection[]
  const index = Number(body?.index)
  const chosen = session.direction as DesignDirection | null
  if (action === 'generate' || action === 'new') {
    const down = await aiUnavailable()
    if (down) return down
  }

  if (action === 'shuffle' || action === 'new') {
    const old = shown[index]
    if (!old) return fail('No such direction')
    let next: DesignDirection
    if (action === 'shuffle') next = shuffleColours(b, old)
    else {
      if (!(await spendTweaks(session.id, COST.help, HELP_PER_DAY))) return fail('You have asked for a lot of new directions today. Pick one of these, or come back tomorrow.', 429)
      try {
        next = await funded(session.id, preBuildBudget(session), () => newDirection(b, shown, ask))
      } catch (err) {
        await refundTweaks(session.id, COST.help)
        return aiDownFrom(err) ?? fail('The AI could not make a new direction right now. Try again in a moment.', 502)
      }
    }
    const list = shown.map((d, i) => (i === index ? next : d))
    const wasChosen = chosen?.id === old.id
    const saved = await updateStudioSession(session.id, {
      directions: list,
      ...(wasChosen ? { direction: next, theme: next.theme } : {}),
    })
    return NextResponse.json(studioView(saved))
  }

  if (action !== 'generate') return fail('Unknown action')
  const charge = shown.length > 0
  if (charge && !(await spendTweaks(session.id, COST.directions, HELP_PER_DAY))) return fail('You have asked for a lot of directions today. Pick one of these, or come back tomorrow.', 429)
  try {
    const list = await funded(session.id, preBuildBudget(session), () => directions(b, 3, { avoid: ask ? undefined : shown.length ? shown : undefined, ask }))
    const saved = await updateStudioSession(session.id, { directions: list, direction: null, theme: null, status: 'direction' })
    return NextResponse.json(studioView(saved))
  } catch (err) {
    if (charge) await refundTweaks(session.id, COST.directions)
    console.error('[studio] directions failed:', (err as Error).message)
    return aiDownFrom(err) ?? fail('The AI could not suggest directions right now. Try again in a moment.', 502)
  }
}
