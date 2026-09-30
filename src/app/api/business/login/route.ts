import { NextRequest, NextResponse } from 'next/server'
import { verifyOTP, deleteOTP, resetSendOtpCounter } from '@/lib/auth/otp'
import { queryOne, query } from '@/lib/shared/db'
import { issueUserToken, USER_SESSION_TTL_S } from '@/lib/auth/issue-session'
import { extractSessionSignals } from '@/lib/auth/session-signals-request'
import { logActivity } from '@/lib/shared/activity'
import { cookieDomainOption } from '@/lib/auth/cookie-domain'
import { POLICY_VERSION } from '@/lib/legals/policies'

if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET environment variable is not set')

export async function POST(request: NextRequest) {
  try {
    const { email, otp, policiesAccepted } = await request.json()
    if (!email || !otp) return NextResponse.json({ error: 'Email and OTP are required' }, { status: 400 })

    const otpVerification = await verifyOTP(email, otp)
    if (!otpVerification.valid) {
      return NextResponse.json({ error: otpVerification.message }, { status: 400 })
    }

    const user = await queryOne<any>(
      `SELECT u.*, bp.approval_status, bp.company_name
       FROM users u
       LEFT JOIN business_profiles bp ON bp.user_id = u.id
       WHERE u.email = $1 AND u.user_type = 'business'`,
      [email.toLowerCase()]
    )

    if (!user) {
      return NextResponse.json(
        { error: 'No business account found. Please sign up.', notBusinessAccount: true },
        { status: 404 }
      )
    }

    if (!user.is_active) {
      return NextResponse.json({ error: 'Account is inactive' }, { status: 403 })
    }

    const approvalStatus = user.approval_status || 'pending'

    if (approvalStatus !== 'approved') {
      await deleteOTP(email)
      await resetSendOtpCounter(email)
      return NextResponse.json({
        approvalStatus,
        message:
          approvalStatus === 'rejected' ? 'Your application was not approved.' : 'Your account is awaiting approval.',
      })
    }

    if (policiesAccepted === true && user.policies_accepted_version !== POLICY_VERSION) {
      await query('UPDATE users SET policies_accepted_version = $1, policies_accepted_at = NOW() WHERE id = $2', [
        POLICY_VERSION,
        user.id,
      ])
    }

    await query('UPDATE users SET last_login = NOW() WHERE id = $1', [user.id])
    logActivity({
      userId: user.id,
      kind: 'login',
      summary: 'Business login via OTP',
      metadata: { provider: 'otp' },
    }).catch(() => {})

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

    const cookieOpts = {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict' as const,
      maxAge: USER_SESSION_TTL_S,
      path: '/',
      ...cookieDomainOption(),
    }
    await deleteOTP(email)
    await resetSendOtpCounter(email)

    const res = NextResponse.json({
      message: 'Login successful',
      approvalStatus: 'approved',
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        companyName: user.company_name,
      },
    })
    res.cookies.set('business_sid', sid, cookieOpts)
    res.cookies.set('session_id', user.id, cookieOpts)
    return res
  } catch (err) {
    console.error('[route]', err)
    return NextResponse.json({ error: 'Login failed' }, { status: 500 })
  }
}
