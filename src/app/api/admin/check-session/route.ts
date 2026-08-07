import { NextResponse } from 'next/server'
import { NextRequest } from 'next/server'
import { cookies } from 'next/headers'
import { getAdminSession } from '@/lib/admin-auth'

export async function GET(request: NextRequest) {
  try {
    const cookieStore = await cookies()
    const token = cookieStore.get('admin_token')

    const hostname = request.nextUrl.hostname || request.headers.get('host') || ''
    const isAdminSubdomain = hostname.startsWith('admin.')
    const isLocalhost = hostname === 'localhost' || hostname.startsWith('localhost:')
    const certStatus = isAdminSubdomain ? 'valid' : (isLocalhost ? 'development' : 'missing')

    if (!token) {
      const res = NextResponse.json({ authenticated: false, expiresAt: null })
      res.headers.set('x-cert-status', certStatus)
      return res
    }

    // Session-aware: verifies signature AND the server-side session (revoked/idle/expiry),
    // so a revoked admin is reported as not authenticated.
    const payload = await getAdminSession()

    if (!payload) {
      const res = NextResponse.json({ authenticated: false, expiresAt: null })
      res.headers.set('x-cert-status', certStatus)
      return res
    }

    // exp is seconds since epoch (JWT standard)
    const expiresAt = typeof payload.exp === 'number' ? payload.exp * 1000 : null
    const res = NextResponse.json({ authenticated: true, expiresAt, user: payload })
    res.headers.set('x-cert-status', certStatus)
    return res
  } catch (error) {
    return NextResponse.json({ authenticated: false, expiresAt: null })
  }
}

