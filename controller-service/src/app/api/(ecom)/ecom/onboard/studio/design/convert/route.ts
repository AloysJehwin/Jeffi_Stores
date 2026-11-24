import { NextRequest, NextResponse } from 'next/server'
import type { Block } from '@jeffi/site-blocks'
import { convertBlock } from '@/lib/site/convert'
import { siteEditorEnabled } from '@/lib/site/store'
import { SHOWCASE_PAGE_KEY } from '@/lib/showcase/types'
import { fail, readJson, studioOf } from '@controller/lib/site-studio/http'

export const dynamic = 'force-dynamic'

// "Convert to editable section" on a Showcase's page (docs/plans/SITE_EDITOR_PLAN.md phase 5). Body: { blockId }.
// The block, as last saved, rewritten as a code section with the same words, links and pictures (lib/site/convert.ts);
// returns it unsaved, for the editor to put in place as an undoable change. Free, like arranging by hand.

export async function POST(request: NextRequest) {
  if (!(await siteEditorEnabled())) return fail('The visual editor is not switched on', 404)
  const ctx = await studioOf(request)
  if (ctx instanceof NextResponse) return ctx
  const body = await readJson(request)
  const id = typeof body?.blockId === 'string' ? body.blockId : ''
  const block = ctx.session.pages?.[SHOWCASE_PAGE_KEY]?.blocks?.[id] as Block | undefined
  if (!block) return fail('That section is not on your saved page yet', 404)
  const r = await convertBlock(block, 'showcase')
  if (!r) return fail('This kind of section can’t be converted yet; redesign it with AI instead.', 422)
  if (!r.ok) return fail(r.issues[0]?.message ?? 'This section could not be converted', 422)
  return NextResponse.json({ block: r.block })
}
