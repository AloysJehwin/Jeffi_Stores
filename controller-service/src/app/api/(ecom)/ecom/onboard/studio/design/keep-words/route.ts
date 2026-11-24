import { NextRequest, NextResponse } from 'next/server'
import { siteEditorEnabled } from '@/lib/site/store'
import { pageWords } from '@/lib/site/studio/keep-words'
import type { StudioBrief } from '@/lib/site/studio/types'
import { fail, readJson, studioOf } from '@controller/lib/site-studio/http'
import { updateStudioSession } from '@controller/lib/site-studio/sessions'

export const dynamic = 'force-dynamic'

// Before a page changed by hand in the visual editor is designed again, the owner's choice (docs/plans/SITE_EDITOR_PLAN.md
// phase 4). Body: { page, keep }. Keep: the words on the page now go into the brief (StudioBrief.keepWords), which the
// section writer reuses where they fit; start fresh: they come out. Returns how many words were kept.

export async function POST(request: NextRequest) {
  if (!(await siteEditorEnabled())) return fail('The visual editor is not switched on', 404)
  const ctx = await studioOf(request)
  if (ctx instanceof NextResponse) return ctx
  const { session } = ctx
  const body = await readJson(request)
  const key = typeof body?.page === 'string' ? body.page : ''
  const brief = session.brief as StudioBrief | null
  if (!brief || !session.pages?.[key]) return fail('That page is not designed yet.', 404)
  const words = body?.keep === true ? pageWords(session.pages[key]) : []
  const { keepWords: _old, ...rest } = brief
  await updateStudioSession(session.id, { brief: words.length ? { ...rest, keepWords: words } : rest })
  return NextResponse.json({ words: words.length })
}
