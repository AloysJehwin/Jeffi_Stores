import { NextRequest, NextResponse } from 'next/server'
import { issueUserToken, USER_SESSION_TTL_S } from '@/lib/issue-session'
import { extractSessionSignals } from '@/lib/session-signals-request'
import { queryOne, query } from '@/lib/db'
import { cookies } from 'next/headers'
import { logActivity } from '@/lib/activity'
import { uploadAvatarImage } from '@/lib/s3'
import { cookieDomainOption } from '@/lib/cookie-domain'

if (!process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is not set')
}

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
    const { idToken, accessToken } = await request.json()
    if (!idToken && !accessToken) {
      return NextResponse.json({ error: 'idToken or accessToken required' }, { status: 400 })
    }

    const payload = idToken
      ? await verifyGoogleToken(idToken)
      : await verifyGoogleAccessToken(accessToken)
    if (!payload) return NextResponse.json({ error: 'Invalid Google token' }, { status: 401 })

    const email = payload.email.toLowerCase()
    const googleId = payload.sub
    const firstName = payload.given_name || payload.name?.split(' ')[0] || ''
    const lastName = payload.family_name || payload.name?.split(' ').slice(1).join(' ') || ''

    let user = await queryOne<any>(
      "SELECT * FROM users WHERE (google_id = $1 OR email = $2) AND user_type != 'business' LIMIT 1",
      [googleId, email]
    )

    // If no customer account found, check if a business account exists with this email/google_id.
    // A business user logging in via the customer portal should use their existing account rather
    // than spawning a duplicate customer row.
    if (!user) {
      const bizUser = await queryOne<any>(
        "SELECT * FROM users WHERE (google_id = $1 OR email = $2) AND user_type = 'business' LIMIT 1",
        [googleId, email]
      )
      if (bizUser) {
        // Link google_id if not already set and log them in as their business account.
        if (!bizUser.google_id) {
          await query('UPDATE users SET google_id = $1, auth_provider = $2 WHERE id = $3', [googleId, 'google', bizUser.id])
        }
        await query('UPDATE users SET last_login = NOW() WHERE id = $1', [bizUser.id])
        logActivity({ userId: bizUser.id, kind: 'login', summary: 'Logged in via Google', metadata: { provider: 'google' } }).catch(() => {})
        user = { ...bizUser, google_id: bizUser.google_id || googleId }
      }
    }

    if (!user) {
      user = await queryOne<any>(
        `INSERT INTO users (email, first_name, last_name, is_active, auth_provider, google_id, last_login)
         VALUES ($1, $2, $3, true, 'google', $4, NOW())
         RETURNING *`,
        [email, firstName, lastName, googleId]
      )
      if (user) {
        logActivity({ userId: user.id, kind: 'signup', summary: 'Signed up via Google', metadata: { provider: 'google' } }).catch(() => {})
      }
    } else {
      if (!user.google_id) {
        await query('UPDATE users SET google_id = $1, auth_provider = $2 WHERE id = $3', [googleId, 'google', user.id])
      }
      if (!user.is_active) {
        return NextResponse.json({ error: 'Account is inactive' }, { status: 403 })
      }
      await query('UPDATE users SET last_login = NOW() WHERE id = $1', [user.id])
      logActivity({ userId: user.id, kind: 'login', summary: 'Logged in via Google', metadata: { provider: 'google' } }).catch(() => {})
    }

    if (!user) return NextResponse.json({ error: 'Failed to create account' }, { status: 500 })

    if (payload.picture) {
      try {
        const imgRes = await fetch(payload.picture)
        if (imgRes.ok) {
          const imgBuffer = Buffer.from(await imgRes.arrayBuffer())
          const { url, s3Key } = await uploadAvatarImage(imgBuffer, user.id)
          await query(
            'UPDATE users SET avatar_url = $1, avatar_s3_key = $2 WHERE id = $3 AND avatar_is_custom = false',
            [url, s3Key, user.id]
          )
        }
      } catch {}
    }

    const cookieStore = await cookies()
    const guestSessionId = cookieStore.get('session_id')?.value
    if (guestSessionId?.startsWith('guest_')) {
      const guestUser = await queryOne<any>(
        'SELECT id FROM users WHERE session_id = $1 AND is_guest = true',
        [guestSessionId]
      )
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

    cookieStore.set('user_sid', sid, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: USER_SESSION_TTL_S,
      path: '/',
      ...cookieDomainOption(),
    })

    cookieStore.set('session_id', user.id, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: USER_SESSION_TTL_S,
      path: '/',
      ...cookieDomainOption(),
    })

    return NextResponse.json({
      message: 'Login successful',
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        phone: user.phone,
      },
    })
  } catch (err: any) {
    return NextResponse.json({ error: 'Authentication failed', detail: err?.message }, { status: 500 })
  }
}
