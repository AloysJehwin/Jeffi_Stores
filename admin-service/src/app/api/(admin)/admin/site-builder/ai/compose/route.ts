import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { PAGE_KEYS } from '@jeffi/site-blocks'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { aiDenial } from '@/lib/auth/ai-scope'
import { aiComposeBlock } from '@/lib/site/compose'
import { SiteAiError } from '@/lib/site/ai'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const Body = z.object({
  page: z.enum(PAGE_KEYS),
  prompt: z.string().trim().min(3).max(2000),
  current: z.object({ label: z.string().max(80).optional(), tree: z.unknown() }).nullish(),
  hint: z.string().max(300).nullish(),
})

// POST: a custom block the AI composes from safe primitives and the store's own data (read-only tools), or the given
// block changed. Returns the block's settings; the editor adds it as an undoable edit (nothing is saved here).
export async function POST(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const denied = aiDenial(admin.role, admin.scopes, 'settings:write')
  if (denied) return NextResponse.json({ error: denied }, { status: 403 })
  const parsed = Body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Describe the block in a few words' }, { status: 400 })
  try {
    const r = await aiComposeBlock(parsed.data)
    return NextResponse.json(r)
  } catch (err) {
    if (err instanceof SiteAiError) return NextResponse.json({ error: err.message }, { status: 422 })
    console.error('[site-builder compose]', err)
    return NextResponse.json({ error: 'The AI is not reachable right now; try again shortly' }, { status: 502 })
  }
}
