import { NextRequest, NextResponse } from 'next/server'
import { verifyOTP, deleteOTP, resetSendOtpCounter } from '@/lib/otp'
import { queryOne, query } from '@/lib/db'
import { issueUserToken, USER_SESSION_TTL_S } from '@/lib/issue-session'
import { extractSessionSignals } from '@/lib/session-signals-request'
import { logActivity } from '@/lib/activity'
import { cookieDomainOption } from '@/lib/cookie-domain'
import { POLICY_VERSION } from '@/lib/legals/policies'

if (!process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is not set')
}

async function recordFailedLogin(req: NextRequest, email: string, reason: string, userId: string | null) {
  try {
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || null
    const ua = req.headers.get('user-agent')?.slice(0, 500) || null
    await query(
      `INSERT INTO failed_login_attempts (email, user_id, ip_address, user_agent, reason)
       VALUES ($1, $2, $3, $4, $5)`,
      [email.toLowerCase(), userId, ip, ua, reason]
    )
  } catch {
    /* swallow */
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { email, otp, policiesAccepted, channel } = body

    if (!email || !otp) {
      return NextResponse.json({ error: 'Email and OTP are required' }, { status: 400 })
    }

    const otpVerification = await verifyOTP(email, otp)
    if (!otpVerification.valid) {
      const existingUser = await queryOne("SELECT id FROM users WHERE email = $1 AND user_type != 'business'", [
        email.toLowerCase(),
      ])
      await recordFailedLogin(request, email, 'invalid_otp', existingUser?.id ?? null)
      return NextResponse.json({ error: otpVerification.message }, { status: 400 })
    }

    const user = await queryOne("SELECT * FROM users WHERE email = $1 AND user_type != 'business'", [
      email.toLowerCase(),
    ])

    if (!user) {
      const bizUser = await queryOne("SELECT id FROM users WHERE email = $1 AND user_type = 'business'", [
        email.toLowerCase(),
      ])
      if (bizUser) {
        return NextResponse.json(
          { error: 'This email is registered as a business account. Please use the business portal to sign in.' },
          { status: 403 }
        )
      }
      return NextResponse.json({ isNewUser: true, email }, { status: 200 })
    }

    if (!user.is_active) {
      await recordFailedLogin(request, email, 'inactive_account', user.id)
      return NextResponse.json({ error: 'Account is inactive' }, { status: 403 })
    }

    if (policiesAccepted === true && user.policies_accepted_version !== POLICY_VERSION) {
      await query('UPDATE users SET policies_accepted_version = $1, policies_accepted_at = NOW() WHERE id = $2', [
        POLICY_VERSION,
        user.id,
      ])
    }

    await query('UPDATE users SET last_login = NOW() WHERE id = $1', [user.id])

    if (channel && channel !== user.notification_channel) {
      await query('UPDATE users SET notification_channel = $1 WHERE id = $2', [channel, user.id])
    }

    logActivity({
      userId: user.id,
      kind: 'login',
      summary: 'Logged in via OTP',
      metadata: { provider: 'otp' },
    }).catch(() => {})

    // Read guest session from request cookies directly (avoids Next.js 15 cookies() context issues)
    const guestSessionId = request.cookies.get('session_id')?.value
    if (guestSessionId && guestSessionId.startsWith('guest_')) {
      const guestUser = await queryOne('SELECT id FROM users WHERE session_id = $1 AND is_guest = true', [
        guestSessionId,
      ])
      if (guestUser) {
        await query('SELECT merge_guest_cart_to_user($1, $2)', [guestUser.id, user.id]).catch(() => {})
      }
    }

    const signals = extractSessionSignals(request)
    const { sid } = await issueUserToken({
      userId: user.id,
      email: user.email,
      type: 'customer',
      userAgent: signals.userAgent,
      ip: signals.ip,
      acceptLanguage: signals.acceptLanguage,
      uaPlatform: signals.uaPlatform,
      fpHash: signals.fpHash,
    })

    await deleteOTP(email)
    await resetSendOtpCounter(email)

    const cookieOpts = {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict' as const,
      maxAge: USER_SESSION_TTL_S,
      path: '/',
      ...cookieDomainOption(),
    }

    const res = NextResponse.json({
      message: 'Login successful',
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        phone: user.phone,
      },
    })
    res.cookies.set('user_sid', sid, cookieOpts)
    res.cookies.set('session_id', user.id, cookieOpts)
    return res
  } catch (err: any) {
    return NextResponse.json({ error: 'Login failed', detail: err?.message }, { status: 500 })
  }
}
