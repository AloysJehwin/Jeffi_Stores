import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { PAGE_KEYS, SITE_AUDIENCES, type PageKey, type SiteAudience, type SiteSurface } from '@jeffi/site-blocks'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { aiDenial } from '@/lib/auth/ai-scope'
import { AI_UNAVAILABLE_CODE, AI_UNAVAILABLE_MESSAGE, siteAiAvailable } from '@/lib/site/ai-status'
import { PageRedoRefused, pageRedoStatus, startPageRedo } from '@/lib/site/studio/redesign'

export const dynamic = 'force-dynamic'

const Body = z.object({
  draftId: z.string().uuid(),
  ref: z.object({ audience: z.enum(SITE_AUDIENCES as [string, ...string[]]), page: z.enum(PAGE_KEYS) }),
  // The layouts that take the new page: the one open, and its twin while "Same on phone" links them.
  surfaces: z.array(z.enum(['web', 'web_mobile'])).min(1).max(2).default(['web', 'web_mobile']),
})

// POST: one page of a draft (or its product card) designed again the AI Site Studio way, planned afresh and written
// section by section in the background into the draft (lib/site/studio/redesign.ts startPageRedo). Billed to the
// store's AI wallet like any Site Builder AI, never the whole-site free generation, and stopped at a page's budget.
// 202 at once; GET ?draft= polls the job, and the editor then loads the page as an undoable change.
export async function POST(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const denied = aiDenial(admin.role, admin.scopes, 'settings:write')
  if (denied) return NextResponse.json({ error: denied }, { status: 403 })
  const parsed = Body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Open a page of a draft first' }, { status: 400 })
  if (!(await siteAiAvailable())) return NextResponse.json({ error: AI_UNAVAILABLE_MESSAGE, code: AI_UNAVAILABLE_CODE }, { status: 503 })
  const { draftId, ref, surfaces } = parsed.data
  try {
    const job = await startPageRedo(draftId, { audience: ref.audience as SiteAudience, page: ref.page as PageKey }, surfaces as SiteSurface[], admin.adminId)
    return NextResponse.json({ job }, { status: 202 })
  } catch (err) {
    if (err instanceof PageRedoRefused) return NextResponse.json({ error: err.message }, { status: err.status })
    throw err
  }
}

export async function GET(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const id = request.nextUrl.searchParams.get('draft') ?? ''
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Unknown draft' }, { status: 400 })
  return NextResponse.json({ job: await pageRedoStatus(id) })
}
