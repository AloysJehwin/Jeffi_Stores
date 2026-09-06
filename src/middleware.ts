import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { verifyToken, verifyBusinessToken } from './lib/jwt'
import { getScopeForPath, hasScope, isPlatformAdmin } from './lib/scopes'
import { applyRateLimit } from './lib/rate-limit'
import { extractSessionSignals } from './lib/session-signals-request'
import { resolveTenantFromHost, appFromHost, slugFromHost, formsHostForSlug } from './lib/tenant-registry'
import { runWithTenantContext } from './lib/tenant-context'
import { adminCookieNameForHost } from './lib/admin-cookie'

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

// x-forwarded-host selects the tenant, so a forged one would target another tenant's DB.
// nginx overwrites it on every proxy block; this is the second layer for anything that
// reaches Next directly. Trusted only when the edge secret matches, or (when none is
// configured) when it agrees with Host on the resolved tenant slug.
function resolveTrustedHost(request: NextRequest): string {
  const raw = request.headers.get('host') || request.nextUrl.hostname || ''
  const fwd = request.headers.get('x-forwarded-host')
  if (!fwd) return raw
  const secret = process.env.EDGE_PROXY_SECRET
  if (secret) return request.headers.get('x-edge-secret') === secret ? fwd : raw
  if (!raw) return fwd
  const a = slugFromHost(fwd)
  const b = slugFromHost(raw)
  if (a.slug === b.slug && a.isCustomDomain === b.isCustomDomain) return fwd
  console.warn(`[middleware] rejecting x-forwarded-host "${fwd}" (Host "${raw}" resolves differently)`)
  return raw
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
  const hostname = resolveTrustedHost(request)
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
  const hostApp = appFromHost(hostname)
  const isAdminSubdomain = hostApp === 'admin'
  const isTenantAdminSubdomain = isAdminSubdomain && /^admin-[^.]+\./.test(hostname)
  const isAdminPath = pathname === '/admin' || pathname.startsWith('/admin/')
  const adminCookie = adminCookieNameForHost(hostname)

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
  // Client-cert headers are set by nginx from the TLS handshake; a client-supplied one
  // would otherwise let a caller assert its own mTLS identity.
  stripped.delete('x-client-cert')
  stripped.delete('x-client-cert-serial')
  stripped.delete('x-client-cert-cn')
  // nginx sets these from the TLS handshake on the platform admin block, so restore its
  // values after the strip — service-account mTLS auth reads them downstream.
  if (isAdminSubdomain && !isTenantAdminSubdomain) {
    const ngSerial = request.headers.get('x-client-cert-serial')
    const ngCn = request.headers.get('x-client-cert-cn')
    if (ngSerial) stripped.set('x-client-cert-serial', ngSerial)
    if (ngCn) stripped.set('x-client-cert-cn', ngCn)
  }

  // Multi-tenant SaaS: resolve the tenant from the Host header (cached ~60s in-process).
  // Returns null for the platform's own hosts (jeffistores.in + app subdomains) and unknown
  // hosts → single-tenant behavior is unchanged. When a tenant IS resolved, forward it as
  // x-tenant-* so tenant-aware server code (getPool via TenantContext, S3, etc.) can scope.
  const tenant = await resolveTenantFromHost(hostname)
  if (tenant) {
    stripped.set('x-tenant-id', tenant.tenantId)
    stripped.set('x-tenant-slug', tenant.slug)
  } else {
    // A tenant-shaped host that resolves to nothing (unknown, suspended, still provisioning)
    // must not fall through to the platform store — that served flagship data on tenant hosts
    // and let an unknown slug probe for a login page.
    const parsed = slugFromHost(hostname)
    if (parsed.slug || parsed.isCustomDomain) {
      return addSecurityHeaders(new NextResponse('Not found', {
        status: 404,
        headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' },
      }))
    }
  }

  // Bare NextResponse.next() drops x-tenant-slug, and db.ts then serves the platform pool.
  const passThrough = (extra?: Record<string, string>) => {
    if (extra) for (const [k, v] of Object.entries(extra)) stripped.set(k, v)
    return NextResponse.next({ request: { headers: stripped } })
  }

  // Sessions and admins live in each tenant's OWN database, so every session lookup below
  // must run against that DB. Unwrapped, they all resolve against the platform pool.
  const inTenant = <T,>(fn: () => Promise<T>): Promise<T> =>
    tenant ? runWithTenantContext(tenant, fn) : fn()

  // Defence in depth behind the per-tenant DB: a session must have been minted for exactly
  // the tenant addressed by this host. Cookies are NOT cleared — admin_sid is shared across
  // *.jeffistores.in, so deleting it here would sign the operator out of the platform admin.
  if (tenant) {
    const anySid = request.cookies.get(adminCookie)?.value
      || request.cookies.get('user_sid')?.value
      || request.cookies.get('business_sid')?.value
    if (anySid) {
      const sess = await inTenant(async () => {
        const { resolveSession } = await import('./lib/auth-sessions')
        return resolveSession(anySid, reqSignals).catch(() => null)
      })
      if (sess && sess.tenantId !== tenant.tenantId) {
        return addSecurityHeaders(NextResponse.redirect(buildRedirectUrl(request, '/')))
      }
    }
  }

  if (hostname.startsWith('ecom.')) {
    // SaaS control plane (ecom.jeffistores.in). Public: marketing (/), /signin, /signup.
    // Protected (owner session required): /onboard, /dashboard. API under /api/ecom.
    if (pathname.startsWith('/api/')) return addSecurityHeaders(passThrough())
    // Shared platform legal pages (/legal/*) render as-is on the ecom host too — the
    // onboarding legals-consent links here — so don't rewrite them into /ecom/legal (404).
    if (pathname === '/legal' || pathname.startsWith('/legal/')) return addSecurityHeaders(passThrough())
    const OWNER_PROTECTED = ['/onboard', '/dashboard']
    if (OWNER_PROTECTED.some((p) => pathname === p || pathname.startsWith(p + '/'))) {
      const ownerSid = request.cookies.get('owner_sid')?.value
      if (!ownerSid) {
        return addSecurityHeaders(NextResponse.redirect(new URL('/signin', request.url)))
      }
      const { resolveOwnerSession } = await import('./lib/owner-session')
      const owner = await resolveOwnerSession(ownerSid, reqSignals).catch(() => null)
      if (!owner) {
        const res = NextResponse.redirect(new URL('/signin', request.url))
        res.cookies.delete('owner_sid')
        return addSecurityHeaders(res)
      }
    }
    const slug = pathname === '/' ? '' : pathname
    // Forward the real path so the ecom layout can hide its nav on auth pages.
    stripped.set('x-pathname', pathname)
    return addSecurityHeaders(NextResponse.rewrite(new URL(`/ecom${slug}${request.nextUrl.search}`, request.url), { request: { headers: stripped } }))
  }

  if (hostApp === 'forms') {
    if (pathname.startsWith('/api/')) {
      return addSecurityHeaders(passThrough())
    }
    const slug = pathname === '/' ? '' : pathname
    return addSecurityHeaders(NextResponse.rewrite(new URL(`/forms${slug}${request.nextUrl.search}`, request.url), { request: { headers: stripped } }))
  }

  if (hostApp === 'quotation') {
    if (pathname.startsWith('/api/')) return addSecurityHeaders(passThrough())
    const slug = pathname === '/' ? '' : pathname
    return addSecurityHeaders(NextResponse.rewrite(new URL(`/quotation${slug}${request.nextUrl.search}`, request.url), { request: { headers: stripped } }))
  }

  if (hostApp === 'invoice') {
    if (pathname.startsWith('/api/')) return addSecurityHeaders(passThrough())
    const slug = pathname === '/' ? '' : pathname
    return addSecurityHeaders(NextResponse.rewrite(new URL(`/invoice${slug}${request.nextUrl.search}`, request.url), { request: { headers: stripped } }))
  }

  if (hostApp === 'purchaseorder') {
    if (pathname.startsWith('/api/')) return addSecurityHeaders(passThrough())
    const slug = pathname === '/' ? '' : pathname
    return addSecurityHeaders(NextResponse.rewrite(new URL(`/purchaseorder${slug}${request.nextUrl.search}`, request.url), { request: { headers: stripped } }))
  }

  if (hostApp === 'business') {
    if (pathname.startsWith('/api/')) return addSecurityHeaders(passThrough())
    // Public pages on the subdomain (paths are /signin, /signup, /pending — no /business/ prefix)
    const PUBLIC_BUSINESS_SUBDOMAIN = ['/signin', '/signup', '/pending']
    const isPublicSubdomain = pathname === '/' || PUBLIC_BUSINESS_SUBDOMAIN.some(p => pathname.startsWith(p))
    if (!isPublicSubdomain) {
      const token = request.cookies.get('business_sid')?.value
      if (!token) {
        return NextResponse.redirect(buildRedirectUrl(request, '/signin'))
      }
      const payload = await inTenant(() => verifyBusinessToken(token, reqSignals))
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
      const payload = await inTenant(() => verifyBusinessToken(token, reqSignals))
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
    return NextResponse.redirect(`https://${formsHostForSlug(tenant?.slug ?? null)}/${slug}`, 301)
  }

  // Tenant admin mTLS. admin.jeffistores.in is gated by nginx against the platform CA; nginx
  // cannot select a per-tenant CA from a regex server_name, so for admin-{slug} it passes the
  // cert through (optional_no_ca) and we verify against that tenant's own CA.
  //
  // This runs BEFORE the public-API allowlist below. Under it, the login and MFA endpoints
  // were reachable on a tenant admin host with no client certificate at all, and
  // check-session never saw the verified identity, so the panel reported "not detected"
  // however valid the cert was.
  if (isTenantAdminSubdomain && tenant && process.env.TENANT_MTLS_ENFORCED !== 'false') {
    const { decodeClientCertHeader, verifyTenantClientCert } = await import('./lib/tenant-mtls')
    const pem = decodeClientCertHeader(request.headers.get('x-client-cert'))
    const v = await verifyTenantClientCert(pem, tenant.tenantId)
      .catch((): Awaited<ReturnType<typeof verifyTenantClientCert>> => ({ ok: false, reason: 'malformed' }))
    if (!v.ok) {
      return addSecurityHeaders(new NextResponse(
        'A client certificate is required to access this admin panel.',
        { status: 403, headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store', 'X-Mtls-Reason': v.reason ?? 'denied' } },
      ))
    }
    stripped.set('x-client-cert-serial', v.serial ?? '')
    stripped.set('x-client-cert-cn', v.commonName ?? '')
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
    return addSecurityHeaders(passThrough())
  }

  if (isAdminSubdomain) {
    // Ecom control-plane pages are ONLY available on admin.jeffistores.in (platform admin).
    // Tenant admin subdomains (admin-{slug}.jeffistores.in) must never expose these routes.
    if (isTenantAdminSubdomain && (pathname.startsWith('/ecom') || pathname.startsWith('/api/admin/ecom'))) {
      return new NextResponse('Not found', { status: 404 })
    }

    // On an admin host the panel is served at the root, so /admin/x is a duplicate of /x.
    if (isAdminPath) {
      const target = (pathname.replace(/^\/admin/, '') || '/') + request.nextUrl.search
      return NextResponse.redirect(buildRedirectUrl(request, target), 308)
    }

    if (isAdminApiPath) {
      // Admin API auth is handled below — fall through
    } else if (pathname.startsWith('/api/')) {
      return addSecurityHeaders(passThrough())
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
        const token = request.cookies.get(adminCookie)?.value
        if (!token) {
          return NextResponse.redirect(buildRedirectUrl(request, '/login'))
        }
        const payload = await inTenant(() => verifyToken(token, reqSignals))
        if (!payload) {
          const res = NextResponse.redirect(buildRedirectUrl(request, '/login'))
          res.cookies.delete(adminCookie)
          return res
        }
        const rewriteUrl = new URL(`/admin${slug}${search}`, request.url)
        if (`/admin${slug}`.startsWith('/admin/ecom') && !isPlatformAdmin(payload.role)) {
          return new NextResponse('Insufficient permissions', {
            status: 403,
            headers: { 'Content-Type': 'text/plain' },
          })
        }
        // Page-level scope gate. Only the /admin/* branch below used to run this, and on an
        // admin host every page arrives here instead — so pages were reachable without the
        // scope they declare. Most admin pages are server components that query directly
        // rather than through /api/admin, whose own gate would not have covered them.
        const pageScope = getScopeForPath(`/admin${slug}`)
        if (pageScope && !hasScope(payload.role, payload.scopes || [], pageScope)) {
          return new NextResponse('Insufficient permissions', {
            status: 403,
            headers: { 'Content-Type': 'text/plain' },
          })
        }
        // Block mobile users from write-action pages (orders exempt)
        if (isMobileUA(request.headers.get('user-agent')) && isAdminWritePath(`/admin${slug}`)) {
          const parentPath = adminWritePathParent(`/admin${slug}`)
          return NextResponse.redirect(buildRedirectUrl(request, `${parentPath}?desktop_required=1`))
        }
        // Set forwarded identity on the REQUEST headers (stripped) so both server
        // components AND getPool()'s x-tenant-slug bridge see them. stripped already
        // carries x-tenant-slug/x-tenant-id from above; forwarding it here is what
        // routes a tenant admin's queries to the tenant's own RDS.
        stripped.set('x-pathname', `/admin${slug}`)
        stripped.set('x-user-id', payload.adminId)
        stripped.set('x-username', payload.displayName || payload.email || 'Admin')
        stripped.set('x-user-role', payload.role)
        stripped.set('x-user-scopes', JSON.stringify(payload.scopes || []))
        const response = NextResponse.rewrite(rewriteUrl, { request: { headers: stripped } })
        return addSecurityHeaders(response)
      }
      return addSecurityHeaders(NextResponse.rewrite(new URL(`/admin${slug}${search}`, request.url), { request: { headers: stripped } }))
    }
  }

  if (isAdminApiPath) {
    // Machine-to-machine endpoints authenticated by Bearer token — skip cookie check.
    const bearerOnlyPaths = ['/api/admin/replication/log']
    if (bearerOnlyPaths.some(p => pathname.startsWith(p)) && request.method === 'POST') {
      return addSecurityHeaders(passThrough())
    }

    // OAuth callbacks return cross-site from Google; the SameSite=Strict admin cookie is not sent.
    // These authenticate via the HMAC-signed `state` in the route handler, not the session cookie.
    const oauthCallbackPaths = [
      '/api/admin/data-source/google/callback',
    ]
    if (oauthCallbackPaths.some(p => pathname.startsWith(p)) && request.method === 'GET') {
      return addSecurityHeaders(passThrough())
    }

    // Service account auth via mTLS client certificate serial.
    // nginx passes $ssl_client_serial as X-Client-Cert-Serial. The edge runtime
    // cannot use pg (Node.js crypto), so we pass the request through and let the
    // route handler validate via authenticateServiceAccount() in jwt.ts.
    const certSerial = request.headers.get('x-client-cert-serial') || ''
    if (certSerial) {
      return addSecurityHeaders(passThrough())
    }

    const token = request.cookies.get(adminCookie)?.value
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const payload = await inTenant(() => verifyToken(token, reqSignals))
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

    if (pathname.startsWith('/api/admin/ecom') && !isPlatformAdmin(payload.role)) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    return addSecurityHeaders(passThrough())
  }

  if (isAdminPath) {
    const isLocalhost = hostname === 'localhost' || hostname.startsWith('localhost:') ||
                       hostname === '127.0.0.1' || hostname.startsWith('127.0.0.1:') ||
                       hostname.startsWith('app:') ||
                       hostname.startsWith('192.168.') || hostname.startsWith('10.') ||
                       hostname.endsWith('.ngrok-free.app') || hostname.endsWith('.ngrok-free.dev')

    if (pathname === '/admin/login') {
      return addSecurityHeaders(passThrough({ 'x-pathname': pathname }))
    }

    if (!isAdminSubdomain && !isLocalhost) {
      return new NextResponse('Admin access requires the admin subdomain', {
        status: 403,
        headers: { 'Content-Type': 'text/plain' },
      })
    }

    const token = request.cookies.get(adminCookie)?.value

    if (!token) {
      const loginUrl = buildRedirectUrl(request, '/admin/login')
      loginUrl.searchParams.set('callbackUrl', pathname)
      return NextResponse.redirect(loginUrl)
    }

    const payload = await inTenant(() => verifyToken(token, reqSignals))

    if (!payload) {
      const loginUrl = buildRedirectUrl(request, '/admin/login')
      loginUrl.searchParams.set('callbackUrl', pathname)
      const response = NextResponse.redirect(loginUrl)
      response.cookies.delete(adminCookie)
      return response
    }

    const certCN = request.headers.get('x-client-cert-cn') || ''
    const tokenCertCN = payload.authCertCN
    if (certCN && !certCN.includes(' ') && tokenCertCN !== certCN) {
      const loginUrl = buildRedirectUrl(request, '/admin/login')
      loginUrl.searchParams.set('callbackUrl', pathname)
      const response = NextResponse.redirect(loginUrl)
      response.cookies.delete(adminCookie)
      return response
    }

    const requiredScope = getScopeForPath(pathname)
    if (requiredScope && !hasScope(payload.role, payload.scopes || [], requiredScope)) {
      return new NextResponse('Insufficient permissions', {
        status: 403,
        headers: { 'Content-Type': 'text/plain' },
      })
    }

    if (pathname.startsWith('/admin/ecom') && !isPlatformAdmin(payload.role)) {
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

    return addSecurityHeaders(passThrough({
      'x-pathname': pathname,
      'x-user-id': payload.adminId,
      'x-username': payload.displayName || payload.email || 'Admin',
      'x-user-role': payload.role,
      'x-user-scopes': JSON.stringify(payload.scopes || []),
    }))
  }

  return addSecurityHeaders(passThrough())
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|images|icon.png|apple-icon.png).*)',
  ],
}
