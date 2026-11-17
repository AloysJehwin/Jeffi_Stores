import { NextRequest, NextResponse } from 'next/server'
import type { StudioPlan } from '@/lib/site/studio'
import { fail, readJson, studioOf, studioView } from '@controller/lib/site-studio/http'
import { updateStudioSession } from '@controller/lib/site-studio/sessions'
import { designLocked } from '@controller/lib/site-studio/rules'

export const dynamic = 'force-dynamic'

// The page plan: the owner turns optional pages (about, contact, search, the announcement bar) on or off.
// Body: { enabled: { "store:about": false, ... } }; pages that are not optional stay on.
export async function POST(request: NextRequest) {
  const ctx = await studioOf(request)
  if (ctx instanceof NextResponse) return ctx
  const { session } = ctx
  const plan = session.plan as StudioPlan | null
  if (!plan) return fail('Answer the questions first.', 409)
  const lock = designLocked(session)
  if (lock) return fail(lock, 409)
  const body = await readJson(request)
  const enabled = body?.enabled && typeof body.enabled === 'object' ? (body.enabled as Record<string, unknown>) : null
  if (!enabled) return fail('Nothing to change')
  const next: StudioPlan = {
    ...plan,
    pages: plan.pages.map(p => (p.optional && typeof enabled[p.key] === 'boolean' ? { ...p, enabled: enabled[p.key] as boolean } : p)),
  }
  const saved = await updateStudioSession(session.id, { plan: next })
  return NextResponse.json(studioView(saved))
}
