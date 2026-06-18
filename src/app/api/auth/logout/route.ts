import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { authenticateUser } from '@/lib/jwt'
import { logActivity } from '@/lib/activity'
import { cookieDomainOption } from '@/lib/cookie-domain'

export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateUser(request)
    if (auth?.userId) {
      logActivity({ userId: auth.userId, kind: 'logout', summary: 'Logged out' }).catch(() => {})
    }

    const store = await cookies()
    const baseOpts = {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax' as const,
      maxAge: 0,
      path: '/',
    }
    store.set('auth_token', '', baseOpts)
    store.set('auth_token', '', { ...baseOpts, ...cookieDomainOption() })
    store.set('session_id', '', baseOpts)
    store.set('session_id', '', { ...baseOpts, ...cookieDomainOption() })

    const newGuestSessionId = `guest_${Date.now()}_${Math.random().toString(36).substring(7)}`
    store.set('session_id', newGuestSessionId, {
      maxAge: 30 * 24 * 60 * 60,
      path: '/',
      ...cookieDomainOption(),
    })

    const res = NextResponse.json({ message: 'Logged out successfully' })
    const flags = `Path=/; Max-Age=0; HttpOnly; SameSite=Lax${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`
    res.headers.append('Set-Cookie', `auth_token=; ${flags}`)
    if (process.env.NODE_ENV === 'production') {
      res.headers.append('Set-Cookie', `auth_token=; Domain=.jeffistores.in; ${flags}`)
    }
    return res
  } catch (err) {
    console.error('[route]', err)
    return NextResponse.json({ error: 'Logout failed' }, { status: 500 })
  }
}
