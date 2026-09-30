import { NextRequest, NextResponse } from 'next/server'
import { issueUserToken, USER_SESSION_TTL_S } from '@/lib/issue-session'
import { extractSessionSignals } from '@/lib/session-signals-request'
import { queryOne, query } from '@/lib/db'
import { cookies } from 'next/headers'
import { logActivity } from '@/lib/activity'
import { cookieDomainOption } from '@/lib/cookie-domain'

if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET environment variable is not set')
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || ''

interface GoogleTokenPayload {
  sub: string
  email: string
  given_name?: string
  family_name?: string
  name?: string
  picture?: string
  aud?: string | string[]
}

async function verifyGoogleToken(idToken: string): Promise<GoogleTokenPayload | null> {
  try {
    const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${idToken}`)
    if (!res.ok) return null
    const data = await res.json()
    if (!data.sub || !data.email) return null
    if (GOOGLE_CLIENT_ID) {
      const aud = Array.isArray(data.aud) ? data.aud : [data.aud]
      if (!aud.includes(GOOGLE_CLIENT_ID)) return null
    }
    return data as GoogleTokenPayload
  } catch (err) {
    console.error('[route]', err)
    return null
  }
}

async function verifyGoogleAccessToken(accessToken: string): Promise<GoogleTokenPayload | null> {
  try {
    const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!res.ok) return null
    const data = await res.json()
    if (!data.sub || !data.email || data.email_verified === false) return null
    return {
      sub: data.sub,
      email: data.email,
      given_name: data.given_name,
      family_name: data.family_name,
      name: data.name,
      picture: data.picture,
    }
  } catch (err) {
    console.error('[route]', err)
    return null
  }
}

export async function POST(request: NextRequest) {
  try {
    const { idToken, accessToken, companyName, gstNumber, businessAddress, industry } = await request.json()
    if (!idToken && !accessToken)
      return NextResponse.json({ error: 'idToken or accessToken required' }, { status: 400 })

    const googlePayload = idToken ? await verifyGoogleToken(idToken) : await verifyGoogleAccessToken(accessToken)
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
      // New business Google sign-in: if business profile fields not provided, ask frontend to collect them
      if (!companyName || !gstNumber || !businessAddress || !industry) {
        return NextResponse.json({ needsBusinessProfile: true, email, firstName, lastName })
      }

      user = await queryOne<any>(
        `INSERT INTO users (email, first_name, last_name, is_active, auth_provider, google_id, user_type, last_login)
         VALUES ($1, $2, $3, true, 'google', $4, 'business', NOW())
         RETURNING *`,
        [email, firstName, lastName, googleId]
      )
      if (!user) return NextResponse.json({ error: 'Failed to create account' }, { status: 500 })

      await query(
        `INSERT INTO business_profiles (user_id, company_name, gst_number, business_address, industry) VALUES ($1, $2, $3, $4, $5)`,
        [user.id, companyName.trim(), gstNumber.trim().toUpperCase(), businessAddress.trim(), industry.trim()]
      )
      logActivity({
        userId: user.id,
        kind: 'signup',
        summary: 'Business account created via Google',
        metadata: { provider: 'google' },
      }).catch(() => {})
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
      sameSite: 'strict' as const,
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
