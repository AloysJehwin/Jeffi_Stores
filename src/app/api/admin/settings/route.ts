import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { query } from '@/lib/db'
import { invalidateDeliverySettingsCache } from '@/lib/delivery-settings'

const EDITABLE_KEYS = [
  'min_order_amount',
  'delivery_charges_enabled',
  'delivery_free_threshold',
  'delivery_discount_percent',
  'delivery_discount_flat',
  'delivery_discount_min_subtotal',
  'delivery_discount_label',
]

export async function PATCH(request: NextRequest) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'settings')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    const { key, value } = await request.json()

    if (!EDITABLE_KEYS.includes(key)) {
      return NextResponse.json({ error: 'Setting not editable via this endpoint' }, { status: 400 })
    }

    await query(
      `UPDATE site_settings SET value = $1, updated_at = NOW() WHERE key = $2`,
      [String(value), key]
    )

    if (key.startsWith('delivery_')) {
      invalidateDeliverySettingsCache()
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[route]', err)
    return NextResponse.json({ error: 'Failed to update setting' }, { status: 500 })
  }
}
