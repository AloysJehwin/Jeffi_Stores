import { NextRequest, NextResponse } from 'next/server'
import { queryOne, queryMany } from '@/lib/db'
import { authenticateUser } from '@/lib/jwt'

export async function GET(request: NextRequest) {
  try {
    const userPayload = await authenticateUser(request)

    if (!userPayload) {
      return NextResponse.json({ user: null })
    }

    const user = await queryOne<any>(
      `SELECT u.id, u.email, u.first_name, u.last_name, u.phone, u.created_at, u.avatar_url, u.user_type,
              bp.approval_status, bp.company_name
       FROM users u
       LEFT JOIN business_profiles bp ON bp.user_id = u.id
       WHERE u.id = $1`,
      [userPayload.userId]
    )

    if (!user) {
      return NextResponse.json({ user: null })
    }

    const isBusiness = user.user_type === 'business'
    let businessDiscountMap: Record<string, number> = {}

    if (isBusiness && user.approval_status === 'approved') {
      const discounts = await queryMany<{ category_id: string; discount_pct: string }>(
        'SELECT category_id, discount_pct FROM business_discounts WHERE user_id=$1',
        [user.id]
      )
      businessDiscountMap = Object.fromEntries(discounts.map(d => [d.category_id, parseFloat(d.discount_pct)]))
    }

    return NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        phone: user.phone,
        createdAt: user.created_at,
        avatarUrl: user.avatar_url || null,
        isBusiness,
        approvalStatus: isBusiness ? (user.approval_status || 'pending') : undefined,
        companyName: isBusiness ? user.company_name : undefined,
        businessDiscountMap: isBusiness && user.approval_status === 'approved' ? businessDiscountMap : undefined,
      },
    })
  } catch {
    return NextResponse.json({ user: null })
  }
}
