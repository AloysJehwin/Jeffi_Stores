import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { verifyToken } from './lib/jwt'

export async function middleware(request: NextRequest) {
  const hostname = request.headers.get('host') || ''
  const pathname = request.nextUrl.pathname
  const isAdminSubdomain = hostname.startsWith('admin.')
  const isAdminPath = pathname.startsWith('/admin')
  const isAdminApiPath = pathname.startsWith('/api/admin')

  // Allow public admin API routes without authentication
  const publicApiPaths = ['/api/admin/login', '/api/admin/check-session']
  if (isAdminApiPath && publicApiPaths.some(path => pathname.startsWith(path))) {
    return NextResponse.next()
  }

  // Admin subdomain handling
  if (isAdminSubdomain) {
    // Check for client certificate (mTLS)
    const clientCert = request.headers.get('x-client-cert')
    const certVerified = request.headers.get('x-client-cert-verified')

    // Check certificate in both dev and production
    // In development, you need to run HTTPS server with client cert verification
    // In production with proper proxy/CDN, these headers will be set
    if (!clientCert || certVerified !== 'SUCCESS') {
      return new NextResponse('Client certificate required', {
        status: 403,
        headers: {
          'Content-Type': 'text/plain',
        },
      })
    }

    // Rewrite to admin app
    const url = request.nextUrl.clone()
    url.pathname = `/admin${url.pathname}`
    return NextResponse.rewrite(url)
  }

  // Admin path authentication check
  if (isAdminPath) {
    // First, check for client certificate on ALL admin routes
    const clientCert = request.headers.get('x-client-cert')
    const certVerified = request.headers.get('x-client-cert-verified')
    const hasValidCert = clientCert && certVerified === 'SUCCESS'

    // Require certificate for all admin routes
    if (!hasValidCert) {
      console.log('🔒 No valid client certificate, blocking admin access')
      return new NextResponse('Client certificate required for admin access', {
        status: 403,
        headers: {
          'Content-Type': 'text/plain',
        },
      })
    }

    // Certificate is valid, allow access to login page without JWT
    if (pathname === '/admin/login') {
      console.log('⚠️  Login page with valid certificate, allowing access')
      const response = NextResponse.next()
      response.headers.set('x-pathname', pathname)
      response.headers.set('x-cert-status', 'valid')
      return response
    }

    // Check for valid JWT token in cookie
    const token = request.cookies.get('admin_token')?.value

    if (!token) {
      console.log('🔒 No JWT token found, redirecting to login')
      return NextResponse.redirect(new URL('/admin/login', request.url))
    }

    console.log('🔍 Found JWT token, verifying...')

    // Verify JWT token
    const payload = await verifyToken(token)

    if (!payload) {
      console.log('🔒 Invalid JWT token, redirecting to login')
      const response = NextResponse.redirect(new URL('/admin/login', request.url))
      response.cookies.delete('admin_token')
      return response
    }

    // Token is valid, allow access
    console.log('✅ Valid JWT token, allowing access to', pathname, 'for user:', payload.username)
    const response = NextResponse.next()
    response.headers.set('x-pathname', pathname)
    response.headers.set('x-user-id', payload.adminId)
    response.headers.set('x-username', payload.username)
    response.headers.set('x-user-role', payload.role)
    return response
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    // Only run middleware on admin routes and admin API routes
    '/admin/:path*',
    '/api/admin/:path*',
  ],
}
