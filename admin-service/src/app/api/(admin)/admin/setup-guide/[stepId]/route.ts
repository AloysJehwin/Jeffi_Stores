import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { readJson, withPlan } from '@/lib/channels/route'
import { STEP_IDS } from '@/lib/setup-guide/registry'
import { setStoreProgress } from '@/lib/setup-guide/progress'
import { ManualBody, issue } from '@/lib/setup-guide/route'

export const dynamic = 'force-dynamic'

/** Mark a step applied (with the date), approved or skipped; state null clears it. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ stepId: string }> }) {
  const admin = await withPlan(await requireAdminScope(request, 'setup_guide:write'), 'setup_guide:write', 'Setup guide')
  if (admin instanceof NextResponse) return admin
  const { stepId } = await params
  if (!STEP_IDS.has(stepId)) return NextResponse.json({ error: 'Unknown step' }, { status: 404 })
  const parsed = ManualBody.safeParse(await readJson(request))
  if (!parsed.success) return NextResponse.json({ error: issue(parsed.error) }, { status: 400 })
  const b = parsed.data
  try {
    await setStoreProgress(stepId, { state: b.state, appliedAt: b.state === 'applied' ? (b.appliedAt ?? null) : null, note: b.note ?? null }, admin.email ?? null)
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[setup-guide] save failed', e)
    return NextResponse.json({ error: 'Could not save' }, { status: 500 })
  }
}
