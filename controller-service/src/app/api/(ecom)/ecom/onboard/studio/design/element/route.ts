import { NextRequest, NextResponse } from 'next/server'
import { seedOf } from '@/lib/ai/stock'
import { siteEditorEnabled } from '@/lib/site/store'
import { studioBudgetLeft } from '@/lib/site/studio'
import { LANGUAGES, TEXT_ACTIONS, reworkText, slotPicture, type Language, type TextAction } from '@/lib/site/studio/element-ai'
import { aiDownFrom, aiUnavailable, fail, readJson, studioOf } from '@controller/lib/site-studio/http'
import { refundTweaks, spendTweaks } from '@controller/lib/site-studio/sessions'
import { BUDGET_INR, COST, HELP_PER_DAY } from '@controller/lib/site-studio/allowance'
import { funded } from '@controller/lib/site-studio/funded'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

// The visual editor's cheap element actions on a Showcase (lib/site/studio/element-ai.ts), while the editor is on.
// Body: { kind: 'text', action, text, language?, context? } → { text }, or { kind: 'picture', subject, aspect? } →
// { url, alt, credit }: a stock photo first, else one made at draft quality. Each counts as the day's free AI help
// (HELP_PER_DAY), platform-funded within a small budget; a picture's credit travels with the page (settings.credits).

export async function POST(request: NextRequest) {
  if (!(await siteEditorEnabled())) return fail('The visual editor is not switched on', 404)
  const ctx = await studioOf(request)
  if (ctx instanceof NextResponse) return ctx
  const { session } = ctx
  if (session.product !== 'showcase') return fail('The visual editor works on a Showcase page', 400)
  const body = await readJson(request)
  const kind = body?.kind
  const text = typeof body?.text === 'string' ? body.text.trim().slice(0, 1500) : ''
  const action = TEXT_ACTIONS.find(a => a === body?.action) as TextAction | undefined
  const language = LANGUAGES.find(l => l === body?.language) as Language | undefined
  const subject = typeof body?.subject === 'string' ? body.subject.trim().slice(0, 200) : ''
  if (kind === 'text' ? !text || !action : kind !== 'picture' || subject.length < 2) return fail('Nothing to work on')
  if (kind === 'text') {
    const down = await aiUnavailable()
    if (down) return down
  }
  if (!(await spendTweaks(session.id, COST.help, HELP_PER_DAY))) return fail('You have used today’s free AI help. Write it in your own words, or come back tomorrow.', 429)
  try {
    if (kind === 'text')
      return NextResponse.json({ text: await funded(session.id, BUDGET_INR.small, () => reworkText({ text, action: action!, language, context: typeof body?.context === 'string' ? body.context : undefined })) })
    const category = (session.brief as { category?: string } | null)?.category
    const pic = await funded(session.id, BUDGET_INR.small, () =>
      slotPicture({ subject, category, aspect: typeof body?.aspect === 'string' ? body.aspect : null, seed: seedOf(session.id), skipGallery: true, ref: `site-studio:${session.id}:editor`, aiAllowed: () => studioBudgetLeft() > 0 })
    )
    if (!pic) {
      await refundTweaks(session.id, COST.help)
      return fail('No picture came up for that. Try describing the picture first.', 422)
    }
    return NextResponse.json({ url: pic.url, alt: pic.alt ?? null, credit: pic.credit })
  } catch (err) {
    await refundTweaks(session.id, COST.help)
    console.error('[studio] design element failed:', (err as Error).message)
    return aiDownFrom(err) ?? fail('The AI could not do that right now. Try again shortly.', 502)
  }
}
