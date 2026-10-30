import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { z } from 'zod'
import { OWNER_COOKIE, resolveOwnerSession } from '@/lib/auth/owner-session'
import { extractSessionSignals } from '@/lib/auth/session-signals-request'
import { getOwnerTenants } from '@/lib/tenant-registry'
import { checkComputeChange } from '@/lib/compute/change'
import { ComputeSpecSchema } from '@/lib/compute/schema'
import { saveDesiredCompute } from '@/lib/compute/store'

export const dynamic = 'force-dynamic'

const Body = z.object({ tenantId: z.string().uuid(), spec: ComputeSpecSchema, applyMode: z.enum(['window', 'now']).default('window') })

/** An owner changes the servers of a live store; the provisioning worker applies it (compute-reconcile.ts). */
export async function PUT(request: NextRequest) {
  const owner = await resolveOwnerSession((await cookies()).get(OWNER_COOKIE)?.value, extractSessionSignals(request))
  if (!owner) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  const parsed = Body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' }, { status: 400 })
  const { tenantId, spec, applyMode } = parsed.data
  if (!(await getOwnerTenants(owner.id)).some(t => t.id === tenantId)) return NextResponse.json({ error: 'Store not found' }, { status: 404 })

  const check = await checkComputeChange(tenantId, spec)
  if (check.status !== 200) return NextResponse.json({ error: check.error, quote: check.quote }, { status: check.status })
  await saveDesiredCompute(tenantId, spec, applyMode)
  return NextResponse.json({ ok: true, quote: check.quote })
}
