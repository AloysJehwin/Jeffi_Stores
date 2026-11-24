import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { PAGE_KEYS, SITE_AUDIENCES, type CodeNode, type PageKey, type SiteAudience } from '@jeffi/site-blocks'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { aiDenial } from '@/lib/auth/ai-scope'
import { AiWalletError } from '@/lib/ai/billing'
import { AI_UNAVAILABLE_CODE, AI_UNAVAILABLE_MESSAGE, siteAiAvailable } from '@/lib/site/ai-status'
import { siteEditorEnabled } from '@/lib/site/store'
import { changeSelection } from '@/lib/site/studio/selection'
import { studioCtxFor } from '@/lib/site/studio/context'
import { draftStudioContext } from '@/lib/site/studio/redesign'

export const dynamic = 'force-dynamic'
export const maxDuration = 180

const Body = z.object({
  ref: z.object({ audience: z.enum(SITE_AUDIENCES as [string, ...string[]]), page: z.enum(PAGE_KEYS) }),
  block: z.object({ label: z.string().max(200).optional(), tree: z.record(z.string(), z.unknown()) }),
  ids: z.array(z.string().max(60)).max(20).default([]),
  instruction: z.string().trim().min(3).max(1000),
  draftId: z.string().uuid().nullish(),
})

// POST: the visual editor's "Change with AI" on a selection (docs/plans/SITE_EDITOR_PLAN.md phase 4), while the
// editor is on. The section's tree is printed and the selected ids named (lib/site/studio/selection.ts); billed to the
// store's AI wallet like any Site Builder AI. Returns the new tree and the ids it changed; the editor applies it as one
// undoable change and saves it, compiled again (nothing is saved here).
export async function POST(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const denied = aiDenial(admin.role, admin.scopes, 'settings:write')
  if (denied) return NextResponse.json({ error: denied }, { status: 403 })
  if (!(await siteEditorEnabled())) return NextResponse.json({ error: 'The visual editor is not switched on for this store' }, { status: 404 })
  const parsed = Body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Say what to change in a few words' }, { status: 400 })
  if (!(await siteAiAvailable())) return NextResponse.json({ error: AI_UNAVAILABLE_MESSAGE, code: AI_UNAVAILABLE_CODE }, { status: 503 })
  const { ref, block, ids, instruction, draftId } = parsed.data
  const label = block.label?.trim() || 'Section'
  try {
    const own = draftId ? await draftStudioContext(draftId) : null
    const { ctx, key } = await studioCtxFor({ audience: ref.audience as SiteAudience, page: ref.page as PageKey }, own)
    const r = await changeSelection(ctx, { label, tree: block.tree as unknown as CodeNode, page: ref.page as PageKey, key, ids, instruction })
    return NextResponse.json({ tree: r.tree, changed: r.changed })
  } catch (err) {
    if (err instanceof AiWalletError) return NextResponse.json({ error: err.message, balanceInr: err.balanceInr, neededInr: err.neededInr }, { status: err.status })
    if ((err as Error)?.name === 'StudioAiDownError') return NextResponse.json({ error: AI_UNAVAILABLE_MESSAGE, code: AI_UNAVAILABLE_CODE }, { status: 503 })
    const message = (err as Error)?.message ?? ''
    if (message.startsWith('The AI could not make that change') || (err as Error)?.name === 'PrintError')
      return NextResponse.json({ error: `${message.slice(0, 300)}. Try saying it another way.` }, { status: 422 })
    console.error('[site-builder ai/selection]', err)
    return NextResponse.json({ error: 'The AI is not reachable right now; try again shortly' }, { status: 502 })
  }
}
