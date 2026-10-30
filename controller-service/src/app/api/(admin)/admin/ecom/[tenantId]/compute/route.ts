import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope, isPlatformAdmin } from '@/lib/auth/scopes'
import { checkComputeChange } from '@/lib/compute/change'
import { ComputeSpecSchema } from '@/lib/compute/schema'
import { getTenantCompute, patchTenantCompute, saveDesiredCompute } from '@/lib/compute/store'

export const dynamic = 'force-dynamic'

const Body = z.union([
  z.object({ spec: ComputeSpecSchema, applyMode: z.enum(['window', 'now']).default('window') }),
  z.object({ action: z.literal('retry') }),
])

/** The store's compute row: what it chose, what runs, and how a change is going. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isPlatformAdmin(admin.role)) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  return NextResponse.json({ compute: await getTenantCompute((await params).tenantId) })
}

/** Override a store's servers (outside its plan's sizes, no wallet check), or retry a failed change. */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isPlatformAdmin(admin.role) || !hasScope(admin.role, admin.scopes, 'ecom_customers:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }
  const { tenantId } = await params
  const parsed = Body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' }, { status: 400 })

  if ('action' in parsed.data) {
    const row = await getTenantCompute(tenantId)
    if (row?.status !== 'failed') return NextResponse.json({ error: 'No failed change to retry' }, { status: 409 })
    await patchTenantCompute(tenantId, { status: 'applying', attempts: 0, next_at: null, last_error: null })
    return NextResponse.json({ ok: true })
  }
  const check = await checkComputeChange(tenantId, parsed.data.spec, { admin: true })
  if (check.status !== 200) return NextResponse.json({ error: check.error, quote: check.quote }, { status: check.status })
  await saveDesiredCompute(tenantId, parsed.data.spec, parsed.data.applyMode)
  return NextResponse.json({ ok: true, quote: check.quote })
}
