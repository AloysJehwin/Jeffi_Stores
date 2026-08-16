import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { verifyToken, verifyBusinessToken } from './lib/jwt'
import { getScopeForPath, hasScope } from './lib/scopes'
import { applyRateLimit } from './lib/rate-limit'
import { extractSessionSignals } from './lib/session-signals-request'
import { resolveTenantFromHost } from './lib/tenant-registry'

// Node runtime: the auth cookie is now an opaque session id, so middleware must resolve
// it against Postgres (via verifyToken/verifyBusinessToken → resolveSession). Node
// middleware is stable in Next 15.5. pg is kept external via serverExternalPackages.
// Session lookups only run when an auth cookie is present, so anonymous storefront
// traffic does zero auth DB queries.
export const runtime = 'nodejs'

const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-XSS-Protection': '1; mode=block',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  // Opt in to the Sec-CH-UA-Platform client hint so browsers send it on subsequent requests —
  // it's a STABLE signal in the session device-binding scorer (auth-sessions.ts).
  'Accept-CH': 'Sec-CH-UA-Platform',
}

function addSecurityHeaders(response: NextResponse): NextResponse {
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    response.headers.set(key, value)
  }
  return response
}

// Build a redirect URL that ignores the internal Next listener port (3000).
// In prod the LB forwards to Next on :3000, so request.url carries that port
// and naive `new URL('/x', request.url)` would emit redirects to :3000.
function buildRedirectUrl(request: NextRequest, path: string): URL {
  const xfHost = request.headers.get('x-forwarded-host')
  const xfProto = request.headers.get('x-forwarded-proto')
  const rawHost = xfHost || request.headers.get('host') || request.nextUrl.host
  // Strip any :port suffix unless it's a well-known dev port (localhost only).
  const host = rawHost.replace(/:\d+$/, (m) => {
    return process.env.NODE_ENV === 'production' ? '' : m
  })
  const proto = xfProto || (process.env.NODE_ENV === 'production' ? 'https' : request.nextUrl.protocol.replace(':', ''))
  return new URL(path, `${proto}://${host}`)
}

function isMobileUA(ua: string | null): boolean {
  if (!ua) return false
  return /android|iphone|ipad|ipod|mobile|blackberry|iemobile|opera mini/i.test(ua)
}

function isAdminWritePath(pathname: string): boolean {
  return /\/admin\/(products|categories|brands|coupons|review-forms|suppliers|inventory\/po|mailer|campaigns|service-accounts|team)\/(add|new|edit(\/|$))/i.test(pathname)
}

// Strip /add, /new, or /edit/[...] suffix to derive the parent list URL.
function adminWritePathParent(pathname: string): string {
  return pathname.replace(/\/(add|new|edit(\/[^?]*)?)$/i, '')
}

