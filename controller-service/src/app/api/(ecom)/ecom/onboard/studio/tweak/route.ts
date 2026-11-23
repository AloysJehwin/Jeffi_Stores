import { NextRequest, NextResponse } from 'next/server'
import { tweakSection } from '@/lib/site/studio'
import { aiDownFrom, aiUnavailable, fail, readJson, studioOf, studioView } from '@controller/lib/site-studio/http'
import { buildRunning, saveStudioPage } from '@controller/lib/site-studio/sessions'
import { BUDGET_INR, COST } from '@controller/lib/site-studio/allowance'
import { reload, studioCtx } from '@controller/lib/site-studio/build'
import { claimCorrection, runCorrection } from '@controller/lib/site-studio/corrections'
import { WALLET_URL } from '@controller/lib/showcase-builder/build'
import { PaidGenerationError } from '@/lib/ai/paid-generation'

export const dynamic = 'force-dynamic'
export const maxDuration = 180

// The owner picked a section in the preview and said what to change. Body: { page: "store:home", blockId, instruction,
// priceInr? }. One correction: free within the day's allowance, else charged (priceInr: the price the owner saw).
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
  const claim = await claimCorrection(session, COST.tweak, body?.priceInr)
  if (!claim.ok) return fail(claim.error, claim.status, claim.extra)
  let chargedInr = 0
  try {
    // Saved inside the run, so a change that can't be saved isn't charged.
    const run = await runCorrection(claim.correction, BUDGET_INR.small, 'Site studio change', async () => {
      const next = await tweakSection(studioCtx(session), block, instruction, key)
      // The section keeps its place and whether it is hidden.
      await saveStudioPage(session.id, key, { ...doc, blocks: { ...doc.blocks, [blockId]: { ...next, id: blockId, ...(block.visibility ? { visibility: block.visibility } : {}) } } })
    })
    chargedInr = run.chargedInr
  } catch (err) {
    if (err instanceof PaidGenerationError) return fail(err.message, err.status, { ...err.body(), topUpUrl: WALLET_URL })
    console.error('[studio] tweak failed:', (err as Error).message)
    return aiDownFrom(err) ?? fail('The AI could not make that change. Try saying it another way.', 502)
  }
  return NextResponse.json({ ...studioView(await reload(session.id)), page: key, blockId, chargedInr })
}
