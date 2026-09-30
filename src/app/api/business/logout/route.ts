import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { authenticateBusiness } from '@/lib/auth/jwt'
import { revokeSession } from '@/lib/auth/auth-sessions'
import { logActivity } from '@/lib/shared/activity'
import { cookieDomainOption } from '@/lib/auth/cookie-domain'

export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateBusiness(request)
    if (auth?.userId) {
      logActivity({ userId: auth.userId, kind: 'logout', summary: 'Business user logged out' }).catch(() => {})
    }
    if (auth?.sid) await revokeSession(auth.sid)

    const cookieStore = await cookies()
    const baseOpts = {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax' as const,
      maxAge: 0,
      path: '/',
    }
    cookieStore.set('business_sid', '', baseOpts)
    cookieStore.set('business_sid', '', { ...baseOpts, ...cookieDomainOption() })
    cookieStore.set('session_id', '', baseOpts)
    cookieStore.set('session_id', '', { ...baseOpts, ...cookieDomainOption() })

    const res = NextResponse.json({ message: 'Logged out successfully' })
    const flags = `Path=/; Max-Age=0; HttpOnly; SameSite=Lax${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`
    res.headers.append('Set-Cookie', `business_sid=; ${flags}`)
    if (process.env.NODE_ENV === 'production') {
      res.headers.append('Set-Cookie', `business_sid=; Domain=.jeffistores.in; ${flags}`)
    }
    return res
  } catch (err) {
    console.error('[route]', err)
    return NextResponse.json({ error: 'Logout failed' }, { status: 500 })
  }
}
