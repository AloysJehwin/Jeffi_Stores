import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { query } from '@/lib/db'
import { invalidateDeliverySettingsCache } from '@/lib/delivery-settings'
import { invalidateSiteControlsCache } from '@/lib/site-controls'

// All keys editable via this endpoint. Grouped for readability.
const EDITABLE_KEYS = [
  // Store rules
  'min_order_amount',
  // Delivery (already existed)
  'delivery_charges_enabled',
  'delivery_free_threshold',
  'delivery_discount_percent',
  'delivery_discount_flat',
  'delivery_discount_min_subtotal',
  'delivery_discount_label',
  // Store identity
  'business_name',
  'business_web',
  'business_logo_url',
  'business_email',
  'business_phone',
  // Invoice / legal / bank identity (previously DB-seeded, now editable)
  'business_gstin',
  'business_legal_name',
  'business_trade_name',
  'business_address',
  'business_state',
  'business_state_code',
  'bank_name',
  'bank_account',
  'bank_ifsc',
  'bank_branch',
  'invoice_prefix',
  // Feature flags
  'feature_razorpay_enabled',
  'feature_gst_enabled',
  'feature_ondevice_summary_enabled',
  'feature_ondevice_finetune_enabled',
  // Business values
  'cod_surcharge_flat',
  'cod_surcharge_pct',
  'shipping_min_charge',
  'shipping_max_charge',
  'order_auto_cancel_minutes',
  'delhivery_origin_pincode',
  'default_product_weight_g',
  'delhivery_pickup_location',
  'delhivery_seller_name',
  'delhivery_seller_address',
  'delhivery_seller_phone',
  // Storefront content
  'storefront_featured_limit',
  'storefront_new_arrivals_limit',
  'storefront_stats_json',
  'storefront_about_copy',
]

const EDITABLE_SET = new Set(EDITABLE_KEYS)

// Upsert a single key/value pair. site_settings has a UNIQUE(key) constraint.
// NOTE: updated_by is intentionally NOT written — its FK references users(id),
// but admin sessions expose the admins PK (adminId), not the linked user_id.
// The original settings route never set it either; the column stays nullable.
async function upsert(key: string, value: string) {
  await query(
    `INSERT INTO site_settings (key, value, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [key, String(value)]
  )
}

function invalidateFor(keys: string[]) {
  if (keys.some(k => k.startsWith('delivery_'))) invalidateDeliverySettingsCache()
  // Any non-delivery key may be part of site-controls; invalidate broadly (cheap).
  invalidateSiteControlsCache()
}

export async function PATCH(request: NextRequest) {
  try {
    const admin = await authenticateAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!hasScope(admin.role, admin.scopes, 'settings:write')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    const body = await request.json()

    // Batch mode: { updates: [{ key, value }, ...] }
    if (Array.isArray(body?.updates)) {
      const updates = body.updates as Array<{ key: string; value: unknown }>
      const bad = updates.find(u => !EDITABLE_SET.has(u.key))
      if (bad) return NextResponse.json({ error: `Setting not editable: ${bad.key}` }, { status: 400 })
      for (const u of updates) await upsert(u.key, String(u.value))
      invalidateFor(updates.map(u => u.key))
      return NextResponse.json({ success: true, count: updates.length })
    }

    // Single mode: { key, value }
    const { key, value } = body
    if (!EDITABLE_SET.has(key)) {
      return NextResponse.json({ error: 'Setting not editable via this endpoint' }, { status: 400 })
    }
    await upsert(key, String(value))
    invalidateFor([key])
    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'Failed to update setting' }, { status: 500 })
  }
}
