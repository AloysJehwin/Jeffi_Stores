import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { issueUserToken, USER_SESSION_TTL_S } from '@/lib/auth/issue-session'
import { extractSessionSignals } from '@/lib/auth/session-signals-request'
import { queryOne, query } from '@/lib/shared/db'
import { logActivity } from '@/lib/shared/activity'
import { uploadAvatarImage } from '@/lib/shared/s3'
import { cookieDomainOption } from '@/lib/auth/cookie-domain'
import { POLICY_VERSION } from '@/lib/legals/policies'
import { verifyGoogleCredential } from '@/lib/auth/google-verify'
import { normalizeDob, formatDob } from '@/lib/shared/format'
import { attributeReferral } from '@/lib/referrals/attribute'
import { clearReferralCookie, readReferralCookie } from '@/lib/referrals/cookie'

if (!process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is not set')
}

// The Google token is re-verified here; the client's email is never trusted.
export async function POST(request: NextRequest) {
  try {
    const { idToken, accessToken, firstName, lastName, phone, dateOfBirth } = await request.json()

    const payload = await verifyGoogleCredential(idToken, accessToken)
    if (!payload) return NextResponse.json({ error: 'Invalid Google token' }, { status: 401 })

    const email = payload.email.toLowerCase()
    const googleId = payload.sub

    if (!firstName || !String(firstName).trim()) {
      return NextResponse.json({ error: 'First name is required' }, { status: 400 })
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

    const existing = await queryOne<any>(
      'SELECT id, user_type FROM users WHERE (google_id = $1 OR email = $2) LIMIT 1',
      [googleId, email]
    )
    if (existing) {
      return NextResponse.json({ error: 'An account with this email already exists. Please sign in.' }, { status: 409 })
    }

    let user
    try {
      user = await queryOne<any>(
        `INSERT INTO users (email, first_name, last_name, phone, is_active, auth_provider, google_id,
                            last_login, policies_accepted_version, policies_accepted_at, date_of_birth)
         VALUES ($1, $2, $3, $4, true, 'google', $5, NOW(), $6, NOW(), $7)
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

    if (!user) return NextResponse.json({ error: 'Failed to create account' }, { status: 500 })

    logActivity({
      userId: user.id,
      kind: 'signup',
      summary: 'Signed up via Google',
      metadata: { provider: 'google' },
    }).catch(() => {})

    if (payload.picture) {
      try {
        const imgRes = await fetch(payload.picture)
        if (imgRes.ok) {
          const imgBuffer = Buffer.from(await imgRes.arrayBuffer())
          const { url, s3Key } = await uploadAvatarImage(imgBuffer, user.id)
          await query('UPDATE users SET avatar_url = $1, avatar_s3_key = $2 WHERE id = $3', [url, s3Key, user.id])
        }
      } catch {}
    }

    const cookieStore = await cookies()
    const guestSessionId = cookieStore.get('session_id')?.value
    if (guestSessionId?.startsWith('guest_')) {
      const guestUser = await queryOne<any>('SELECT id FROM users WHERE session_id = $1 AND is_guest = true', [
        guestSessionId,
      ])
      if (guestUser) {
        await query('SELECT merge_guest_cart_to_user($1, $2)', [guestUser.id, user.id]).catch(() => {})
      }
    }

    const signals = extractSessionSignals(request)
    const referralCode = readReferralCookie(request)
    if (referralCode) {
      await attributeReferral({ newUserId: user.id, code: referralCode, fpHash: signals.fpHash })
      clearReferralCookie(cookieStore)
    }

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

    const cookieOpts = {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax' as const,
      maxAge: USER_SESSION_TTL_S,
      path: '/',
      ...cookieDomainOption(),
    }
    cookieStore.set('user_sid', sid, cookieOpts)
    cookieStore.set('session_id', user.id, cookieOpts)

    return NextResponse.json({
      message: 'Account created successfully',
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        phone: user.phone,
        phoneVerified: user.phone_verified ?? false,
        dateOfBirth: formatDob(user.date_of_birth),
      },
    })
  } catch (err: any) {
    return NextResponse.json({ error: 'Failed to create account', detail: err?.message }, { status: 500 })
  }
}
