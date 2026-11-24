import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { aiDenial } from '@/lib/auth/ai-scope'
import { AiWalletError } from '@/lib/ai/billing'
import { seedOf } from '@/lib/ai/stock'
import { AI_UNAVAILABLE_CODE, AI_UNAVAILABLE_MESSAGE, siteAiAvailable } from '@/lib/site/ai-status'
import { siteEditorEnabled } from '@/lib/site/store'
import { LANGUAGES, TEXT_ACTIONS, reworkText, slotPicture } from '@/lib/site/studio/element-ai'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const Body = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), action: z.enum(TEXT_ACTIONS), text: z.string().trim().min(1).max(1500), language: z.enum(LANGUAGES).optional(), context: z.string().max(200).optional() }),
  z.object({ kind: z.literal('picture'), subject: z.string().trim().min(2).max(200), aspect: z.string().max(8).nullish(), draftId: z.string().uuid().nullish() }),
])

// POST: the visual editor's cheap element actions (lib/site/studio/element-ai.ts), while the editor is on: words
// rewritten, shortened or translated ({ text }), or a picture for an image slot ({ url, alt, credit }): a stock photo
// first (kept in the gallery with its credit, so the store's credits line names it), else a generated one. Billed to
// the store's AI wallet like any Site Builder AI; nothing is saved here.
export async function POST(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const denied = aiDenial(admin.role, admin.scopes, 'settings:write')
  if (denied) return NextResponse.json({ error: denied }, { status: 403 })
  if (!(await siteEditorEnabled())) return NextResponse.json({ error: 'The visual editor is not switched on for this store' }, { status: 404 })
  const parsed = Body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Nothing to work on' }, { status: 400 })
  const b = parsed.data
  if (b.kind === 'text' && !(await siteAiAvailable())) return NextResponse.json({ error: AI_UNAVAILABLE_MESSAGE, code: AI_UNAVAILABLE_CODE }, { status: 503 })
  try {
    if (b.kind === 'text') return NextResponse.json({ text: await reworkText(b) })
    const pic = await slotPicture({ subject: b.subject, aspect: b.aspect, seed: seedOf(b.draftId ?? 'site-editor'), ref: `site-editor:${b.draftId ?? 'page'}` })
    if (!pic) return NextResponse.json({ error: 'No picture came up for that. Try describing the picture first.' }, { status: 422 })
    return NextResponse.json({ url: pic.url, alt: pic.alt ?? null, credit: pic.credit })
  } catch (err) {
    if (err instanceof AiWalletError) return NextResponse.json({ error: err.message, balanceInr: err.balanceInr, neededInr: err.neededInr }, { status: err.status })
    if ((err as Error)?.name === 'StudioAiDownError') return NextResponse.json({ error: AI_UNAVAILABLE_MESSAGE, code: AI_UNAVAILABLE_CODE }, { status: 503 })
    console.error('[site-builder ai/element]', err)
    return NextResponse.json({ error: 'The AI could not do that right now; try again shortly' }, { status: 502 })
  }
}
