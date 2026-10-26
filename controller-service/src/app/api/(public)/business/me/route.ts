import { NextRequest, NextResponse } from 'next/server'
import { queryOne, queryMany } from '@/lib/shared/db'
import { authenticateBusiness } from '@/lib/auth/jwt'
import { POLICY_VERSION } from '@/lib/legals/policies'
import { formatDob } from '@/lib/shared/format'

export async function GET(request: NextRequest) {
  try {
    const payload = await authenticateBusiness(request)
    if (!payload) return NextResponse.json({ user: null })

    const user = await queryOne<any>(
      `SELECT u.id, u.email, u.first_name, u.last_name, u.phone, u.phone_verified, u.date_of_birth,
              u.created_at, u.avatar_url, u.policies_accepted_version,
              bp.approval_status, bp.company_name, bp.gst_number, bp.industry, bp.business_address, bp.rejection_note
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
        phoneVerified: user.phone_verified ?? false,
        dateOfBirth: formatDob(user.date_of_birth),
        createdAt: user.created_at,
        avatarUrl: user.avatar_url || null,
        isBusiness: true,
        approvalStatus: user.approval_status || 'pending',
        companyName: user.company_name,
        gstNumber: user.gst_number || null,
        industry: user.industry || null,
        businessAddress: user.business_address || null,
        rejectionNote: user.approval_status === 'rejected' ? user.rejection_note || null : null,
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
