import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { verifyToken } from './lib/jwt'
import { getScopeForPath, hasScope } from './lib/scopes'
import { applyRateLimit } from './lib/rate-limit'

const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-XSS-Protection': '1; mode=block',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
}

function addSecurityHeaders(response: NextResponse): NextResponse {
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    response.headers.set(key, value)
  }
  return response
}

export async function middleware(request: NextRequest) {
  const hostname = request.headers.get('host') || ''
  const pathname = request.nextUrl.pathname

  const isAdminApiPath = pathname.startsWith('/api/admin')
  const isAdminSubdomain = hostname.startsWith('admin.')
  const isAdminPath = pathname.startsWith('/admin')

  if (!isAdminApiPath && pathname.startsWith('/api/')) {
    const limited = await applyRateLimit(request)
    if (limited) return limited
  }

  if (hostname.startsWith('forms.')) {
    if (pathname.startsWith('/api/')) {
      return addSecurityHeaders(NextResponse.next())
    }
    const slug = pathname === '/' ? '' : pathname
    return NextResponse.rewrite(new URL(`/forms${slug}`, request.url))
  }

  if (hostname.startsWith('quotation.')) {
    if (pathname.startsWith('/api/')) return addSecurityHeaders(NextResponse.next())
    const slug = pathname === '/' ? '' : pathname
    return NextResponse.rewrite(new URL(`/quotation${slug}`, request.url))
  }

  if (hostname.startsWith('invoice.')) {
    if (pathname.startsWith('/api/')) return addSecurityHeaders(NextResponse.next())
    const slug = pathname === '/' ? '' : pathname
    return NextResponse.rewrite(new URL(`/invoice${slug}`, request.url))
  }

  if (hostname.startsWith('purchaseorder.')) {
    if (pathname.startsWith('/api/')) return addSecurityHeaders(NextResponse.next())
    const slug = pathname === '/' ? '' : pathname
    return NextResponse.rewrite(new URL(`/purchaseorder${slug}`, request.url))
  }

  if (hostname.startsWith('business.')) {
    if (pathname.startsWith('/api/')) return addSecurityHeaders(NextResponse.next())
    // Public pages on the subdomain (paths are /signin, /signup, /pending — no /business/ prefix)
    const PUBLIC_BUSINESS_SUBDOMAIN = ['/signin', '/signup', '/pending']
    const isPublicSubdomain = PUBLIC_BUSINESS_SUBDOMAIN.some(p => pathname.startsWith(p))
    if (!isPublicSubdomain) {
      const token = request.cookies.get('business_auth_token')?.value
      if (!token) {
        return NextResponse.redirect(new URL('/signin', request.url))
      }
      const payload = await verifyToken(token)
      if (!payload || !payload.isBusiness) {
        const res = NextResponse.redirect(new URL('/signin', request.url))
        res.cookies.delete('business_auth_token')
        return res
      }
      if (payload.approvalStatus === 'pending') {
        return NextResponse.redirect(new URL('/pending', request.url))
      }
      if (payload.approvalStatus === 'rejected') {
        return NextResponse.redirect(new URL('/signin?rejected=1', request.url))
      }
    }
    const slug = pathname === '/' ? '' : pathname
    return addSecurityHeaders(NextResponse.rewrite(new URL(`/business${slug}`, request.url)))
  }

  // Business portal auth — applies to /business/* paths (not subdomain, not API, not public pages)
  if (pathname.startsWith('/business/')) {
    const PUBLIC_BUSINESS = ['/business/signin', '/business/signup', '/business/pending']
    const isPublic = PUBLIC_BUSINESS.some(p => pathname.startsWith(p))
    if (!isPublic) {
      const token = request.cookies.get('business_auth_token')?.value
      if (!token) {
        return NextResponse.redirect(new URL('/business/signin', request.url))
      }
      const payload = await verifyToken(token)
      if (!payload || !payload.isBusiness) {
        const res = NextResponse.redirect(new URL('/business/signin', request.url))
        res.cookies.delete('business_auth_token')
        return res
      }
      if (payload.approvalStatus === 'pending') {
        return NextResponse.redirect(new URL('/business/pending', request.url))
      }
      if (payload.approvalStatus === 'rejected') {
        return NextResponse.redirect(new URL('/business/signin?rejected=1', request.url))
      }
    }
  }

  if (pathname.startsWith('/forms/')) {
    const slug = pathname.replace('/forms/', '')
    return NextResponse.redirect(new URL(`https://forms.jeffistores.in/${slug}`, request.url), 301)
  }

  const publicApiPaths = [
    '/api/admin/login',
    '/api/admin/check-session',
    '/api/admin/delhivery/sync-statuses',
    '/api/admin/mfa/enroll-start',
    '/api/admin/mfa/enroll-confirm',
    '/api/admin/mfa/verify',
  ]
  if (isAdminApiPath && publicApiPaths.some(path => pathname.startsWith(path))) {
    return addSecurityHeaders(NextResponse.next())
  }

  if (isAdminSubdomain && !isAdminPath && !isAdminApiPath) {
    if (pathname.startsWith('/api/')) {
      return addSecurityHeaders(NextResponse.next())
    }
    return NextResponse.redirect(new URL('/admin/dashboard', request.url))
  }

  if (isAdminApiPath) {
    const token = request.cookies.get('admin_token')?.value
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const payload = await verifyToken(token)
    if (!payload) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
    }

    const certCN = request.headers.get('x-client-cert-cn') || ''
    const tokenCertCN = payload.authCertCN || payload.username
    if (certCN && !certCN.includes(' ') && tokenCertCN !== certCN) {
      return NextResponse.json(
        { error: 'Certificate does not match authenticated user' },
        { status: 403 }
      )
    }

    const requiredScope = getScopeForPath(pathname)
    if (requiredScope && !hasScope(payload.role, payload.scopes || [], requiredScope)) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    return addSecurityHeaders(NextResponse.next())
  }

  if (isAdminPath) {
    const isLocalhost = hostname === 'localhost' || hostname.startsWith('localhost:') ||
                       hostname === '127.0.0.1' || hostname.startsWith('127.0.0.1:') ||
                       hostname.startsWith('app:') ||
                       hostname.startsWith('192.168.') || hostname.startsWith('10.') ||
                       hostname.endsWith('.ngrok-free.app') || hostname.endsWith('.ngrok-free.dev')

    if (pathname === '/admin/login') {
      const response = NextResponse.next()
      response.headers.set('x-pathname', pathname)
      return addSecurityHeaders(response)
    }

    if (!isAdminSubdomain && !isLocalhost) {
      return new NextResponse('Admin access requires the admin subdomain', {
        status: 403,
        headers: { 'Content-Type': 'text/plain' },
      })
    }

    const token = request.cookies.get('admin_token')?.value

    if (!token) {
      const loginUrl = new URL('/admin/login', request.url)
      loginUrl.searchParams.set('callbackUrl', pathname)
      return NextResponse.redirect(loginUrl)
    }

    const payload = await verifyToken(token)

    if (!payload) {
      const loginUrl = new URL('/admin/login', request.url)
      loginUrl.searchParams.set('callbackUrl', pathname)
      const response = NextResponse.redirect(loginUrl)
      response.cookies.delete('admin_token')
      return response
    }

    const certCN = request.headers.get('x-client-cert-cn') || ''
    const tokenCertCN = payload.authCertCN || payload.username
    if (certCN && !certCN.includes(' ') && tokenCertCN !== certCN) {
      const loginUrl = new URL('/admin/login', request.url)
      loginUrl.searchParams.set('callbackUrl', pathname)
      const response = NextResponse.redirect(loginUrl)
      response.cookies.delete('admin_token')
      return response
    }

    const requiredScope = getScopeForPath(pathname)
    if (requiredScope && !hasScope(payload.role, payload.scopes || [], requiredScope)) {
      return new NextResponse('Insufficient permissions', {
        status: 403,
        headers: { 'Content-Type': 'text/plain' },
      })
    }

    const response = NextResponse.next()
    response.headers.set('x-pathname', pathname)
    response.headers.set('x-user-id', payload.adminId)
    response.headers.set('x-username', payload.username)
    response.headers.set('x-user-role', payload.role)
    response.headers.set('x-user-scopes', JSON.stringify(payload.scopes || []))
    return addSecurityHeaders(response)
  }

  return addSecurityHeaders(NextResponse.next())
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|images|icon.png|apple-icon.png).*)',
  ],
}
