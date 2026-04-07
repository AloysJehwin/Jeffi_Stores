import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { verifyToken } from './lib/jwt'
import { getScopeForPath, hasScope } from './lib/scopes'

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

  // Admin API path authentication and scope check
  if (isAdminApiPath) {
    const token = request.cookies.get('admin_token')?.value
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const payload = await verifyToken(token)
    if (!payload) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
    }

    // Check scope for API routes
    const requiredScope = getScopeForPath(pathname)
    if (requiredScope && !hasScope(payload.role, payload.scopes || [], requiredScope)) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    return NextResponse.next()
  }

  // Admin path authentication check
  if (isAdminPath) {
    // For admin routes, check for client certificate
    const clientCert = request.headers.get('x-client-cert')
    const certVerified = request.headers.get('x-client-cert-verified')
    const hasValidCert = clientCert && certVerified === 'SUCCESS'

    // In development (localhost) or Docker internal, skip certificate requirement
    const isLocalhost = hostname === 'localhost' || hostname.startsWith('localhost:') ||
                       hostname === '127.0.0.1' || hostname.startsWith('127.0.0.1:') ||
                       hostname.startsWith('app:') // Docker internal service name

    // Require certificate for all admin routes including login (except in development)
    if (!hasValidCert && !isLocalhost) {
      console.log('🔒 No valid client certificate, blocking admin access')
      return new NextResponse('Client certificate required for admin access', {
        status: 403,
        headers: {
          'Content-Type': 'text/plain',
        },
      })
    }

    // Allow login page without JWT check (cert is already verified above)
    if (pathname === '/admin/login') {
      const response = NextResponse.next()
      response.headers.set('x-pathname', pathname)
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

    // Token is valid, check scope-based access
    const requiredScope = getScopeForPath(pathname)
    if (requiredScope && !hasScope(payload.role, payload.scopes || [], requiredScope)) {
      console.log('🚫 Insufficient scope:', payload.username, 'needs', requiredScope, 'has', payload.scopes)
      return new NextResponse('Insufficient permissions', {
        status: 403,
        headers: { 'Content-Type': 'text/plain' },
      })
    }

    // Token is valid and scope check passed, allow access
    console.log('✅ Valid JWT token, allowing access to', pathname, 'for user:', payload.username)
    const response = NextResponse.next()
    response.headers.set('x-pathname', pathname)
    response.headers.set('x-user-id', payload.adminId)
    response.headers.set('x-username', payload.username)
    response.headers.set('x-user-role', payload.role)
    response.headers.set('x-user-scopes', JSON.stringify(payload.scopes || []))
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
