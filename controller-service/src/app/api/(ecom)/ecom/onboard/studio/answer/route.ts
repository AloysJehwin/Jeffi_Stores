import { NextRequest, NextResponse } from 'next/server'
import { brief, cleanAnswers, plan, planShowcase, showcaseBrief, suggestAnswer, suggestShowcaseAnswer } from '@/lib/site/studio'
import { aiDownFrom, aiUnavailable, fail, readJson, studioOf, studioView } from '@controller/lib/site-studio/http'
import { refundTweaks, spendTweaks, updateStudioSession } from '@controller/lib/site-studio/sessions'
import { allowanceOf, COST, TWEAKS_PER_DAY } from '@controller/lib/site-studio/allowance'
import { funded, preBuildBudget } from '@controller/lib/site-studio/funded'
import { designLocked } from '@controller/lib/site-studio/rules'
import { studioStoreContext } from '@controller/lib/site-studio/context'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const HELPABLE = ['sell', 'audience', 'mood', 'notes']

// The brief: saves the owner's answers; `help` suggests an answer to one question ("Help me answer"); `finish`
// reads the answers into a brief and plans the store's pages.
export async function POST(request: NextRequest) {
  const ctx = await studioOf(request)
  if (ctx instanceof NextResponse) return ctx
  const { owner, session } = ctx
  const showcase = session.product === 'showcase'
  const body = await readJson(request)
  if (!body) return fail('Invalid JSON')

  const given = body.answers && typeof body.answers === 'object' ? (body.answers as Record<string, unknown>) : {}
  const answers = cleanAnswers({ ...session.answers, ...given })
  const help = typeof body.help === 'string' ? body.help : null
  if (help && !HELPABLE.includes(help)) return fail('Unknown question')
  const lock = body.finish ? designLocked(session) : null
  if (lock) return fail(lock, 409)
  if (help || body.finish) {
    const down = await aiUnavailable()
    if (down) return down
  }

  let current = (await updateStudioSession(session.id, { answers: answers as unknown as Record<string, unknown> })) ?? session

  if (help) {
    if (!(await spendTweaks(session.id, COST.help, TWEAKS_PER_DAY))) return fail('You have used today’s free AI help. Write it in your own words, or come back tomorrow.', 429)
    try {
      const suggestion = await funded(session.id, preBuildBudget(session), () => (showcase ? suggestShowcaseAnswer(help, answers) : suggestAnswer(help, answers)))
      if (!suggestion) throw new Error('empty')
      return NextResponse.json({ suggestion, allowance: allowanceOf({ ...current, tweaks_today: current.tweaks_today + COST.help }) })
    } catch (err) {
      await refundTweaks(session.id, COST.help)
      return aiDownFrom(err) ?? fail('The AI could not suggest an answer right now. Try again in a moment.', 502)
    }
  }

  if (body.finish) {
    if ((answers.sell ?? '').length < 3) return fail(showcase ? 'Tell us what you do first.' : 'Tell us what you sell first.')
    // The first brief is part of the free flow; writing it again counts against the day's tweaks.
    const again = !!session.brief
    if (again && !(await spendTweaks(session.id, COST.directions, TWEAKS_PER_DAY))) return fail('You have changed the brief a lot today. Come back tomorrow, or carry on with this one.', 429)
    try {
      const { b, p } = await funded(session.id, preBuildBudget(session), async () => {
        // A Showcase plans its one page; a store plans its pages for the audiences its plan has.
        if (showcase) {
          const b = await showcaseBrief(answers)
          return { b, p: await planShowcase(b) }
        }
        const store = await studioStoreContext(owner.id)
        const b = await brief(answers)
        return { b, p: await plan(b, store.audiences) }
      })
      current = (await updateStudioSession(session.id, { brief: b, plan: p, status: 'plan', directions: [], direction: null, theme: null, error: null })) ?? current
    } catch (err) {
      if (again) await refundTweaks(session.id, COST.directions)
      console.error('[studio] brief/plan failed:', (err as Error).message)
      return aiDownFrom(err) ?? fail('The AI could not read your answers right now. Try again in a moment.', 502)
    }
  }
  return NextResponse.json(studioView(current))
}
