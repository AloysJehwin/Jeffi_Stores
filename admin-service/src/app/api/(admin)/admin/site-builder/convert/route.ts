import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { PAGE_KEYS, type Block, type PageKey } from '@jeffi/site-blocks'
import { requireAdminScope } from '@/lib/auth/jwt'
import { convertBlock } from '@/lib/site/convert'
import { siteEditorEnabled } from '@/lib/site/store'

export const dynamic = 'force-dynamic'

const Body = z.object({
  page: z.enum(PAGE_KEYS),
  block: z.object({ id: z.string().max(80), type: z.string().max(60), v: z.number().int().optional(), props: z.record(z.string(), z.unknown()), visibility: z.record(z.string(), z.unknown()).optional() }),
})

// POST: "Convert to editable section" (docs/plans/SITE_EDITOR_PLAN.md phase 5), on demand, one block at a time, while
// the visual editor is on: a content or composed block rewritten as a code section with the same words, links and
// pictures (lib/site/convert.ts). Returns the new block; the editor puts it in place as an undoable change and saves
// it through the usual compile (nothing is saved here).
export async function POST(request: NextRequest) {
  const admin = await requireAdminScope(request, 'settings:write')
  if (admin instanceof NextResponse) return admin
  if (!(await siteEditorEnabled())) return NextResponse.json({ error: 'The visual editor is not switched on for this store' }, { status: 404 })
  const parsed = Body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Send { page, block }' }, { status: 400 })
  const { page, block } = parsed.data
  const r = await convertBlock({ ...block, v: block.v ?? 1 } as Block, page as PageKey)
  if (!r) return NextResponse.json({ error: 'This kind of block can’t be converted yet; redesign it with AI instead.' }, { status: 422 })
  if (!r.ok) return NextResponse.json({ error: r.issues[0]?.message ?? 'This block could not be converted' }, { status: 422 })
  return NextResponse.json({ block: r.block })
}
