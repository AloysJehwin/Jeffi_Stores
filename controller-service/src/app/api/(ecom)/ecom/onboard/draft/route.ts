import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { z } from 'zod'
import { OWNER_COOKIE, resolveOwnerSession } from '@/lib/auth/owner-session'
import { extractSessionSignals } from '@/lib/auth/session-signals-request'
import { saveDraft, getDraft } from '@/lib/tenant-registry'
import { WIZARD_STEPS } from '@controller/app/(ecom)/ecom/onboard/steps'
import { getStudioSession } from '@controller/lib/site-studio/sessions'
import { studioStoreContextFrom, syncStudioStore } from '@controller/lib/site-studio/context'
import { isGstin, isPan } from '@controller/lib/catalog/tax-ids'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const sid = (await cookies()).get(OWNER_COOKIE)?.value
  const owner = await resolveOwnerSession(sid, extractSessionSignals(request))
  if (!owner) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  const draft = await getDraft(owner.id)
  return NextResponse.json({ draft: draft ?? null })
}

const Schema = z.object({
  step: z.number().int().min(0).max(WIZARD_STEPS.length - 1),
  data: z.record(z.string(), z.unknown()),
})

export async function POST(request: NextRequest) {
  const sid = (await cookies()).get(OWNER_COOKIE)?.value
  const owner = await resolveOwnerSession(sid, extractSessionSignals(request))
  if (!owner) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const raw = await request.json().catch(() => null)
  if (!raw) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  const parsed = Schema.safeParse(raw)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 })

  const data = parsed.data.data as Record<string, any>
  // A draft keeps a PAN or GSTIN only in its proper shape (the Business and GST steps ask again). Rejecting the
  // save instead would lose everything else typed since the last one.
  for (const [k, ok] of [['pan', isPan], ['gstNumber', isGstin]] as const) {
    if (!(k in data)) continue
    const v = typeof data[k] === 'string' ? data[k].trim().toUpperCase() : ''
    data[k] = ok(v) ? v : ''
  }
  await saveDraft(owner.id, parsed.data.step, data)
  // The studio's preview shows the Store step's details: bring an existing session up to date (no AI runs).
  await getStudioSession(owner.id)
    .then(s => (s ? syncStudioStore(s, studioStoreContextFrom(data)) : null))
    .catch(err => console.warn('[onboard] studio not synced', (err as Error)?.message))
  return NextResponse.json({ ok: true })
}
