import { NextRequest, NextResponse } from 'next/server'
import { SignJWT } from 'jose'
import { queryOne, query } from '@/lib/db'
import { cookies } from 'next/headers'

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'your-secret-key-change-in-production'
)

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
  } catch {
    return null
  }
}

export async function POST(request: NextRequest) {
  try {
    const { idToken } = await request.json()
    if (!idToken) return NextResponse.json({ error: 'idToken required' }, { status: 400 })

    const payload = await verifyGoogleToken(idToken)
    if (!payload) return NextResponse.json({ error: 'Invalid Google token' }, { status: 401 })

    const email = payload.email.toLowerCase()
    const googleId = payload.sub
    const firstName = payload.given_name || payload.name?.split(' ')[0] || ''
    const lastName = payload.family_name || payload.name?.split(' ').slice(1).join(' ') || ''

    let user = await queryOne<any>(
      'SELECT * FROM users WHERE google_id = $1 OR email = $2 LIMIT 1',
      [googleId, email]
    )

    if (!user) {
      user = await queryOne<any>(
        `INSERT INTO users (email, first_name, last_name, is_active, auth_provider, google_id, last_login)
         VALUES ($1, $2, $3, true, 'google', $4, NOW())
         RETURNING *`,
        [email, firstName, lastName, googleId]
      )
    } else {
      if (!user.google_id) {
        await query('UPDATE users SET google_id = $1, auth_provider = $2 WHERE id = $3', [googleId, 'google', user.id])
      }
      if (!user.is_active) {
        return NextResponse.json({ error: 'Account is inactive' }, { status: 403 })
      }
      await query('UPDATE users SET last_login = NOW() WHERE id = $1', [user.id])
    }

    if (!user) return NextResponse.json({ error: 'Failed to create account' }, { status: 500 })

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

    const token = await new SignJWT({ userId: user.id, email: user.email })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('30d')
      .sign(JWT_SECRET)

    cookieStore.set('auth_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60,
      path: '/',
    })

    cookieStore.set('session_id', user.id, {
      maxAge: 30 * 24 * 60 * 60,
      path: '/',
    })

    return NextResponse.json({
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        phone: user.phone,
      },
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Authentication failed' }, { status: 500 })
  }
}
