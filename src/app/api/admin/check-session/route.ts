import { NextResponse } from 'next/server'
import { NextRequest } from 'next/server'
import { cookies } from 'next/headers'
import { verifyToken } from '@/lib/jwt'

export async function GET(request: NextRequest) {
  try {
    const cookieStore = cookies()
    const token = cookieStore.get('admin_token')

    const hostname = request.headers.get('host') || ''
    const isAdminSubdomain = hostname.startsWith('admin.')
    const isLocalhost = hostname === 'localhost' || hostname.startsWith('localhost:')
    const certStatus = isAdminSubdomain ? 'valid' : (isLocalhost ? 'development' : 'missing')

    if (!token) {
      const res = NextResponse.json({ authenticated: false })
      res.headers.set('x-cert-status', certStatus)
      return res
    }

    const payload = await verifyToken(token.value)

    if (!payload) {
      const res = NextResponse.json({ authenticated: false })
      res.headers.set('x-cert-status', certStatus)
      return res
    }

    const res = NextResponse.json({ authenticated: true, user: payload })
    res.headers.set('x-cert-status', certStatus)
    return res
  } catch (error) {
    return NextResponse.json({ authenticated: false })
  }
}
