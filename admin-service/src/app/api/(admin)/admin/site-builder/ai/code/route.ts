import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { PAGE_KEYS, SITE_AUDIENCES, type PageKey, type SiteAudience } from '@jeffi/site-blocks'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { aiDenial } from '@/lib/auth/ai-scope'
import { AiWalletError } from '@/lib/ai/billing'
import { MAX_SOURCE_BYTES } from '@/lib/site/code/allow'
import { AI_UNAVAILABLE_CODE, AI_UNAVAILABLE_MESSAGE, siteAiAvailable } from '@/lib/site/ai-status'
import { tweakSection } from '@/lib/site/studio/generate'
import { studioCtxFor } from '@/lib/site/studio/context'
import { draftStudioContext } from '@/lib/site/studio/redesign'

export const dynamic = 'force-dynamic'
export const maxDuration = 180

const Body = z.object({
  ref: z.object({ audience: z.enum(SITE_AUDIENCES as [string, ...string[]]), page: z.enum(PAGE_KEYS) }),
  block: z.object({ id: z.string().max(80), label: z.string().max(200).optional(), source: z.string().min(1).max(MAX_SOURCE_BYTES) }),
  instruction: z.string().trim().min(3).max(1000),
  hint: z.string().max(300).nullish(),
  draftId: z.string().uuid().nullish(),
})

// POST: one code section changed as the owner asks, the way the AI Site Studio changes it (its brief, plan and design
// direction: a redesign draft's own, else those kept with the site at install; the store's own name and theme
// otherwise). Billed to the store's AI wallet like any Site Builder AI. Returns the new source; the editor applies it
// as an undoable edit (nothing is saved here).
export async function POST(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const denied = aiDenial(admin.role, admin.scopes, 'settings:write')
  if (denied) return NextResponse.json({ error: denied }, { status: 403 })
  const parsed = Body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Say what to change in a few words' }, { status: 400 })
  if (!(await siteAiAvailable())) return NextResponse.json({ error: AI_UNAVAILABLE_MESSAGE, code: AI_UNAVAILABLE_CODE }, { status: 503 })
  const { ref, block, instruction, hint, draftId } = parsed.data
  const label = block.label?.trim() || 'Section'
  try {
    const own = draftId ? await draftStudioContext(draftId) : null
    const { ctx, key } = await studioCtxFor({ audience: ref.audience as SiteAudience, page: ref.page as PageKey }, own)
    const ask = hint ? `${instruction} (They pointed at: "${hint}")` : instruction
    const next = await tweakSection(ctx, { id: block.id, type: 'code_section', v: 1, props: { label, source: block.source } }, ask, key)
    return NextResponse.json({ source: String(next.props.source ?? ''), summary: `Changed ${label}` })
  } catch (err) {
    if (err instanceof AiWalletError) return NextResponse.json({ error: err.message, balanceInr: err.balanceInr, neededInr: err.neededInr }, { status: err.status })
    if ((err as Error)?.name === 'StudioAiDownError') return NextResponse.json({ error: AI_UNAVAILABLE_MESSAGE, code: AI_UNAVAILABLE_CODE }, { status: 503 })
    const message = (err as Error)?.message ?? ''
    if (message.startsWith('The AI could not make that change')) return NextResponse.json({ error: `${message.slice(0, 300)}. Try saying it another way.` }, { status: 422 })
    console.error('[site-builder ai/code]', err)
    return NextResponse.json({ error: 'The AI is not reachable right now; try again shortly' }, { status: 502 })
  }
}
