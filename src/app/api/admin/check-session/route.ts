import { NextResponse } from 'next/server'
import { NextRequest } from 'next/server'
import { cookies } from 'next/headers'
import { verifyToken } from '@/lib/jwt'

export async function GET(request: NextRequest) {
  try {
    const cookieStore = cookies()
    const token = cookieStore.get('admin_token')

    const clientCert = request.headers.get('x-client-cert')
    const certVerified = request.headers.get('x-client-cert-verified')
    const hasValidCert = clientCert && certVerified === 'SUCCESS'

    const certStatus = hasValidCert ? 'valid' : 'missing'

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
