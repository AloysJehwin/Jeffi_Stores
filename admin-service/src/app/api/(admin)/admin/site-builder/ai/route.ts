import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { PAGE_KEYS, SITE_AUDIENCES, SITE_SURFACES, normalizeDoc, type PageDoc } from '@jeffi/site-blocks'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { aiDenial } from '@/lib/auth/ai-scope'
import { getHomepagePlan } from '@/lib/catalog/homepage-plan'
import { aiBuildPage, aiCorrectBlock, SiteAiError } from '@/lib/site/ai'

export const dynamic = 'force-dynamic'

const Body = z.object({
  ref: z.object({
    audience: z.enum(SITE_AUDIENCES as [string, ...string[]]),
    surface: z.enum(SITE_SURFACES as [string, ...string[]]),
    page: z.enum(PAGE_KEYS),
  }),
  doc: z.object({ blocks: z.record(z.string(), z.unknown()), order: z.array(z.string()) }).passthrough(),
  prompt: z.string().trim().min(3).max(2000),
  blockId: z.string().max(80).nullish(),
  hint: z.string().max(300).nullish(),
})

// POST: an AI proposal for the page being edited: with blockId, that block corrected; without, the page built from the
// request. Returns the proposed document; the editor applies it as an undoable edit (nothing is saved here).
export async function POST(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const denied = aiDenial(admin.role, admin.scopes, 'settings:write')
  if (denied) return NextResponse.json({ error: denied }, { status: 403 })
  const parsed = Body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Describe the change in a few words' }, { status: 400 })
  const { ref, prompt, blockId, hint } = parsed.data
  const doc = normalizeDoc(parsed.data.doc as unknown as PageDoc)
  const r = ref as never
  try {
    const out = blockId ? await aiCorrectBlock(doc, r, blockId, prompt, hint) : await aiBuildPage(doc, r, prompt, (await getHomepagePlan()).types)
    return NextResponse.json(out)
  } catch (err) {
    if (err instanceof SiteAiError) return NextResponse.json({ error: err.message }, { status: 422 })
    console.error('[site-builder ai]', err)
    return NextResponse.json({ error: 'The AI is not reachable right now; try again shortly' }, { status: 502 })
  }
}
