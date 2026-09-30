import { NextResponse } from 'next/server'
import { NextRequest } from 'next/server'
import { resolveSession } from '@/lib/auth-sessions'
import { readAdminSid } from '@/lib/admin-cookie'
import { extractSessionSignals } from '@/lib/session-signals-request'

// Passive: a tab asking "am I still signed in, and until when?" is not the admin being active,
// so this never touches last_seen_at. deadlineAt is the idle-or-absolute deadline the server
// will enforce; expiresAt the absolute cap.
export async function GET(request: NextRequest) {
  try {
    const token = await readAdminSid()

    const hostname = request.nextUrl.hostname || request.headers.get('host') || ''
    const isLocalhost = hostname === 'localhost' || hostname.startsWith('localhost:')
    const certVerified = !!(request.headers.get('x-client-cert-cn') || request.headers.get('x-client-cert-serial'))
    const certStatus = certVerified ? 'valid' : isLocalhost ? 'development' : 'missing'

    const deny = () => {
      const res = NextResponse.json({
        authenticated: false,
        expiresAt: null,
        deadlineAt: null,
        serverNow: Date.now(),
        certStatus,
      })
      res.headers.set('x-cert-status', certStatus)
      return res
    }
    if (!token) return deny()

    const s = await resolveSession(token, extractSessionSignals(request), { touch: false })
    if (!s || s.principalType !== 'admin') return deny()

    const expiresAt = new Date(s.expiresAt).getTime()
    const deadlineAt = s.deadlineAt ? new Date(s.deadlineAt).getTime() : expiresAt
    const res = NextResponse.json({
      authenticated: true,
      expiresAt,
      deadlineAt,
      serverNow: Date.now(),
      sessionId: s.sessionId ?? null,
      certStatus,
      user: { adminId: s.principalId, email: s.email, role: s.role, scopes: s.scopes },
    })
    res.headers.set('x-cert-status', certStatus)
    return res
  } catch {
    return NextResponse.json({ authenticated: false, expiresAt: null, deadlineAt: null, serverNow: Date.now() })
  }
}
