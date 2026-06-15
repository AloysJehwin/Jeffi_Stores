import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { authenticateBusiness } from '@/lib/jwt'
import { logActivity } from '@/lib/activity'
import { cookieDomainOption } from '@/lib/cookie-domain'

export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateBusiness(request)
    if (auth?.userId) {
      logActivity({ userId: auth.userId, kind: 'logout', summary: 'Business user logged out' }).catch(() => {})
    }

    const cookieStore = await cookies()
    const baseOpts = {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax' as const,
      maxAge: 0,
      path: '/',
    }
    cookieStore.set('business_auth_token', '', baseOpts)
    cookieStore.set('business_auth_token', '', { ...baseOpts, ...cookieDomainOption() })
    cookieStore.set('session_id', '', baseOpts)
    cookieStore.set('session_id', '', { ...baseOpts, ...cookieDomainOption() })

    const res = NextResponse.json({ message: 'Logged out successfully' })
    const flags = `Path=/; Max-Age=0; HttpOnly; SameSite=Lax${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`
    res.headers.append('Set-Cookie', `business_auth_token=; ${flags}`)
    if (process.env.NODE_ENV === 'production') {
      res.headers.append('Set-Cookie', `business_auth_token=; Domain=.jeffistores.in; ${flags}`)
    }
    return res
  } catch {
    return NextResponse.json({ error: 'Logout failed' }, { status: 500 })
  }
}
