import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { issueUserToken, USER_SESSION_TTL_S } from '@/lib/auth/issue-session'
import { extractSessionSignals } from '@/lib/auth/session-signals-request'
import { queryOne, query } from '@/lib/shared/db'
import { logActivity } from '@/lib/shared/activity'
import { createAdminNotification } from '@/lib/shared/admin-notify'
import { cookieDomainOption } from '@/lib/auth/cookie-domain'
import { POLICY_VERSION } from '@/lib/legals/policies'
import { verifyGoogleCredential } from '@/lib/auth/google-verify'
import { normalizeDob } from '@/lib/shared/format'

if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET environment variable is not set')

// The Google token is re-verified here; the client's email is never trusted.
export async function POST(request: NextRequest) {
  try {
    const {
      idToken,
      accessToken,
      firstName,
      lastName,
      phone,
      dateOfBirth,
      companyName,
      gstNumber,
      businessAddress,
      industry,
    } = await request.json()

    const payload = await verifyGoogleCredential(idToken, accessToken)
    if (!payload) return NextResponse.json({ error: 'Invalid Google token' }, { status: 401 })

    const email = payload.email.toLowerCase()
    const googleId = payload.sub

    if (!firstName || !String(firstName).trim()) {
      return NextResponse.json({ error: 'First name is required' }, { status: 400 })
    }
    if (!companyName || !gstNumber || !businessAddress || !industry) {
      return NextResponse.json({ error: 'All business fields are required' }, { status: 400 })
    }

    const digits = String(phone || '').replace(/\D/g, '')
    const cleanedPhone = digits.startsWith('91') && digits.length === 12 ? digits.slice(2) : digits
    if (cleanedPhone.length !== 10) {
      return NextResponse.json({ error: 'Enter a valid 10-digit mobile number' }, { status: 400 })
    }

    const normalizedDob = normalizeDob(dateOfBirth)
    if (!normalizedDob) {
      return NextResponse.json({ error: 'Enter a valid date of birth' }, { status: 400 })
    }

    const existing = await queryOne<{ id: string }>(
      "SELECT id FROM users WHERE (google_id = $1 OR email = $2) AND user_type = 'business' LIMIT 1",
      [googleId, email]
    )
    if (existing) {
      return NextResponse.json({ error: 'A business account with this email already exists' }, { status: 409 })
    }

    let newUser
    try {
      newUser = await queryOne<any>(
        `INSERT INTO users (email, first_name, last_name, phone, is_active, auth_provider, google_id, user_type,
                            last_login, policies_accepted_version, policies_accepted_at, date_of_birth)
         VALUES ($1, $2, $3, $4, true, 'google', $5, 'business', NOW(), $6, NOW(), $7)
         RETURNING *`,
        [email, firstName, lastName || null, cleanedPhone, googleId, POLICY_VERSION, normalizedDob]
      )
    } catch (err: any) {
      if (err?.code === '23505') {
        return NextResponse.json(
          { error: 'This email or mobile number is already in use by another account.' },
          { status: 409 }
        )
      }
      throw err
    }
    if (!newUser) return NextResponse.json({ error: 'Failed to create account' }, { status: 500 })

    await query(
      `INSERT INTO business_profiles (user_id, company_name, gst_number, business_address, industry)
       VALUES ($1, $2, $3, $4, $5)`,
      [newUser.id, companyName.trim(), gstNumber.trim().toUpperCase(), businessAddress.trim(), industry.trim()]
    )

    logActivity({
      userId: newUser.id,
      kind: 'signup',
      summary: 'Business account created via Google',
      metadata: { provider: 'google', companyName },
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

    return NextResponse.json({
      message: 'Business account created successfully',
      approvalStatus: 'pending',
      user: {
        id: newUser.id,
        email: newUser.email,
        firstName: newUser.first_name,
        lastName: newUser.last_name,
        phone: newUser.phone,
        phoneVerified: newUser.phone_verified ?? false,
      },
    })
  } catch (err: any) {
    return NextResponse.json({ error: 'Failed to create account', detail: err?.message }, { status: 500 })
  }
}
