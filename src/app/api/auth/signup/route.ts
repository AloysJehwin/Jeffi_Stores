import { NextRequest, NextResponse } from 'next/server'
import { isOTPVerified, deleteOTP, resetSendOtpCounter } from '@/lib/otp'
import { sendWelcomeEmail } from '@/lib/email'
import { queryOne } from '@/lib/db'
import { issueUserToken, USER_SESSION_TTL_S } from '@/lib/issue-session'
import { extractSessionSignals } from '@/lib/session-signals-request'
import { logActivity } from '@/lib/activity'
import { cookieDomainOption } from '@/lib/cookie-domain'
import { POLICY_VERSION } from '@/app/legal/policies'

if (!process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is not set')
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { email, firstName, lastName, phone, channel } = body

    if (!email || !firstName) {
      return NextResponse.json(
        { error: 'Email and first name are required' },
        { status: 400 }
      )
    }

    if (!phone) {
      return NextResponse.json({ error: 'Mobile number is required' }, { status: 400 })
    }

    const otpValid = await isOTPVerified(email)
    if (!otpValid) {
      return NextResponse.json(
        { error: 'Please verify your OTP first' },
        { status: 400 }
      )
    }

    let normalizedPhone = null
    if (phone) {
      const digits = phone.replace(/\D/g, '')
      const cleaned = digits.startsWith('91') && digits.length === 12 ? digits.slice(2) : digits
      if (cleaned.length !== 10) {
        return NextResponse.json({ error: 'Enter a valid 10-digit mobile number' }, { status: 400 })
      }
      normalizedPhone = cleaned
    }

    const existingUser = await queryOne(
      "SELECT id FROM users WHERE email = $1 AND user_type != 'business'",
      [email.toLowerCase()]
    )

    if (existingUser) {
      await deleteOTP(email)
      return NextResponse.json({ error: 'Email already registered' }, { status: 400 })
    }

    const newUser = await queryOne(
      `INSERT INTO users (email, first_name, last_name, phone, is_active, last_login,
                         policies_accepted_version, policies_accepted_at, notification_channel)
       VALUES ($1, $2, $3, $4, $5, NOW(), $6, NOW(), $7)
       RETURNING *`,
      [email.toLowerCase(), firstName, lastName || null, normalizedPhone, true, POLICY_VERSION, channel || 'email']
    )

    if (!newUser) {
      return NextResponse.json({ error: 'Failed to create account' }, { status: 500 })
    }

    sendWelcomeEmail(email, firstName).catch(() => {})

    logActivity({
      userId: newUser.id,
      kind: 'signup',
      summary: `Account created`,
      metadata: { email, source: 'email_otp' },
    }).catch(() => {})

    const signals = extractSessionSignals(request)
    const { sid } = await issueUserToken({
      userId: newUser.id,
      email: newUser.email,
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
      message: 'Account created successfully',
      user: {
        id: newUser.id,
        email: newUser.email,
        firstName: newUser.first_name,
        lastName: newUser.last_name,
        phone: newUser.phone,
      },
    })
    res.cookies.set('user_sid', sid, cookieOpts)
    res.cookies.set('session_id', newUser.id, cookieOpts)
    return res
  } catch {
    return NextResponse.json({ error: 'Failed to create account' }, { status: 500 })
  }
}
