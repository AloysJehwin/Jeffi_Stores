import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifyToken } from '@/lib/auth/jwt'
import { revokeSession, revokeAllForPrincipal } from '@/lib/auth/auth-sessions'
import { adminCookieName, adminCookieDomain } from '@/lib/auth/admin-cookie'

export async function POST() {
  try {
    const cookieStore = await cookies()

    // Revoke the server-side session before clearing the cookie.
    const name = await adminCookieName()
    const existing = cookieStore.get(name)?.value
    if (existing) {
      try {
        const payload = await verifyToken(existing)
        const adminId = (payload as any)?.adminId
        const sid = (payload as any)?.sid
        // An explicit logout ends this admin's sessions in every browser, not just this one.
        if (typeof adminId === 'string' && adminId) await revokeAllForPrincipal('admin', adminId)
        else if (typeof sid === 'string' && sid) await revokeSession(sid)
      } catch {
        /* best-effort revoke */
      }
    }

    const baseOpts = {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax' as const,
      maxAge: 0,
      path: '/',
    }
    cookieStore.set(name, '', baseOpts)
    cookieStore.set(name, '', { ...baseOpts, ...(await adminCookieDomain()) })

    const res = NextResponse.json({ message: 'Logged out' })
    const flags = `Path=/; Max-Age=0; HttpOnly; SameSite=Lax${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`
    res.headers.append('Set-Cookie', `${name}=; ${flags}`)
    const dom = (await adminCookieDomain()).domain
    if (dom) res.headers.append('Set-Cookie', `${name}=; Domain=${dom}; ${flags}`)
    return res
  } catch (err) {
    console.error('[route]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
