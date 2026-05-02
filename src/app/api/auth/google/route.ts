import { NextRequest, NextResponse } from 'next/server'
import { SignJWT } from 'jose'
import { queryOne, query } from '@/lib/db'

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'your-secret-key-change-in-production'
)

interface GoogleTokenPayload {
  sub: string
  email: string
  given_name?: string
  family_name?: string
  name?: string
}

async function verifyGoogleToken(idToken: string): Promise<GoogleTokenPayload | null> {
  try {
    const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${idToken}`)
    if (!res.ok) return null
    const data = await res.json()
    if (!data.sub || !data.email) return null
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

    let user = await queryOne('SELECT * FROM users WHERE email = $1', [email])

    if (!user) {
      const firstName = payload.given_name || payload.name?.split(' ')[0] || ''
      const lastName = payload.family_name || payload.name?.split(' ').slice(1).join(' ') || ''
      user = await queryOne(
        `INSERT INTO users (email, first_name, last_name, is_active, auth_provider, session_id)
         VALUES ($1, $2, $3, true, 'google', gen_random_uuid()::text)
         RETURNING *`,
        [email, firstName, lastName]
      )
    }

    if (!user?.is_active) {
      return NextResponse.json({ error: 'Account is inactive' }, { status: 403 })
    }

    await query('UPDATE users SET last_login = NOW() WHERE id = $1', [user.id])

    const token = await new SignJWT({ userId: user.id, email: user.email })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('30d')
      .sign(JWT_SECRET)

    return NextResponse.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        phone: user.phone,
      },
    })
  } catch {
    return NextResponse.json({ error: 'Authentication failed' }, { status: 500 })
  }
}
