import { NextRequest, NextResponse } from 'next/server'
import { isOTPVerified, deleteOTP, resetSendOtpCounter } from '@/lib/auth/otp'
import { queryOne, query } from '@/lib/shared/db'
import { issueUserToken, USER_SESSION_TTL_S } from '@/lib/auth/issue-session'
import { extractSessionSignals } from '@/lib/auth/session-signals-request'
import { cookies } from 'next/headers'
import { logActivity } from '@/lib/shared/activity'
import { createAdminNotification } from '@/lib/shared/admin-notify'
import { cookieDomainOption } from '@/lib/auth/cookie-domain'
import { POLICY_VERSION } from '@/lib/legals/policies'

if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET environment variable is not set')

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { email, firstName, lastName, phone, companyName, gstNumber, businessAddress, industry } = body

    if (!email || !firstName || !phone || !companyName || !gstNumber || !businessAddress || !industry) {
      return NextResponse.json({ error: 'All fields are required' }, { status: 400 })
    }

    const otpValid = await isOTPVerified(email)
    if (!otpValid) {
      return NextResponse.json({ error: 'Please verify your OTP first' }, { status: 400 })
    }

    const digits = phone.replace(/\D/g, '')
    const cleaned = digits.startsWith('91') && digits.length === 12 ? digits.slice(2) : digits
    if (cleaned.length !== 10) {
      return NextResponse.json({ error: 'Enter a valid 10-digit mobile number' }, { status: 400 })
    }

    const existingUser = await queryOne<{ id: string }>(
      "SELECT id FROM users WHERE email = $1 AND user_type = 'business'",
      [email.toLowerCase()]
    )
    if (existingUser) {
      await deleteOTP(email)
      return NextResponse.json({ error: 'A business account with this email already exists' }, { status: 400 })
    }

    const newUser = await queryOne<any>(
      `INSERT INTO users (email, first_name, last_name, phone, is_active, user_type, last_login,
                         policies_accepted_version, policies_accepted_at)
       VALUES ($1, $2, $3, $4, true, 'business', NOW(), $5, NOW())
       RETURNING *`,
      [email.toLowerCase(), firstName, lastName || null, cleaned, POLICY_VERSION]
    )
    if (!newUser) return NextResponse.json({ error: 'Failed to create account' }, { status: 500 })

    await query(
      `INSERT INTO business_profiles (user_id, company_name, gst_number, business_address, industry)
       VALUES ($1, $2, $3, $4, $5)`,
      [newUser.id, companyName.trim(), gstNumber.trim().toUpperCase(), businessAddress.trim(), industry.trim()]
    )

    logActivity({
      userId: newUser.id,
      kind: 'signup',
      summary: 'Business account created',
      metadata: { email, source: 'business_otp', companyName },
    }).catch(() => {})

    createAdminNotification({
      type: 'b2b_signup_pending',
      category: 'b2b',
      title: 'New B2B account awaiting approval',
      message: `${companyName} (${email})`,
      link: `/admin/business/customers/${newUser.id}`,
      entityType: 'business_user',
      entityId: String(newUser.id),
      severity: 'warning',
      scope: 'business_customers:read',
    }).catch(() => {})

    const signals = extractSessionSignals(request)
    const { sid } = await issueUserToken({
      userId: newUser.id,
      email: newUser.email,
      type: 'business',
      extraClaims: { isBusiness: true, approvalStatus: 'pending' },
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
    cookieStore.set('session_id', newUser.id, cookieOpts)

    await deleteOTP(email)
    await resetSendOtpCounter(email)

    return NextResponse.json({
      message: 'Business account created successfully',
      approvalStatus: 'pending',
      user: { id: newUser.id, email: newUser.email, firstName: newUser.first_name },
    })
  } catch (err) {
    console.error('[route]', err)
    return NextResponse.json({ error: 'Failed to create account' }, { status: 500 })
  }
}
