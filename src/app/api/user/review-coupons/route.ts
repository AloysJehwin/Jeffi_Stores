import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/jwt'
import { queryOne } from '@/lib/db'

export async function GET(request: NextRequest) {
  const authUser = await authenticateUser(request)
  if (!authUser) return NextResponse.json({ coupon: null })

  const user = await queryOne<{ email: string }>('SELECT email FROM users WHERE id = $1', [authUser.userId])
  if (!user) return NextResponse.json({ coupon: null })

  const coupon = await queryOne(
    `SELECT c.id, c.code, c.description, c.discount_type, c.discount_value, c.valid_until
     FROM review_form_submissions rfs
     JOIN coupons c ON c.code = rfs.coupon_code
     WHERE rfs.email = $1 AND rfs.coupon_code IS NOT NULL
       AND c.is_active = true AND (c.valid_until IS NULL OR c.valid_until > NOW())
     ORDER BY rfs.submitted_at DESC LIMIT 1`,
    [user.email]
  )

  return NextResponse.json({ coupon: coupon || null })
}
