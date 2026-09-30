import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { resolveTenantId } from '@/lib/tenant-context'
import { createDelhiveryPickupLocation, checkPincodeServiceability } from '@/lib/delhivery'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'delhivery:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const body = await request.json().catch(() => ({}))
  const name = String(body?.name || '').trim()
  const phone = String(body?.phone || '').replace(/\D/g, '')
  const pincode = String(body?.pincode || '').replace(/\D/g, '')
  const address = String(body?.address || '').trim()
  const registeredName = String(body?.registeredName || '').trim() || undefined
  const email = String(body?.email || '').trim() || undefined
  const city = String(body?.city || '').trim() || undefined
  const state = String(body?.state || '').trim() || undefined

  if (!name || !address)
    return NextResponse.json({ error: 'Warehouse name and address are required.' }, { status: 400 })
  if (phone.length < 10) return NextResponse.json({ error: 'A 10-digit phone number is required.' }, { status: 400 })
  if (!/^\d{6}$/.test(pincode)) return NextResponse.json({ error: 'A six-digit pincode is required.' }, { status: 400 })

  const tenantId = await resolveTenantId()

  const serviceability = await checkPincodeServiceability(pincode, tenantId ?? undefined)
  if (!serviceability.pickup) {
    return NextResponse.json(
      { error: serviceability.error || 'Delhivery cannot pick up from this pincode.' },
      { status: 422 }
    )
  }

  const result = await createDelhiveryPickupLocation({
    name,
    phone,
    pincode,
    address,
    registeredName,
    email,
    city,
    state,
    tenantId: tenantId ?? undefined,
  })
  if (!result.ok)
    return NextResponse.json({ error: result.error || 'Could not create the warehouse.' }, { status: 502 })

  return NextResponse.json({ ok: true, name })
}
