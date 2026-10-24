import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/auth/jwt'
import { queryOne } from '@/lib/shared/db'

export async function GET(request: NextRequest) {
  const authUser = await authenticateUser(request)
  if (!authUser) return NextResponse.json({ coupon: null })

  const user = await queryOne<{ email: string }>('SELECT email FROM users WHERE id = $1', [authUser.userId])
  if (!user) return NextResponse.json({ coupon: null })

  const reviewCoupon = await queryOne(
    `SELECT c.id, c.code, c.description, c.discount_type, c.discount_value, c.valid_until
     FROM review_form_submissions rfs
     JOIN coupons c ON c.code = rfs.coupon_code
     WHERE rfs.email = $1 AND rfs.coupon_code IS NOT NULL
       AND c.is_active = true AND (c.valid_until IS NULL OR c.valid_until > NOW())
     ORDER BY rfs.submitted_at DESC LIMIT 1`,
    [user.email]
  )
  // A rewards-game prize the customer hasn't spent yet is surfaced the same way.
  const coupon =
    reviewCoupon ??
    (await queryOne(
      `SELECT c.id, c.code, c.description, c.discount_type, c.discount_value, c.valid_until
       FROM coupons c
       WHERE c.generated_for_user_id = $1 AND c.generated_for_campaign LIKE 'reward_game:%'
         AND c.is_active = true AND (c.valid_until IS NULL OR c.valid_until > NOW())
         AND c.times_used < COALESCE(c.usage_limit, 1)
       ORDER BY c.created_at DESC LIMIT 1`,
      [authUser.userId]
    ))

  return NextResponse.json({ coupon: coupon || null })
}
