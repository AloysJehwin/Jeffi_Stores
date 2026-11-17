import { NextRequest, NextResponse } from 'next/server'
import { tweakSection } from '@/lib/site/studio'
import { aiDownFrom, aiUnavailable, fail, readJson, studioOf, studioView } from '@controller/lib/site-studio/http'
import { buildRunning, refundTweaks, saveStudioPage, spendTweaks } from '@controller/lib/site-studio/sessions'
import { BUDGET_INR, COST, TWEAKS_PER_DAY } from '@controller/lib/site-studio/allowance'
import { reload, studioCtx } from '@controller/lib/site-studio/build'
import { funded } from '@controller/lib/site-studio/funded'

export const dynamic = 'force-dynamic'
export const maxDuration = 180

// The owner picked a section in the preview and said what to change. Body: { page: "store:home", blockId, instruction }.
// Free, within the day's cap.
export async function POST(request: NextRequest) {
  const ctx = await studioOf(request)
  if (ctx instanceof NextResponse) return ctx
  const { session } = ctx
  const body = await readJson(request)
  const key = typeof body?.page === 'string' ? body.page : ''
  const blockId = typeof body?.blockId === 'string' ? body.blockId : ''
  const instruction = typeof body?.instruction === 'string' ? body.instruction.trim().slice(0, 600) : ''
  const doc = session.pages?.[key]
  const block = doc?.blocks?.[blockId]
  if (!doc || !block) return fail('That section is not on the page any more. Reload the preview.', 404)
  if (instruction.length < 3) return fail('Say what to change.')
  if (buildRunning(session)) return fail('Your site is being built. Wait for it to finish first.', 409, { code: 'running' })
  const down = await aiUnavailable()
  if (down) return down
  if (!(await spendTweaks(session.id, COST.tweak, TWEAKS_PER_DAY))) return fail('You have used today’s free changes. Come back tomorrow for more.', 429)
  try {
    const next = await funded(session.id, BUDGET_INR.small, () => tweakSection(studioCtx(session), block, instruction, key))
    // The section keeps its place and whether it is hidden.
    await saveStudioPage(session.id, key, { ...doc, blocks: { ...doc.blocks, [blockId]: { ...next, id: blockId, ...(block.visibility ? { visibility: block.visibility } : {}) } } })
  } catch (err) {
    await refundTweaks(session.id, COST.tweak)
    console.error('[studio] tweak failed:', (err as Error).message)
    return aiDownFrom(err) ?? fail('The AI could not make that change. Try saying it another way.', 502)
  }
  return NextResponse.json({ ...studioView(await reload(session.id)), page: key, blockId })
}
