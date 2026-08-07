import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifyToken } from '@/lib/jwt'
import { revokeSession } from '@/lib/auth-sessions'
import { cookieDomainOption } from '@/lib/cookie-domain'

export async function POST() {
  try {
    const cookieStore = await cookies()

    // Revoke the server-side session before clearing the cookie.
    const existing = cookieStore.get('admin_token')?.value
    if (existing) {
      try {
        const payload = await verifyToken(existing)
        const sid = (payload as any)?.sid
        if (typeof sid === 'string' && sid) await revokeSession(sid)
      } catch { /* best-effort revoke */ }
    }

    const baseOpts = {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax' as const,
      maxAge: 0,
      path: '/',
    }
    cookieStore.set('admin_token', '', baseOpts)
    cookieStore.set('admin_token', '', { ...baseOpts, ...cookieDomainOption() })

    const res = NextResponse.json({ message: 'Logged out' })
    const flags = `Path=/; Max-Age=0; HttpOnly; SameSite=Lax${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`
    res.headers.append('Set-Cookie', `admin_token=; ${flags}`)
    if (process.env.NODE_ENV === 'production') {
      res.headers.append('Set-Cookie', `admin_token=; Domain=.jeffistores.in; ${flags}`)
    }
    return res
  } catch (err) {
    console.error('[route]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
