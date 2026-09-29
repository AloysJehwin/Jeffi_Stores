import { NextRequest, NextResponse } from 'next/server'
import { queryOne, queryMany } from '@/lib/db'
import { authenticateBusiness } from '@/lib/jwt'
import { POLICY_VERSION } from '@/lib/legals/policies'

export async function GET(request: NextRequest) {
  try {
    const payload = await authenticateBusiness(request)
    if (!payload) return NextResponse.json({ user: null })

    const user = await queryOne<any>(
      `SELECT u.id, u.email, u.first_name, u.last_name, u.phone, u.created_at, u.avatar_url,
              u.policies_accepted_version,
              bp.approval_status, bp.company_name
       FROM users u
       LEFT JOIN business_profiles bp ON bp.user_id = u.id
       WHERE u.id = $1 AND u.user_type = 'business'`,
      [payload.userId]
    )
    if (!user) return NextResponse.json({ user: null })

    let businessDiscountMap: Record<string, number> = {}
    if (user.approval_status === 'approved') {
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
        isBusiness: true,
        approvalStatus: user.approval_status || 'pending',
        companyName: user.company_name,
        businessDiscountMap: user.approval_status === 'approved' ? businessDiscountMap : undefined,
        policiesAcceptedVersion: user.policies_accepted_version,
        requiresPolicyAcceptance: user.policies_accepted_version !== POLICY_VERSION,
        policyVersion: POLICY_VERSION,
      },
    })
  } catch (err) {
    console.error('[route]', err)
    return NextResponse.json({ user: null })
  }
}
