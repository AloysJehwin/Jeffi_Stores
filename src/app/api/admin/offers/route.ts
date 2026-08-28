import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { query } from '@/lib/db'
import { parseBody } from '@/lib/validate'
import { getOffersWithSettings } from '@/lib/razorpay-offers'
import { logAdminAudit } from '@/lib/admin-audit'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'coupons:read')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }
  const { offers, fetch } = await getOffersWithSettings()
  return NextResponse.json({
    offers,
    ok: fetch.ok,
    problem: fetch.ok ? null : { reason: fetch.reason, detail: fetch.detail },
  })
}

const PatchSchema = z.object({
  offerId: z.string().min(1).max(64),
  isVisible: z.boolean().optional(),
  titleOverride: z.string().trim().max(200).nullish(),
  displayOrder: z.number().int().min(0).max(999).optional(),
})

export async function PATCH(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'coupons:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const parsed = parseBody(PatchSchema, await request.json().catch(() => null))
  if (!parsed.ok) return parsed.response
  const { offerId, isVisible, titleOverride, displayOrder } = parsed.data

  // The offer must exist on the account — otherwise a typo silently creates a row that
  // controls nothing and looks like a working setting.
  const { offers: known } = await getOffersWithSettings()
  const target = known.find((o) => o.id === offerId)
  if (!target) return NextResponse.json({ error: 'Unknown offer for this Razorpay account' }, { status: 404 })

  await query(
    `INSERT INTO offer_display_settings (offer_id, is_visible, title_override, display_order, updated_by, updated_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (offer_id) DO UPDATE SET
       is_visible     = COALESCE($2, offer_display_settings.is_visible),
       title_override = $3,
       display_order  = COALESCE($4, offer_display_settings.display_order),
       updated_by     = $5,
       updated_at     = now()`,
    [
      offerId,
      isVisible ?? target.isVisible,
      titleOverride?.trim() || null,
      displayOrder ?? target.displayOrder,
      admin.adminId,
    ],
  )

  await logAdminAudit({
    adminId: admin.adminId,
    action: 'update',
    entityType: 'campaign',
    entityId: offerId,
    summary: `Offer display updated: ${target.title}`,
    metadata: { offerId, isVisible, titleOverride: titleOverride ?? null, displayOrder },
    request,
  }).catch(() => {})

  return NextResponse.json({ ok: true })
}
