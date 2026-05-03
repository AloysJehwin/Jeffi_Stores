import { NextRequest, NextResponse } from 'next/server'
import { queryOne } from '@/lib/db'
import { authenticateUser } from '@/lib/jwt'

export async function POST(request: NextRequest) {
  try {
    const authUser = await authenticateUser(request)
    if (!authUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { code, subtotal } = await request.json()

    if (!code || typeof code !== 'string') {
      return NextResponse.json({ error: 'Coupon code is required' }, { status: 400 })
    }

    const coupon = await queryOne<{
      id: string
      code: string
      description: string | null
      discount_type: string
      discount_value: number
      min_purchase_amount: number | null
      max_discount_amount: number | null
      usage_limit: number | null
      usage_limit_per_user: number | null
      times_used: number
      valid_from: string | null
      valid_until: string | null
      is_active: boolean
    }>(
      `SELECT * FROM coupons WHERE code = $1`,
      [code.toUpperCase().trim()]
    )

    if (!coupon) {
      return NextResponse.json({ error: 'Invalid coupon code' }, { status: 404 })
    }

    if (!coupon.is_active) {
      return NextResponse.json({ error: 'This coupon is no longer active' }, { status: 400 })
    }

    const now = new Date()
    if (coupon.valid_from && new Date(coupon.valid_from) > now) {
      return NextResponse.json({ error: 'This coupon is not valid yet' }, { status: 400 })
    }
    if (coupon.valid_until && new Date(coupon.valid_until) < now) {
      return NextResponse.json({ error: 'This coupon has expired' }, { status: 400 })
    }

    if (coupon.usage_limit !== null && coupon.times_used >= coupon.usage_limit) {
      return NextResponse.json({ error: 'This coupon has reached its usage limit' }, { status: 400 })
    }

    if (coupon.usage_limit_per_user !== null) {
      const userUsage = await queryOne<{ cnt: string }>(
        `SELECT COUNT(*) AS cnt FROM coupon_usage WHERE coupon_id = $1 AND user_id = $2`,
        [coupon.id, authUser.userId]
      )
      if (userUsage && parseInt(userUsage.cnt) >= coupon.usage_limit_per_user) {
        return NextResponse.json({ error: 'You have already used this coupon the maximum number of times' }, { status: 400 })
      }
    }

    const orderSubtotal = typeof subtotal === 'number' ? subtotal : 0

    if (coupon.min_purchase_amount !== null && orderSubtotal < coupon.min_purchase_amount) {
      return NextResponse.json({
        error: `Minimum purchase of ₹${Number(coupon.min_purchase_amount).toLocaleString('en-IN')} required for this coupon`,
      }, { status: 400 })
    }

    let discountAmount = 0
    if (coupon.discount_type === 'percentage') {
      discountAmount = (orderSubtotal * Number(coupon.discount_value)) / 100
      if (coupon.max_discount_amount !== null) {
        discountAmount = Math.min(discountAmount, Number(coupon.max_discount_amount))
      }
    } else {
      discountAmount = Number(coupon.discount_value)
    }

    discountAmount = Math.min(discountAmount, orderSubtotal)
    discountAmount = Math.round(discountAmount * 100) / 100

    return NextResponse.json({
      couponId: coupon.id,
      code: coupon.code,
      description: coupon.description,
      discountType: coupon.discount_type,
      discountValue: Number(coupon.discount_value),
      discountAmount,
      maxDiscountAmount: coupon.max_discount_amount ? Number(coupon.max_discount_amount) : null,
    })
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