export async function middleware(request: NextRequest) {
  const hostname = request.headers.get('x-forwarded-host') || request.headers.get('host') || request.nextUrl.hostname || ''
  const pathname = request.nextUrl.pathname
  // Per-request device-binding signals: resolveSession revokes + rejects a cookie replayed
  // from a clearly different environment (>= 2 STABLE signals differ — see evaluateBinding).
  const reqSignals = extractSessionSignals(request)

  if (hostname.startsWith('www.jeffistores.in')) {
    const target = new URL(pathname + request.nextUrl.search, 'https://jeffistores.in')
    const res = NextResponse.redirect(target, 307)
    res.headers.set('Cache-Control', 'no-store, must-revalidate')
    res.headers.set('Clear-Site-Data', '"cache"')
    return res
  }

  const isAdminApiPath = pathname.startsWith('/api/admin')
  const isAdminSubdomain = hostname.startsWith('admin.')
  const isAdminPath = pathname.startsWith('/admin')

  if (!isAdminApiPath && pathname.startsWith('/api/')) {
    const limited = await applyRateLimit(request)
    if (limited) return limited
  }

  // Strip any inbound x-user-* / x-service-account-* headers that clients could forge.
  // Middleware sets these itself below after verifying the token — they must not arrive untouched.
  const stripped = new Headers(request.headers)
  stripped.delete('x-user-id')
  stripped.delete('x-username')
  stripped.delete('x-user-role')
  stripped.delete('x-user-scopes')
  stripped.delete('x-service-account-id')
  stripped.delete('x-service-account-name')
  stripped.delete('x-service-account-scopes')
  // Tenant forwarding headers are also client-forgeable — strip before we (maybe) set them.
  stripped.delete('x-tenant-id')
  stripped.delete('x-tenant-slug')

  // Multi-tenant SaaS: resolve the tenant from the Host header (cached ~60s in-process).
  // Returns null for the platform's own hosts (jeffistores.in + app subdomains) and unknown
  // hosts → single-tenant behavior is unchanged. When a tenant IS resolved, forward it as
  // x-tenant-* so tenant-aware server code (getPool via TenantContext, S3, etc.) can scope.
  const tenant = await resolveTenantFromHost(hostname)
  if (tenant) {
    stripped.set('x-tenant-id', tenant.tenantId)
    stripped.set('x-tenant-slug', tenant.slug)
  }

  // Tenant isolation guard: a session is bound (snapshotted) to exactly one tenant.
  // If the host resolves to tenant A but the caller presents a session minted for
  // tenant B, reject it — a shared-cookie-domain replay across tenant subdomains
  // must not grant access. Only fires when BOTH sides are known (host tenant + a
  // session with a non-null tenant_id); null on either side = platform/legacy →
  // allowed (fail-open, no mass logout). This is the mismatch-rejection half of the
  // tenant_id session claim.
  if (tenant) {
    const anySid = request.cookies.get('admin_sid')?.value
      || request.cookies.get('user_sid')?.value
      || request.cookies.get('business_sid')?.value
    if (anySid) {
      const { resolveSession } = await import('./lib/auth-sessions')
      const sess = await resolveSession(anySid, reqSignals).catch(() => null)
      if (sess && sess.tenantId && sess.tenantId !== tenant.tenantId) {
        // Cross-tenant session replay — clear the offending cookies and send to login.
        const res = NextResponse.redirect(buildRedirectUrl(request, '/'))
        res.cookies.delete('admin_sid')
        res.cookies.delete('user_sid')
        res.cookies.delete('business_sid')
        return addSecurityHeaders(res)
      }
    }
  }

  if (hostname.startsWith('forms.')) {
    if (pathname.startsWith('/api/')) {
      return addSecurityHeaders(NextResponse.next())
    }
    const slug = pathname === '/' ? '' : pathname
    return NextResponse.rewrite(new URL(`/forms${slug}${request.nextUrl.search}`, request.url))
  }

  if (hostname.startsWith('quotation.')) {
    if (pathname.startsWith('/api/')) return addSecurityHeaders(NextResponse.next())
    const slug = pathname === '/' ? '' : pathname
    return NextResponse.rewrite(new URL(`/quotation${slug}${request.nextUrl.search}`, request.url))
  }

  if (hostname.startsWith('invoice.')) {
    if (pathname.startsWith('/api/')) return addSecurityHeaders(NextResponse.next())
    const slug = pathname === '/' ? '' : pathname
    return NextResponse.rewrite(new URL(`/invoice${slug}${request.nextUrl.search}`, request.url))
  }

  if (hostname.startsWith('purchaseorder.')) {
    if (pathname.startsWith('/api/')) return addSecurityHeaders(NextResponse.next())
    const slug = pathname === '/' ? '' : pathname
    return NextResponse.rewrite(new URL(`/purchaseorder${slug}${request.nextUrl.search}`, request.url))
  }

  if (hostname.startsWith('business.')) {
    if (pathname.startsWith('/api/')) return addSecurityHeaders(NextResponse.next())
    // Public pages on the subdomain (paths are /signin, /signup, /pending — no /business/ prefix)
    const PUBLIC_BUSINESS_SUBDOMAIN = ['/signin', '/signup', '/pending']
    const isPublicSubdomain = pathname === '/' || PUBLIC_BUSINESS_SUBDOMAIN.some(p => pathname.startsWith(p))
    if (!isPublicSubdomain) {
      const token = request.cookies.get('business_sid')?.value
      if (!token) {
        return NextResponse.redirect(buildRedirectUrl(request, '/signin'))
      }
      const payload = await verifyBusinessToken(token, reqSignals)
      if (!payload) {
        const res = NextResponse.redirect(buildRedirectUrl(request, '/signin'))
        res.cookies.delete('business_sid')
        return res
      }
      if (payload.approvalStatus === 'pending') {
        return NextResponse.redirect(buildRedirectUrl(request, '/pending'))
      }
      if (payload.approvalStatus === 'rejected') {
        return NextResponse.redirect(buildRedirectUrl(request, '/signin?rejected=1'))
      }
    }
    const slug = pathname === '/' ? '' : pathname
    return addSecurityHeaders(NextResponse.rewrite(new URL(`/business${slug}${request.nextUrl.search}`, request.url)))
  }

  // Business portal auth — applies to /business/* paths (not subdomain, not API, not public pages)
  // Skip on admin subdomain: /business/* there gets rewritten to /admin/business/* by the block below
  if (!isAdminSubdomain && pathname.startsWith('/business/')) {
    const PUBLIC_BUSINESS = ['/business/signin', '/business/signup', '/business/pending']
    const isPublic = PUBLIC_BUSINESS.some(p => pathname.startsWith(p))
    if (!isPublic) {
      const token = request.cookies.get('business_sid')?.value
      if (!token) {
        const signinUrl = buildRedirectUrl(request, '/business/signin')
        signinUrl.searchParams.set('callbackUrl', pathname + request.nextUrl.search)
        return NextResponse.redirect(signinUrl)
      }
      const payload = await verifyBusinessToken(token, reqSignals)
      if (!payload) {
        const signinUrl = buildRedirectUrl(request, '/business/signin')
        signinUrl.searchParams.set('callbackUrl', pathname + request.nextUrl.search)
        const res = NextResponse.redirect(signinUrl)
        res.cookies.delete('business_sid')
        return res
      }
      if (payload.approvalStatus === 'pending') {
        return NextResponse.redirect(buildRedirectUrl(request, '/business/pending'))
      }
      if (payload.approvalStatus === 'rejected') {
        return NextResponse.redirect(buildRedirectUrl(request, '/business/signin?rejected=1'))
      }
    }
  }

  if (pathname.startsWith('/forms/')) {
    const slug = pathname.replace('/forms/', '')
    return NextResponse.redirect(`https://forms.jeffistores.in/${slug}`, 301)
  }

  const publicApiPaths = [
    '/api/admin/auth/email-otp/start',
    '/api/admin/auth/email-otp/verify',
    '/api/admin/auth/google',
    '/api/admin/check-session',
    '/api/admin/delhivery/sync-statuses',
    '/api/admin/mfa/enroll-start',
    '/api/admin/mfa/enroll-confirm',
    '/api/admin/mfa/verify',
  ]
  if (isAdminApiPath && publicApiPaths.some(path => pathname.startsWith(path))) {
    const limited = await applyRateLimit(request)
    if (limited) return limited
    return addSecurityHeaders(NextResponse.next())
  }

  if (isAdminSubdomain) {
    if (isAdminApiPath) {
      // Admin API auth is handled below — fall through
    } else if (pathname.startsWith('/api/')) {
      return addSecurityHeaders(NextResponse.next())
    } else if (!isAdminPath) {
      // B2B portal pages have no admin equivalent — redirect to the business subdomain
      const BUSINESS_ONLY = ['/business/signin', '/business/signup', '/business/pending']
      if (BUSINESS_ONLY.some(p => pathname.startsWith(p))) {
        const businessOrigin = hostname.replace(/^admin\./, 'business.').replace(/:\d+$/, '')
        const proto = process.env.NODE_ENV === 'production' ? 'https' : 'http'
        return NextResponse.redirect(new URL(pathname, `${proto}://${businessOrigin}`))
      }
      // Rewrite subdomain root paths to /admin/* (same pattern as business subdomain)
      // e.g. admin.jeffistores.in/dashboard → served from /admin/dashboard
      const slug = pathname === '/' ? '' : pathname
      const search = request.nextUrl.search

      // Auth check before rewrite so server components receive x-user-id etc.
      const isAdminLogin = pathname === '/login'
      if (!isAdminLogin) {
        const token = request.cookies.get('admin_sid')?.value
        if (!token) {
          return NextResponse.redirect(buildRedirectUrl(request, '/login'))
        }
        const payload = await verifyToken(token, reqSignals)
        if (!payload) {
          const res = NextResponse.redirect(buildRedirectUrl(request, '/login'))
          res.cookies.delete('admin_sid')
          return res
        }
        const rewriteUrl = new URL(`/admin${slug}${search}`, request.url)
        // Block mobile users from write-action pages (orders exempt)
        if (isMobileUA(request.headers.get('user-agent')) && isAdminWritePath(`/admin${slug}`)) {
          const parentPath = adminWritePathParent(`/admin${slug}`)
          return NextResponse.redirect(buildRedirectUrl(request, `${parentPath}?desktop_required=1`))
        }
        const response = NextResponse.rewrite(rewriteUrl)
        response.headers.set('x-pathname', `/admin${slug}`)
        response.headers.set('x-user-id', payload.adminId)
        response.headers.set('x-username', payload.displayName || `${payload.first_name || ''} ${payload.last_name || ''}`.trim() || 'Admin')
        response.headers.set('x-user-role', payload.role)
        response.headers.set('x-user-scopes', JSON.stringify(payload.scopes || []))
        return addSecurityHeaders(response)
      }
      return addSecurityHeaders(NextResponse.rewrite(new URL(`/admin${slug}${search}`, request.url)))
    }
  }

  if (isAdminApiPath) {
    // Machine-to-machine endpoints authenticated by Bearer token — skip cookie check.
    const bearerOnlyPaths = ['/api/admin/replication/log']
    if (bearerOnlyPaths.some(p => pathname.startsWith(p)) && request.method === 'POST') {
      return addSecurityHeaders(NextResponse.next())
    }

    // Service account auth via mTLS client certificate serial.
    // nginx passes $ssl_client_serial as X-Client-Cert-Serial. The edge runtime
    // cannot use pg (Node.js crypto), so we pass the request through and let the
    // route handler validate via authenticateServiceAccount() in jwt.ts.
    const certSerial = request.headers.get('x-client-cert-serial') || ''
    if (certSerial) {
      return addSecurityHeaders(NextResponse.next())
    }

    const token = request.cookies.get('admin_sid')?.value
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const payload = await verifyToken(token, reqSignals)
    if (!payload) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
    }

    const certCN = request.headers.get('x-client-cert-cn') || ''
    const tokenCertCN = payload.authCertCN
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

    const token = request.cookies.get('admin_sid')?.value

    if (!token) {
      const loginUrl = buildRedirectUrl(request, '/admin/login')
      loginUrl.searchParams.set('callbackUrl', pathname)
      return NextResponse.redirect(loginUrl)
    }

    const payload = await verifyToken(token, reqSignals)

    if (!payload) {
      const loginUrl = buildRedirectUrl(request, '/admin/login')
      loginUrl.searchParams.set('callbackUrl', pathname)
      const response = NextResponse.redirect(loginUrl)
      response.cookies.delete('admin_sid')
      return response
    }

    const certCN = request.headers.get('x-client-cert-cn') || ''
    const tokenCertCN = payload.authCertCN
    if (certCN && !certCN.includes(' ') && tokenCertCN !== certCN) {
      const loginUrl = buildRedirectUrl(request, '/admin/login')
      loginUrl.searchParams.set('callbackUrl', pathname)
      const response = NextResponse.redirect(loginUrl)
      response.cookies.delete('admin_sid')
      return response
    }

    const requiredScope = getScopeForPath(pathname)
    if (requiredScope && !hasScope(payload.role, payload.scopes || [], requiredScope)) {
      return new NextResponse('Insufficient permissions', {
        status: 403,
        headers: { 'Content-Type': 'text/plain' },
      })
    }

    // Block mobile users from write-action pages (orders exempt)
    if (isMobileUA(request.headers.get('user-agent')) && isAdminWritePath(pathname)) {
      const parentPath = adminWritePathParent(pathname)
      return NextResponse.redirect(buildRedirectUrl(request, `${parentPath}?desktop_required=1`))
    }

    const response = NextResponse.next()
    response.headers.set('x-pathname', pathname)
    response.headers.set('x-user-id', payload.adminId)
    response.headers.set('x-username', `${payload.first_name || ''} ${payload.last_name || ''}`.trim() || payload.email || '')
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
