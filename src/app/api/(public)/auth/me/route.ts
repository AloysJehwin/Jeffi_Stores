import { NextRequest, NextResponse } from 'next/server'
import { queryOne } from '@/lib/shared/db'
import { authenticateUser } from '@/lib/auth/jwt'
import { POLICY_VERSION } from '@/lib/legals/policies'

export async function GET(request: NextRequest) {
  try {
    const userPayload = await authenticateUser(request)
    if (!userPayload) return NextResponse.json({ user: null })

    const user = await queryOne<any>(
      `SELECT id, email, first_name, last_name, phone, phone_verified, created_at, avatar_url, policies_accepted_version
       FROM users WHERE id = $1 AND user_type != 'business'`,
      [userPayload.userId]
    )
    if (!user) return NextResponse.json({ user: null })

    return NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        phone: user.phone,
        phoneVerified: user.phone_verified,
        createdAt: user.created_at,
        avatarUrl: user.avatar_url || null,
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
