import { NextRequest, NextResponse } from 'next/server'
import { issueUserToken, USER_SESSION_TTL_S } from '@/lib/auth/issue-session'
import { extractSessionSignals } from '@/lib/auth/session-signals-request'
import { queryOne, query } from '@/lib/shared/db'
import { cookies } from 'next/headers'
import { logActivity } from '@/lib/shared/activity'
import { cookieDomainOption } from '@/lib/auth/cookie-domain'
import { verifyGoogleCredential } from '@/lib/auth/google-verify'

if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET environment variable is not set')

export async function POST(request: NextRequest) {
  try {
    const { idToken, accessToken } = await request.json()
    if (!idToken && !accessToken)
      return NextResponse.json({ error: 'idToken or accessToken required' }, { status: 400 })

    const googlePayload = await verifyGoogleCredential(idToken, accessToken)
    if (!googlePayload) return NextResponse.json({ error: 'Invalid Google token' }, { status: 401 })

    const email = googlePayload.email.toLowerCase()
    const googleId = googlePayload.sub
    const firstName = googlePayload.given_name || googlePayload.name?.split(' ')[0] || ''
    const lastName = googlePayload.family_name || googlePayload.name?.split(' ').slice(1).join(' ') || ''

    let user = await queryOne<any>(
      `SELECT u.*, bp.approval_status, bp.company_name FROM users u
       LEFT JOIN business_profiles bp ON bp.user_id = u.id
       WHERE (u.google_id = $1 OR u.email = $2) AND u.user_type = 'business' LIMIT 1`,
      [googleId, email]
    )

    if (!user) {
      // No account is created here; /api/business/google/complete does that once the details are supplied.
      return NextResponse.json({
        newUser: true,
        profile: { email, firstName, lastName },
      })
    } else {
      if (!user.is_active) return NextResponse.json({ error: 'Account is inactive' }, { status: 403 })
      if (!user.google_id)
        await query('UPDATE users SET google_id=$1, auth_provider=$2 WHERE id=$3', [googleId, 'google', user.id])
      await query('UPDATE users SET last_login=NOW() WHERE id=$1', [user.id])
      logActivity({
        userId: user.id,
        kind: 'login',
        summary: 'Business login via Google',
        metadata: { provider: 'google' },
      }).catch(() => {})
    }

    const approvalStatus = user.approval_status || 'pending'
    if (approvalStatus !== 'approved') {
      return NextResponse.json({
        approvalStatus,
        message:
          approvalStatus === 'rejected' ? 'Your application was not approved.' : 'Your account is awaiting approval.',
      })
    }

    const signals = extractSessionSignals(request)
    const { sid } = await issueUserToken({
      userId: user.id,
      email: user.email,
      type: 'business',
      extraClaims: { isBusiness: true, approvalStatus: 'approved' },
      userAgent: signals.userAgent,
      ip: signals.ip,
      acceptLanguage: signals.acceptLanguage,
      uaPlatform: signals.uaPlatform,
      fpHash: signals.fpHash,
    })

    const cookieStore = await cookies()
    const cookieOpts = {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax' as const,
      maxAge: USER_SESSION_TTL_S,
      path: '/',
      ...cookieDomainOption(),
    }
    cookieStore.set('business_sid', sid, cookieOpts)
    cookieStore.set('session_id', user.id, cookieOpts)

    return NextResponse.json({
      message: 'Login successful',
      approvalStatus: 'approved',
      phone: user.phone || null,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        companyName: user.company_name,
      },
    })
  } catch (err: any) {
    return NextResponse.json({ error: 'Authentication failed', detail: err?.message }, { status: 500 })
  }
}
