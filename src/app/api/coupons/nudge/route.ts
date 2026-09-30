import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { queryMany } from '@/lib/db'
import { authenticateAnyUser } from '@/lib/jwt'
import { round2 } from '@/lib/gst'
import { zCurrency } from '@/lib/validate'

export const dynamic = 'force-dynamic'

const QuerySchema = z.object({ subtotal: zCurrency.max(100_000_000) })

interface PublicCoupon {
  code: string
  discount_type: string
  discount_value: number
  min_purchase: number
  max_discount: number | null
}

interface Nudge {
  code: string
  saving: number
  shortfall: number
}

// coupons has no visibility flag: "public" is what the admin labels All Users -- a published
// manual code with no user, campaign, mailer, eligible-user list or review-form reward attached.
const PUBLIC_COUPONS_SQL = `
  SELECT c.code, c.discount_type,
         c.discount_value::float8 AS discount_value,
         COALESCE(c.min_purchase_amount, 0)::float8 AS min_purchase,
         c.max_discount_amount::float8 AS max_discount
  FROM coupons c
  WHERE c.is_active = TRUE
    AND c.is_draft = FALSE
    AND c.auto_generated = FALSE
    AND c.generated_for_user_id IS NULL
    AND c.generated_for_campaign IS NULL
    AND c.discount_value > 0
    AND (c.valid_from IS NULL OR c.valid_from <= NOW())
    AND (c.valid_until IS NULL OR c.valid_until >= NOW())
    AND (c.usage_limit IS NULL OR COALESCE(c.times_used, 0) < c.usage_limit)
    AND NOT EXISTS (SELECT 1 FROM coupon_eligible_users e WHERE e.coupon_id = c.id)
    AND NOT EXISTS (SELECT 1 FROM campaigns cp WHERE cp.coupon_id = c.id)
    AND NOT EXISTS (SELECT 1 FROM review_forms rf WHERE rf.coupon_id = c.id)
    AND NOT EXISTS (SELECT 1 FROM email_campaigns ec WHERE ec.audience_filter->>'couponId' = c.id::text)
    AND ($1::uuid IS NULL OR c.usage_limit_per_user IS NULL
         OR (SELECT COUNT(*) FROM coupon_usage u WHERE u.coupon_id = c.id AND u.user_id = $1::uuid) < c.usage_limit_per_user)
  ORDER BY c.code
`

function discountAt(coupon: PublicCoupon, subtotal: number): number {
  const raw =
    coupon.discount_type === 'percentage'
      ? Math.min((subtotal * coupon.discount_value) / 100, coupon.max_discount ?? Infinity)
      : coupon.discount_value
  return round2(Math.max(0, Math.min(raw, subtotal)))
}

function pickNudge(coupons: PublicCoupon[], subtotal: number): Nudge | null {
  let best: Nudge | null = null
  for (const coupon of coupons) {
    if (subtotal < coupon.min_purchase) continue
    const saving = discountAt(coupon, subtotal)
    if (saving > 0 && (!best || saving > best.saving)) best = { code: coupon.code, saving, shortfall: 0 }
  }
  if (best) return best

  let next: Nudge | null = null
  for (const coupon of coupons) {
    const shortfall = round2(coupon.min_purchase - subtotal)
    if (shortfall <= 0 || shortfall > subtotal) continue
    const saving = discountAt(coupon, coupon.min_purchase)
    if (saving <= 0) continue
    if (!next || shortfall < next.shortfall || (shortfall === next.shortfall && saving > next.saving)) {
      next = { code: coupon.code, saving, shortfall }
    }
  }
  return next
}

/**
 * The best public coupon for a cart subtotal: one that applies now, else the nearest one to unlock
 * (only when it at most doubles the cart). Returns just the code and amounts the nudge shows.
 */
export async function GET(request: NextRequest) {
  const parsed = QuerySchema.safeParse({ subtotal: new URL(request.url).searchParams.get('subtotal') ?? undefined })
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  const { subtotal } = parsed.data
  const headers = { 'Cache-Control': 'private, no-store' }
  if (subtotal <= 0) return NextResponse.json({ nudge: null }, { headers })

  try {
    const auth = await authenticateAnyUser(request)
    const coupons = await queryMany<PublicCoupon>(PUBLIC_COUPONS_SQL, [auth?.userId ?? null])
    return NextResponse.json({ nudge: pickNudge(coupons, subtotal) }, { headers })
  } catch (err) {
    console.error('[coupons/nudge]', err)
    return NextResponse.json({ nudge: null }, { headers })
  }
}
