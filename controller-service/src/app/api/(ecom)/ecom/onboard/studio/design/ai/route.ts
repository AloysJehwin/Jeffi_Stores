import { NextRequest, NextResponse } from 'next/server'
import type { CodeNode, PageDoc } from '@jeffi/site-blocks'
import { CodeSectionInvalid, recompileCodeSections, upgradeCodeProps } from '@/lib/site/code/compile'
import { siteEditorEnabled } from '@/lib/site/store'
import { changeSelection } from '@/lib/site/studio/selection'
import { SHOWCASE_PAGE_KEY } from '@/lib/showcase/types'
import { PaidGenerationError } from '@/lib/ai/paid-generation'
import { aiDownFrom, aiUnavailable, fail, readJson, studioOf, studioView } from '@controller/lib/site-studio/http'
import { buildRunning, saveStudioPage } from '@controller/lib/site-studio/sessions'
import { BUDGET_INR, COST } from '@controller/lib/site-studio/allowance'
import { reload, studioCtx } from '@controller/lib/site-studio/build'
import { claimCorrection, runCorrection } from '@controller/lib/site-studio/corrections'
import { WALLET_URL } from '@controller/lib/showcase-builder/build'

export const dynamic = 'force-dynamic'
export const maxDuration = 180

// The visual editor's "Change with AI" on a Showcase's selection (docs/plans/SITE_EDITOR_PLAN.md phase 4), while the
// editor is on. Body: { blockId, ids, instruction, priceInr? }. The section is the saved one (the editor saves first),
// and the change counts as one AI correction: free within the day's allowance, else charged at the price the owner
// saw (lib/site-studio/corrections.ts). Saved inside the run, compiled again with the page's required parts, so a
// change that can't be saved isn't charged. Returns the new tree, the ids it changed, the charge and the allowance.

export async function POST(request: NextRequest) {
  if (!(await siteEditorEnabled())) return fail('The visual editor is not switched on', 404)
  const ctx = await studioOf(request)
  if (ctx instanceof NextResponse) return ctx
  const { session } = ctx
  if (session.product !== 'showcase') return fail('The visual editor works on a Showcase page', 400)
  const body = await readJson(request)
  const blockId = typeof body?.blockId === 'string' ? body.blockId : ''
  const ids = Array.isArray(body?.ids) ? body.ids.filter((x): x is string => typeof x === 'string' && x.length <= 60).slice(0, 20) : []
  const instruction = typeof body?.instruction === 'string' ? body.instruction.trim().slice(0, 600) : ''
  const doc = session.pages?.[SHOWCASE_PAGE_KEY]
  const block = doc?.blocks?.[blockId]
  if (!doc || !block || block.type !== 'code_section') return fail('That section is not on the page any more.', 404)
  if (instruction.length < 3) return fail('Say what to change.')
  if (buildRunning(session)) return fail('Your site is being built. Wait for it to finish first.', 409, { code: 'running' })
  const tree = upgradeCodeProps(block.props ?? {}, 'showcase').tree as CodeNode | undefined
  if (!tree) return fail('That section can’t be changed in the visual editor.', 422)
  const down = await aiUnavailable()
  if (down) return down
  const claim = await claimCorrection(session, COST.tweak, body?.priceInr)
  if (!claim.ok) return fail(claim.error, claim.status, claim.extra)
  let out: { tree: CodeNode; changed: string[] }
  let chargedInr = 0
  try {
    const run = await runCorrection(claim.correction, BUDGET_INR.small, 'Site studio change', async () => {
      const r = await changeSelection(studioCtx(session), { label: String(block.props.label ?? 'Section'), tree, page: 'showcase', key: SHOWCASE_PAGE_KEY, ids, instruction })
      const next: PageDoc = { ...doc, blocks: { ...doc.blocks, [blockId]: { ...block, props: { ...block.props, tree: r.tree, source: '' } } } }
      await saveStudioPage(session.id, SHOWCASE_PAGE_KEY, await recompileCodeSections(next, { page: 'showcase', coreType: null }))
      return r
    })
    out = run.result
    chargedInr = run.chargedInr
  } catch (err) {
    if (err instanceof PaidGenerationError) return fail(err.message, err.status, { ...err.body(), topUpUrl: WALLET_URL })
    if (err instanceof CodeSectionInvalid) return fail(`That change doesn’t fit the page: ${err.issues[0]?.message ?? 'it no longer works'}. Try saying it another way.`, 422)
    console.error('[studio] design ai failed:', (err as Error).message)
    return aiDownFrom(err) ?? fail('The AI could not make that change. Try saying it another way.', 502)
  }
  return NextResponse.json({ tree: out.tree, changed: out.changed, chargedInr, allowance: studioView(await reload(session.id)).allowance })
}
