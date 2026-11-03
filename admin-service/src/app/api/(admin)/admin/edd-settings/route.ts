import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { query } from '@/lib/shared/db'
import { getBusinessValues, invalidateSiteControlsCache } from '@/lib/catalog/site-controls'
import { resolveTenantId } from '@/lib/tenancy/tenant-context'
import { listDelhiveryPickupLocations, setDefaultPickupLocation } from '@/lib/shipping/delhivery'
import { EDD_DEFAULTS, eddSettingsFromValues } from '@/lib/shipping/edd'
import { eddSettingsSchema } from '@/lib/shipping/edd-settings'

export const dynamic = 'force-dynamic'

// Site Controls > Delivery estimate. Settings live in site_settings.edd_settings (JSON); the
// default warehouse (EDD origin) is the store's Delhivery default pickup location.

export async function GET(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'settings:read'))
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const bv = await getBusinessValues()
  const tenantId = (await resolveTenantId()) ?? undefined
  const warehouses = await listDelhiveryPickupLocations(tenantId).catch(() => [])
  return NextResponse.json({
    settings: eddSettingsFromValues(bv),
    defaults: EDD_DEFAULTS,
    defaultWarehouse: bv.pickupLocation,
    originPin: bv.delhiveryOriginPincode,
    warehouses: warehouses.map(w => ({ name: w.name, pin: w.pin, city: w.city, state: w.state })),
  })
}

export async function PUT(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'settings:write'))
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const body = await request.json().catch(() => null)
  const parsed = eddSettingsSchema.safeParse(body?.settings)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Invalid settings' }, { status: 400 })
  }

  const warehouse = typeof body?.defaultWarehouse === 'string' ? body.defaultWarehouse.trim() : ''
  if (warehouse) {
    const bv = await getBusinessValues()
    if (warehouse !== bv.pickupLocation) {
      const r = await setDefaultPickupLocation(warehouse, (await resolveTenantId()) ?? undefined)
      if (!r.ok) return NextResponse.json({ error: r.error || 'Could not set the warehouse' }, { status: 400 })
    }
  }

  await query(
    `INSERT INTO site_settings (key, value, updated_at) VALUES ('edd_settings', $1, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [JSON.stringify(parsed.data)]
  )
  invalidateSiteControlsCache()
  return NextResponse.json({ ok: true, settings: parsed.data })
}
