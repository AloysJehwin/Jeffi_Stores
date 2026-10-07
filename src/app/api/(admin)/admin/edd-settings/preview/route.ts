import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { getBusinessValues } from '@/lib/catalog/site-controls'
import { listDelhiveryPickupLocations } from '@/lib/shipping/delhivery'
import { resolveTenantId } from '@/lib/tenancy/tenant-context'
import { computeEddBreakdown, eddSettingsFromValues, EDD_ZONE_LABELS } from '@/lib/shipping/edd'
import { eddSettingsSchema } from '@/lib/shipping/edd-settings'
import { remoteRegionFromPincode, stateFromPincode } from '@/lib/shipping/india-pincode-state'

export const dynamic = 'force-dynamic'

// Live preview for the Delivery estimate card. Uses the posted (unsaved) settings and warehouse
// when given, so the admin sees the effect before saving; the same computeEdd as checkout.
export async function POST(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'settings:read'))
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const body = await request.json().catch(() => null)
  const pin = String(body?.pin ?? '').replace(/\D/g, '')
  if (!/^\d{6}$/.test(pin)) return NextResponse.json({ error: 'Enter a 6-digit pincode' }, { status: 400 })

  const bv = await getBusinessValues()
  let settings = eddSettingsFromValues(bv)
  if (body?.settings !== undefined) {
    const parsed = eddSettingsSchema.safeParse(body.settings)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Invalid settings' }, { status: 400 })
    }
    settings = parsed.data
  }

  let originPin = bv.delhiveryOriginPincode
  const warehouse = typeof body?.defaultWarehouse === 'string' ? body.defaultWarehouse.trim() : ''
  if (warehouse && warehouse !== bv.pickupLocation) {
    const list = await listDelhiveryPickupLocations((await resolveTenantId()) ?? undefined).catch(() => [])
    const w = list.find(l => l.name === warehouse)
    if (w && /^\d{6}$/.test(w.pin)) originPin = w.pin
  }

  const b = computeEddBreakdown({ pin, originPin, settings })
  return NextResponse.json({
    ...b,
    zoneLabel: EDD_ZONE_LABELS[b.zone],
    originPin,
    state: remoteRegionFromPincode(pin) ?? stateFromPincode(pin),
  })
}
