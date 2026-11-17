import { NextRequest, NextResponse } from 'next/server'
import type { DesignDirection } from '@/lib/site/studio'
import { fail, readJson, studioOf, studioView } from '@controller/lib/site-studio/http'
import { updateStudioSession } from '@controller/lib/site-studio/sessions'
import { designLocked } from '@controller/lib/site-studio/rules'

export const dynamic = 'force-dynamic'

// Picks the design direction the site is built in: its theme becomes the store's theme. Body: { index }.
export async function POST(request: NextRequest) {
  const ctx = await studioOf(request)
  if (ctx instanceof NextResponse) return ctx
  const { session } = ctx
  const lock = designLocked(session)
  if (lock) return fail(lock, 409)
  const body = await readJson(request)
  const picked = ((session.directions ?? []) as DesignDirection[])[Number(body?.index)]
  if (!picked) return fail('No such direction')
  const saved = await updateStudioSession(session.id, { direction: picked, theme: picked.theme, status: 'direction' })
  return NextResponse.json(studioView(saved))
}
