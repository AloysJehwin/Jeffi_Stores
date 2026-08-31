import { NextResponse } from 'next/server'
import { NextRequest } from 'next/server'
import { resolveSession } from '@/lib/auth-sessions'
import { readAdminSid } from '@/lib/admin-cookie'
import { extractSessionSignals } from '@/lib/session-signals-request'

export async function GET(request: NextRequest) {
  try {
    const token = await readAdminSid()

    const hostname = request.nextUrl.hostname || request.headers.get('host') || ''
    const isLocalhost = hostname === 'localhost' || hostname.startsWith('localhost:')
    // Set only after the certificate actually verified — by nginx on the platform admin
    // block, by middleware against the tenant's own CA on admin-{slug}.
    const certVerified = !!(request.headers.get('x-client-cert-cn') || request.headers.get('x-client-cert-serial'))
    const certStatus = certVerified ? 'valid' : (isLocalhost ? 'development' : 'missing')

    if (!token) {
      const res = NextResponse.json({ authenticated: false, expiresAt: null, certStatus })
      res.headers.set('x-cert-status', certStatus)
      return res
    }

    // Opaque session: resolve the cookie's sid → live admin session (revoked/idle/expiry).
    // Pass the request UA so a cookie replayed from a different browser is revoked here too
    // (the 15s poll doubles as a device-binding tripwire). expiresAt comes from the row.
    const s = await resolveSession(token, extractSessionSignals(request))

    if (!s || s.principalType !== 'admin') {
      const res = NextResponse.json({ authenticated: false, expiresAt: null, certStatus })
      res.headers.set('x-cert-status', certStatus)
      return res
    }

    const expiresAt = new Date(s.expiresAt).getTime()
    const res = NextResponse.json({
      authenticated: true,
      expiresAt,
      certStatus,
      user: { adminId: s.principalId, email: s.email, role: s.role, scopes: s.scopes },
    })
    res.headers.set('x-cert-status', certStatus)
    return res
  } catch (error) {
    return NextResponse.json({ authenticated: false, expiresAt: null })
  }
}

