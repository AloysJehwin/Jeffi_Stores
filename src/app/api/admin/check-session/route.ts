import { NextResponse } from 'next/server'
import { NextRequest } from 'next/server'
import { cookies } from 'next/headers'
import { resolveSession } from '@/lib/auth-sessions'
import { extractSessionSignals } from '@/lib/session-signals-request'

export async function GET(request: NextRequest) {
  try {
    const cookieStore = await cookies()
    const token = cookieStore.get('admin_sid')

    const hostname = request.nextUrl.hostname || request.headers.get('host') || ''
    const isAdminSubdomain = hostname.startsWith('admin.')
    const isLocalhost = hostname === 'localhost' || hostname.startsWith('localhost:')
    const certStatus = isAdminSubdomain ? 'valid' : (isLocalhost ? 'development' : 'missing')

    if (!token) {
      const res = NextResponse.json({ authenticated: false, expiresAt: null })
      res.headers.set('x-cert-status', certStatus)
      return res
    }

    // Opaque session: resolve the cookie's sid → live admin session (revoked/idle/expiry).
    // Pass the request UA so a cookie replayed from a different browser is revoked here too
    // (the 15s poll doubles as a device-binding tripwire). expiresAt comes from the row.
    const s = await resolveSession(token.value, extractSessionSignals(request))

    if (!s || s.principalType !== 'admin') {
      const res = NextResponse.json({ authenticated: false, expiresAt: null })
      res.headers.set('x-cert-status', certStatus)
      return res
    }

    const expiresAt = new Date(s.expiresAt).getTime()
    const res = NextResponse.json({
      authenticated: true,
      expiresAt,
      user: { adminId: s.principalId, email: s.email, role: s.role, scopes: s.scopes },
    })
    res.headers.set('x-cert-status', certStatus)
    return res
  } catch (error) {
    return NextResponse.json({ authenticated: false, expiresAt: null })
  }
}

