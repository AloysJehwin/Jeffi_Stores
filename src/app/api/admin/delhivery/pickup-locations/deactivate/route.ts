import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { resolveTenantId } from '@/lib/tenant-context'
import { deactivateDelhiveryPickupLocation } from '@/lib/delhivery'
import { getBusinessValues } from '@/lib/site-controls'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'delhivery:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const body = await request.json().catch(() => ({}))
  const name = String(body?.name || '').trim()
  if (!name) return NextResponse.json({ error: 'Warehouse name is required.' }, { status: 400 })

  // Guard: the current default warehouse cannot be removed. Promote another warehouse to
  // default first so the store always retains a ship-from origin.
  const bv = await getBusinessValues().catch(() => null)
  if (bv?.pickupLocation && bv.pickupLocation === name) {
    return NextResponse.json(
      { error: 'This is the default warehouse. Set another warehouse as default before removing it.' },
      { status: 409 }
    )
  }

  const tenantId = (await resolveTenantId()) ?? undefined
  const result = await deactivateDelhiveryPickupLocation(name, tenantId)
  if (!result.ok)
    return NextResponse.json({ error: result.error || 'Could not remove the warehouse.' }, { status: 502 })

  return NextResponse.json({ ok: true, name })
}
