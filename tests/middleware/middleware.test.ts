import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

// ---------------------------------------------------------------------------
// Mocks — vi.hoisted() ensures these are defined before vi.mock() factories run
// ---------------------------------------------------------------------------

const { mockVerifyToken, mockVerifyBusinessToken, mockApplyRateLimit, mockGetScopeForPath, mockHasScope } = vi.hoisted(
  () => ({
    mockVerifyToken: vi.fn(),
    mockVerifyBusinessToken: vi.fn(),
    mockApplyRateLimit: vi.fn().mockResolvedValue(null),
    mockGetScopeForPath: vi.fn().mockReturnValue(null),
    mockHasScope: vi.fn().mockReturnValue(true),
  })
)

vi.mock('@/lib/jwt', () => ({
  verifyToken: mockVerifyToken,
  verifyBusinessToken: mockVerifyBusinessToken,
  authenticateAdmin: vi.fn(),
}))

vi.mock('@/lib/rate-limit', () => ({
  applyRateLimit: mockApplyRateLimit,
}))

vi.mock('@/lib/scopes', () => ({
  getScopeForPath: mockGetScopeForPath,
  hasScope: mockHasScope,
}))

// Import AFTER mocks are hoisted so the module picks up the stubs
import { middleware } from '@/middleware'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a NextRequest with a given URL + optional cookies.
 *  NOTE: the `host` header is stripped by the fetch implementation in the
 *  test environment; hostname routing uses `nextUrl.hostname` (from the URL)
 *  or `x-forwarded-host`.  Cookies are injected via the cookies store because
 *  the `cookie` header is also stripped. */
function makeNextRequest(
  url: string,
  opts: {
    host?: string
    cookies?: Record<string, string>
    headers?: Record<string, string>
  } = {}
): NextRequest {
  const req = new NextRequest(url, {
    headers: opts.headers ? new Headers(opts.headers) : undefined,
  })
  if (opts.cookies) {
    for (const [k, v] of Object.entries(opts.cookies)) {
      req.cookies.set(k, v)
    }
  }
  return req
}

/**
 * Read an identity header that middleware forwarded onto the REWRITTEN REQUEST.
 *
 * Middleware sets identity via `NextResponse.rewrite(url, { request: { headers } })`
 * rather than on the response, so that server components AND getPool()'s
 * x-tenant-slug bridge both observe it — that forwarding is what routes a tenant
 * admin's queries to the tenant's own RDS instead of the platform DB.
 *
 * Next encodes those forwarded request headers onto the response as
 * `x-middleware-request-<name>`. Falls back to the plain response header for the
 * routes that still set identity on the response directly.
 */
function forwardedRequestHeader(res: Response, name: string): string | null {
  return res.headers.get(`x-middleware-request-${name}`) ?? res.headers.get(name)
}

/** Opaque-session model: the cookie value is a bare session id and middleware calls the
 *  (mocked) verifyBusinessToken to resolve it. This sets the mock's return for the given
 *  claims and hands back a dummy opaque cookie value to put in the request. */
async function mintBusinessJwt(claims: Record<string, unknown> = {}): Promise<string> {
  mockVerifyBusinessToken.mockResolvedValue({
    userId: 'biz-001',
    email: 'biz@example.com',
    isBusiness: true,
    approvalStatus: 'approved',
    scopes: [],
    ...claims,
  })
  return 'biz-session-id'
}

const ADMIN_PAYLOAD = {
  adminId: 'admin-001',
  username: 'alice',
  role: 'super_admin',
  scopes: [] as string[],
}

const BIZ_PAYLOAD = {
  userId: 'biz-001',
  email: 'biz@example.com',
  isBusiness: true,
  approvalStatus: 'approved',
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('middleware', () => {
  beforeEach(() => {
    mockVerifyToken.mockResolvedValue(null)
    mockApplyRateLimit.mockResolvedValue(null)
    mockGetScopeForPath.mockReturnValue(null)
    mockHasScope.mockReturnValue(true)
  })

  // -------------------------------------------------------------------------
  // www subdomain redirect
  // -------------------------------------------------------------------------
  describe('www subdomain', () => {
    it('redirects www to apex with 307', async () => {
      const req = makeNextRequest('https://www.jeffistores.in/products', {
        host: 'www.jeffistores.in',
      })
      const res = await middleware(req)
      expect(res.status).toBe(307)
      const loc = res.headers.get('location') ?? ''
      expect(loc).toContain('jeffistores.in/products')
      expect(loc).not.toContain('www.')
    })

    it('sets Cache-Control no-store on www redirect', async () => {
      const req = makeNextRequest('https://www.jeffistores.in/', {
        host: 'www.jeffistores.in',
      })
      const res = await middleware(req)
      expect(res.headers.get('cache-control')).toBe('no-store, must-revalidate')
    })
  })

  // -------------------------------------------------------------------------
  // Admin subdomain — page routes
  // -------------------------------------------------------------------------
  describe('admin subdomain — page routes', () => {
    it('redirects to /login when no token is present', async () => {
      const req = makeNextRequest('https://admin.jeffistores.in/dashboard', {
        host: 'admin.jeffistores.in',
      })
      const res = await middleware(req)
      expect(res.status).toBe(307)
      expect(res.headers.get('location')).toContain('/login')
    })

    it('rewrites to /admin/* and sets x-user-id header with valid token', async () => {
      mockVerifyToken.mockResolvedValue(ADMIN_PAYLOAD)

      const req = makeNextRequest('https://admin.jeffistores.in/dashboard', {
        host: 'admin.jeffistores.in',
        cookies: { admin_sid: 'valid.token.here' },
      })
      const res = await middleware(req)
      // Rewrite response is not a redirect
      expect(res.status).not.toBe(307)
      expect(res.status).not.toBe(401)
      expect(forwardedRequestHeader(res, 'x-user-id')).toBe('admin-001')
    })

    it('passes through /login without calling verifyToken', async () => {
      const req = makeNextRequest('https://admin.jeffistores.in/login', {
        host: 'admin.jeffistores.in',
      })
      const res = await middleware(req)
      expect(res.status).not.toBe(307)
      expect(mockVerifyToken).not.toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // Admin API paths
  // -------------------------------------------------------------------------
  describe('admin API paths', () => {
    it('returns 401 JSON when no token provided for /api/admin/orders', async () => {
      const req = makeNextRequest('http://localhost/api/admin/orders', {
        host: 'localhost',
      })
      const res = await middleware(req)
      expect(res.status).toBe(401)
      const body = await res.json()
      expect(body).toHaveProperty('error')
    })

    it('returns 401 JSON for invalid/expired token on /api/admin/orders', async () => {
      mockVerifyToken.mockResolvedValue(null)
      const req = makeNextRequest('http://localhost/api/admin/orders', {
        host: 'localhost',
        cookies: { admin_sid: 'bad.token' },
      })
      const res = await middleware(req)
      expect(res.status).toBe(401)
    })

    it('returns 403 JSON when token is valid but scope is insufficient', async () => {
      mockVerifyToken.mockResolvedValue({
        adminId: 'admin-002',
        username: 'bob',
        role: 'staff',
        scopes: ['dashboard'],
      })
      mockGetScopeForPath.mockReturnValue('orders')
      mockHasScope.mockReturnValue(false)

      const req = makeNextRequest('http://localhost/api/admin/orders', {
        host: 'localhost',
        cookies: { admin_sid: 'scoped.token' },
      })
      const res = await middleware(req)
      expect(res.status).toBe(403)
      const body = await res.json()
      expect(body.error).toMatch(/permission/i)
    })

    it('passes through public admin auth path (email-OTP) with rate limiting only (no auth)', async () => {
      const req = makeNextRequest('http://localhost/api/admin/auth/email-otp/start', {
        host: 'localhost',
      })
      const res = await middleware(req)
      // Public auth path — must NOT be 401
      expect(res.status).not.toBe(401)
      expect(mockApplyRateLimit).toHaveBeenCalled()
    })

    it('returns rate-limit response when applyRateLimit fires', async () => {
      const limitedRes = NextResponse.json({ error: 'Too many requests' }, { status: 429 })
      mockApplyRateLimit.mockResolvedValue(limitedRes)

      const req = makeNextRequest('http://localhost/api/admin/auth/email-otp/start', {
        host: 'localhost',
      })
      const res = await middleware(req)
      expect(res.status).toBe(429)
    })
  })

  // -------------------------------------------------------------------------
  // Business subdomain
  // -------------------------------------------------------------------------
  describe('business subdomain', () => {
    it('redirects to /signin when no token on a protected path', async () => {
      const req = makeNextRequest('https://business.jeffistores.in/products', {
        host: 'business.jeffistores.in',
      })
      const res = await middleware(req)
      expect(res.status).toBe(307)
      expect(res.headers.get('location')).toContain('/signin')
    })

    it('rewrites to /business/* when token is valid and approved', async () => {
      const token = await mintBusinessJwt({ approvalStatus: 'approved' })

      const req = makeNextRequest('https://business.jeffistores.in/products', {
        host: 'business.jeffistores.in',
        cookies: { business_sid: token },
      })
      const res = await middleware(req)
      expect(res.status).not.toBe(307)
      expect(res.status).not.toBe(401)
    })

    it('redirects to /pending when approvalStatus is pending', async () => {
      const token = await mintBusinessJwt({ approvalStatus: 'pending' })

      const req = makeNextRequest('https://business.jeffistores.in/products', {
        host: 'business.jeffistores.in',
        cookies: { business_sid: token },
      })
      const res = await middleware(req)
      expect(res.status).toBe(307)
      expect(res.headers.get('location')).toContain('/pending')
    })

    it('does not call verifyToken for the public /signin path', async () => {
      const req = makeNextRequest('https://business.jeffistores.in/signin', {
        host: 'business.jeffistores.in',
      })
      await middleware(req)
      expect(mockVerifyToken).not.toHaveBeenCalled()
    })

    it('passes through /api/* on business subdomain without auth', async () => {
      const req = makeNextRequest('https://business.jeffistores.in/api/products', {
        host: 'business.jeffistores.in',
      })
      const res = await middleware(req)
      expect(res.status).not.toBe(401)
      expect(res.status).not.toBe(307)
    })
  })

  // -------------------------------------------------------------------------
  // General paths — security headers
  // -------------------------------------------------------------------------
  describe('general paths', () => {
    it('adds security headers on a normal page request', async () => {
      const req = makeNextRequest('http://localhost/', { host: 'localhost' })
      const res = await middleware(req)
      expect(res.headers.get('x-content-type-options')).toBe('nosniff')
      expect(res.headers.get('x-frame-options')).toBe('DENY')
    })
  })

  // -------------------------------------------------------------------------
  // /business/* paths on non-subdomain host
  // -------------------------------------------------------------------------
  describe('/business/* paths on main domain', () => {
    it('redirects to /business/signin when no token present on /business/cart', async () => {
      const req = makeNextRequest('http://localhost/business/cart', {
        headers: { 'x-forwarded-host': 'localhost' },
      })
      const res = await middleware(req)
      expect(res.status).toBe(307)
      expect(res.headers.get('location')).toContain('/business/signin')
    })

    it('redirects to /business/signin when token is invalid on /business/products', async () => {
      mockVerifyBusinessToken.mockResolvedValue(null)
      const req = makeNextRequest('http://localhost/business/products', {
        headers: { 'x-forwarded-host': 'localhost' },
        cookies: { business_sid: 'bad-token' },
      })
      const res = await middleware(req)
      expect(res.status).toBe(307)
      expect(res.headers.get('location')).toContain('/business/signin')
    })

    it('redirects to /business/pending when approvalStatus is pending', async () => {
      const token = await mintBusinessJwt({ approvalStatus: 'pending' })
      const req = makeNextRequest('http://localhost/business/products', {
        headers: { 'x-forwarded-host': 'localhost' },
        cookies: { business_sid: token },
      })
      const res = await middleware(req)
      expect(res.status).toBe(307)
      expect(res.headers.get('location')).toContain('/business/pending')
    })

    it('passes through /business/signin without auth check', async () => {
      const req = makeNextRequest('http://localhost/business/signin', {
        headers: { 'x-forwarded-host': 'localhost' },
      })
      const res = await middleware(req)
      expect(res.status).not.toBe(307)
      expect(mockVerifyToken).not.toHaveBeenCalled()
    })

    it('passes through /business/signup without auth check', async () => {
      const req = makeNextRequest('http://localhost/business/signup', {
        headers: { 'x-forwarded-host': 'localhost' },
      })
      const res = await middleware(req)
      expect(res.status).not.toBe(307)
      expect(mockVerifyToken).not.toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // /forms/* redirect to forms.jeffistores.in
  // -------------------------------------------------------------------------
  describe('/forms/* redirect', () => {
    it('redirects /forms/abc to https://forms.jeffistores.in/abc with 301', async () => {
      const req = makeNextRequest('http://localhost/forms/my-form', {
        headers: { 'x-forwarded-host': 'localhost' },
      })
      const res = await middleware(req)
      expect(res.status).toBe(301)
      const loc = res.headers.get('location') ?? ''
      expect(loc).toContain('forms.jeffistores.in')
      expect(loc).toContain('my-form')
    })

    it('strips the /forms/ prefix in the redirect target', async () => {
      const req = makeNextRequest('http://localhost/forms/quote-request', {
        headers: { 'x-forwarded-host': 'localhost' },
      })
      const res = await middleware(req)
      expect(res.status).toBe(301)
      const loc = res.headers.get('location') ?? ''
      expect(loc).not.toContain('/forms/')
      expect(loc).toContain('quote-request')
    })
  })

  // -------------------------------------------------------------------------
  // /admin/* on localhost (no subdomain required)
  // -------------------------------------------------------------------------
  describe('/admin/* on localhost', () => {
    it('passes /admin/login through without auth on localhost', async () => {
      const req = makeNextRequest('http://localhost/admin/login', {
        headers: { 'x-forwarded-host': 'localhost' },
      })
      const res = await middleware(req)
      expect(res.status).not.toBe(403)
      expect(mockVerifyToken).not.toHaveBeenCalled()
    })

    it('redirects to /admin/login with callbackUrl when no token on localhost', async () => {
      const req = makeNextRequest('http://localhost/admin/dashboard', {
        headers: { 'x-forwarded-host': 'localhost' },
      })
      const res = await middleware(req)
      expect(res.status).toBe(307)
      const loc = res.headers.get('location') ?? ''
      expect(loc).toContain('/admin/login')
    })

    it('passes through with valid token on localhost /admin/orders', async () => {
      mockVerifyToken.mockResolvedValue(ADMIN_PAYLOAD)
      const req = makeNextRequest('http://localhost/admin/orders', {
        headers: { 'x-forwarded-host': 'localhost' },
        cookies: { admin_sid: 'valid-token' },
      })
      const res = await middleware(req)
      expect(res.status).not.toBe(307)
      expect(res.status).not.toBe(403)
      expect(forwardedRequestHeader(res, 'x-user-id')).toBe('admin-001')
    })

    it('returns 403 on /admin/* from a non-admin, non-localhost host', async () => {
      const req = makeNextRequest('https://jeffistores.in/admin/dashboard', {
        headers: { 'x-forwarded-host': 'jeffistores.in' },
        cookies: { admin_sid: 'some-token' },
      })
      const res = await middleware(req)
      expect(res.status).toBe(403)
    })
  })

  // -------------------------------------------------------------------------
  // Certificate CN mismatch on admin API path
  // -------------------------------------------------------------------------
  describe('certificate CN mismatch', () => {
    it('returns 403 when cert CN does not match the token-bound cert CN', async () => {
      mockVerifyToken.mockResolvedValue({
        ...ADMIN_PAYLOAD,
        authCertCN: 'alice',
      })
      const req = makeNextRequest('http://localhost/api/admin/orders', {
        headers: {
          'x-forwarded-host': 'localhost',
          'x-client-cert-cn': 'bob',
        },
        cookies: { admin_sid: 'valid-token' },
      })
      const res = await middleware(req)
      expect(res.status).toBe(403)
      const body = await res.json()
      expect(body.error).toMatch(/certificate/i)
    })

    it('passes through when cert CN matches the token-bound cert CN', async () => {
      mockVerifyToken.mockResolvedValue({
        ...ADMIN_PAYLOAD,
        authCertCN: 'alice',
      })
      const req = makeNextRequest('http://localhost/api/admin/orders', {
        headers: {
          'x-forwarded-host': 'localhost',
          'x-client-cert-cn': 'alice',
        },
        cookies: { admin_sid: 'valid-token' },
      })
      const res = await middleware(req)
      expect(res.status).not.toBe(403)
    })

    it('ignores cert CN check when cert CN contains spaces (proxy header)', async () => {
      mockVerifyToken.mockResolvedValue({ ...ADMIN_PAYLOAD, username: 'alice' })
      const req = makeNextRequest('http://localhost/api/admin/orders', {
        headers: {
          'x-forwarded-host': 'localhost',
          'x-client-cert-cn': 'Jeffi Stores CA',
        },
        cookies: { admin_sid: 'valid-token' },
      })
      const res = await middleware(req)
      // CN with spaces is treated as non-client cert — no mismatch rejection
      expect(res.status).not.toBe(403)
    })
  })

  // -------------------------------------------------------------------------
  // forms / quotation / invoice / purchaseorder subdomains
  // -------------------------------------------------------------------------
  describe('forms subdomain rewrite', () => {
    it('rewrites forms.jeffistores.in/some-form to /forms/some-form', async () => {
      const req = makeNextRequest('https://forms.jeffistores.in/some-form', {
        headers: { 'x-forwarded-host': 'forms.jeffistores.in' },
      })
      const res = await middleware(req)
      expect(res.status).not.toBe(307)
      expect(res.status).not.toBe(301)
    })

    it('passes API paths through on forms subdomain', async () => {
      const req = makeNextRequest('https://forms.jeffistores.in/api/products', {
        headers: { 'x-forwarded-host': 'forms.jeffistores.in' },
      })
      const res = await middleware(req)
      expect(res.status).not.toBe(307)
    })
  })

  describe('quotation subdomain rewrite', () => {
    it('rewrites quotation subdomain path to /quotation/*', async () => {
      const req = makeNextRequest('https://quotation.jeffistores.in/view/123', {
        headers: { 'x-forwarded-host': 'quotation.jeffistores.in' },
      })
      const res = await middleware(req)
      expect(res.status).not.toBe(307)
      expect(res.status).not.toBe(301)
    })
  })

  describe('invoice subdomain rewrite', () => {
    it('rewrites invoice subdomain path to /invoice/*', async () => {
      const req = makeNextRequest('https://invoice.jeffistores.in/view/INV-001', {
        headers: { 'x-forwarded-host': 'invoice.jeffistores.in' },
      })
      const res = await middleware(req)
      expect(res.status).not.toBe(307)
      expect(res.status).not.toBe(301)
    })
  })

  describe('purchaseorder subdomain rewrite', () => {
    it('rewrites purchaseorder subdomain path to /purchaseorder/*', async () => {
      const req = makeNextRequest('https://purchaseorder.jeffistores.in/view/PO-001', {
        headers: { 'x-forwarded-host': 'purchaseorder.jeffistores.in' },
      })
      const res = await middleware(req)
      expect(res.status).not.toBe(307)
      expect(res.status).not.toBe(301)
    })

    it('rewrites purchaseorder root / to /purchaseorder (empty slug)', async () => {
      const req = makeNextRequest('https://purchaseorder.jeffistores.in/', {
        headers: { 'x-forwarded-host': 'purchaseorder.jeffistores.in' },
      })
      const res = await middleware(req)
      expect(res.status).not.toBe(307)
      expect(res.status).not.toBe(301)
    })

    it('passes API paths through on purchaseorder subdomain', async () => {
      const req = makeNextRequest('https://purchaseorder.jeffistores.in/api/some-endpoint', {
        headers: { 'x-forwarded-host': 'purchaseorder.jeffistores.in' },
      })
      const res = await middleware(req)
      expect(res.status).not.toBe(307)
    })
  })

  // -------------------------------------------------------------------------
  // forms subdomain — root path and API pass-through
  // -------------------------------------------------------------------------
  describe('forms subdomain — additional branches', () => {
    it('rewrites forms root / to /forms (empty slug)', async () => {
      const req = makeNextRequest('https://forms.jeffistores.in/', {
        headers: { 'x-forwarded-host': 'forms.jeffistores.in' },
      })
      const res = await middleware(req)
      expect(res.status).not.toBe(307)
      expect(res.status).not.toBe(301)
    })
  })

  // -------------------------------------------------------------------------
  // quotation subdomain — API pass-through and root path
  // -------------------------------------------------------------------------
  describe('quotation subdomain — additional branches', () => {
    it('passes API paths through on quotation subdomain', async () => {
      const req = makeNextRequest('https://quotation.jeffistores.in/api/some-endpoint', {
        headers: { 'x-forwarded-host': 'quotation.jeffistores.in' },
      })
      const res = await middleware(req)
      expect(res.status).not.toBe(307)
    })

    it('rewrites quotation root / to /quotation (empty slug)', async () => {
      const req = makeNextRequest('https://quotation.jeffistores.in/', {
        headers: { 'x-forwarded-host': 'quotation.jeffistores.in' },
      })
      const res = await middleware(req)
      expect(res.status).not.toBe(307)
      expect(res.status).not.toBe(301)
    })
  })

  // -------------------------------------------------------------------------
  // invoice subdomain — API pass-through and root path
  // -------------------------------------------------------------------------
  describe('invoice subdomain — additional branches', () => {
    it('passes API paths through on invoice subdomain', async () => {
      const req = makeNextRequest('https://invoice.jeffistores.in/api/some-endpoint', {
        headers: { 'x-forwarded-host': 'invoice.jeffistores.in' },
      })
      const res = await middleware(req)
      expect(res.status).not.toBe(307)
    })

    it('rewrites invoice root / to /invoice (empty slug)', async () => {
      const req = makeNextRequest('https://invoice.jeffistores.in/', {
        headers: { 'x-forwarded-host': 'invoice.jeffistores.in' },
      })
      const res = await middleware(req)
      expect(res.status).not.toBe(307)
      expect(res.status).not.toBe(301)
    })
  })

  // -------------------------------------------------------------------------
  // business subdomain — invalid token and rejected status
  // -------------------------------------------------------------------------
  describe('business subdomain — additional branches', () => {
    it('redirects and clears cookie when token is invalid on business subdomain', async () => {
      mockVerifyBusinessToken.mockResolvedValue(null)

      const req = makeNextRequest('https://business.jeffistores.in/products', {
        headers: { 'x-forwarded-host': 'business.jeffistores.in' },
        cookies: { business_sid: 'bad-token' },
      })
      const res = await middleware(req)
      expect(res.status).toBe(307)
      expect(res.headers.get('location')).toContain('/signin')
    })

    it('redirects to /signin?rejected=1 when approvalStatus is rejected on business subdomain', async () => {
      await mintBusinessJwt({ approvalStatus: 'rejected' })

      const req = makeNextRequest('https://business.jeffistores.in/products', {
        headers: { 'x-forwarded-host': 'business.jeffistores.in' },
        cookies: { business_sid: 'biz-session-id' },
      })
      const res = await middleware(req)
      expect(res.status).toBe(307)
      expect(res.headers.get('location')).toContain('rejected=1')
    })

    it('rewrites business subdomain root / to /business (empty slug)', async () => {
      const token = await mintBusinessJwt({ approvalStatus: 'approved' })

      const req = makeNextRequest('https://business.jeffistores.in/', {
        headers: { 'x-forwarded-host': 'business.jeffistores.in' },
        cookies: { business_sid: token },
      })
      const res = await middleware(req)
      // root is public, no redirect
      expect(res.status).not.toBe(307)
    })
  })

  // -------------------------------------------------------------------------
  // /business/* paths on main domain — rejected status
  // -------------------------------------------------------------------------
  describe('/business/* paths on main domain — rejected status', () => {
    it('redirects to /business/signin?rejected=1 when approvalStatus is rejected', async () => {
      const token = await mintBusinessJwt({ approvalStatus: 'rejected' })
      const req = makeNextRequest('http://localhost/business/products', {
        headers: { 'x-forwarded-host': 'localhost' },
        cookies: { business_sid: token },
      })
      const res = await middleware(req)
      expect(res.status).toBe(307)
      expect(res.headers.get('location')).toContain('rejected=1')
    })
  })

  // -------------------------------------------------------------------------
  // admin subdomain — non-admin-API, non-admin-path branches
  // -------------------------------------------------------------------------
  describe('admin subdomain — non-admin-path branches', () => {
    it('passes non-admin API paths through on admin subdomain without auth', async () => {
      const req = makeNextRequest('https://admin.jeffistores.in/api/products', {
        headers: { 'x-forwarded-host': 'admin.jeffistores.in' },
      })
      const res = await middleware(req)
      expect(res.status).not.toBe(401)
      expect(res.status).not.toBe(307)
    })

    it('redirects business/* paths on admin subdomain to business subdomain', async () => {
      const req = makeNextRequest('https://admin.jeffistores.in/business/signin', {
        headers: { 'x-forwarded-host': 'admin.jeffistores.in' },
      })
      const res = await middleware(req)
      expect(res.status).toBe(307)
      const loc = res.headers.get('location') ?? ''
      expect(loc).toContain('business.')
    })

    it('rewrites admin subdomain path to /admin/* when token is valid (x-pathname set)', async () => {
      mockVerifyToken.mockResolvedValue(ADMIN_PAYLOAD)

      const req = makeNextRequest('https://admin.jeffistores.in/products', {
        headers: { 'x-forwarded-host': 'admin.jeffistores.in' },
        cookies: { admin_sid: 'valid-token' },
      })
      const res = await middleware(req)
      expect(forwardedRequestHeader(res, 'x-user-id')).toBe('admin-001')
    })

    it('redirects to /login and clears cookie when admin token is invalid on subdomain', async () => {
      mockVerifyToken.mockResolvedValue(null)

      const req = makeNextRequest('https://admin.jeffistores.in/products', {
        headers: { 'x-forwarded-host': 'admin.jeffistores.in' },
        cookies: { admin_sid: 'invalid-token' },
      })
      const res = await middleware(req)
      expect(res.status).toBe(307)
      expect(res.headers.get('location')).toContain('/login')
    })

    it('blocks mobile UA from admin write paths on subdomain and redirects to parent', async () => {
      mockVerifyToken.mockResolvedValue(ADMIN_PAYLOAD)

      const req = makeNextRequest('https://admin.jeffistores.in/products/edit/abc', {
        headers: {
          'x-forwarded-host': 'admin.jeffistores.in',
          'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) Mobile/15E148',
        },
        cookies: { admin_sid: 'valid-token' },
      })
      const res = await middleware(req)
      expect(res.status).toBe(307)
      const loc = res.headers.get('location') ?? ''
      expect(loc).toContain('desktop_required=1')
    })
  })

  // -------------------------------------------------------------------------
  // Mobile UA — admin write path block on /admin/* direct paths
  // -------------------------------------------------------------------------
  describe('mobile UA write path block on /admin/* (localhost)', () => {
    it('blocks mobile UA from /admin/products/edit/* and redirects with desktop_required', async () => {
      mockVerifyToken.mockResolvedValue(ADMIN_PAYLOAD)

      const req = makeNextRequest('http://localhost/admin/products/edit/abc', {
        headers: {
          'x-forwarded-host': 'localhost',
          'user-agent': 'Mozilla/5.0 (Android 12; Mobile) AppleWebKit/537.36',
        },
        cookies: { admin_sid: 'valid-token' },
      })
      const res = await middleware(req)
      expect(res.status).toBe(307)
      const loc = res.headers.get('location') ?? ''
      expect(loc).toContain('desktop_required=1')
      expect(loc).toContain('/admin/products')
    })

    it('does NOT block desktop UA from /admin/products/edit/*', async () => {
      mockVerifyToken.mockResolvedValue(ADMIN_PAYLOAD)

      const req = makeNextRequest('http://localhost/admin/products/edit/abc', {
        headers: {
          'x-forwarded-host': 'localhost',
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
        cookies: { admin_sid: 'valid-token' },
      })
      const res = await middleware(req)
      expect(res.status).not.toBe(307)
    })

    it('does NOT block mobile UA from /admin/orders/* (orders are exempt)', async () => {
      mockVerifyToken.mockResolvedValue(ADMIN_PAYLOAD)

      const req = makeNextRequest('http://localhost/admin/orders/edit/123', {
        headers: {
          'x-forwarded-host': 'localhost',
          'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0) Mobile/15E148',
        },
        cookies: { admin_sid: 'valid-token' },
      })
      const res = await middleware(req)
      // orders are not in isAdminWritePath pattern, so it passes through
      expect(res.status).not.toBe(307)
    })
  })

  // -------------------------------------------------------------------------
  // isMobileUA — null UA
  // -------------------------------------------------------------------------
  describe('isMobileUA null user-agent', () => {
    it('does not redirect when user-agent header is absent on an admin write path', async () => {
      mockVerifyToken.mockResolvedValue(ADMIN_PAYLOAD)

      // No user-agent header → isMobileUA returns false → no mobile redirect
      const req = makeNextRequest('http://localhost/admin/products/edit/abc', {
        headers: { 'x-forwarded-host': 'localhost' },
        cookies: { admin_sid: 'valid-token' },
      })
      const res = await middleware(req)
      expect(res.status).not.toBe(307)
    })
  })

  // -------------------------------------------------------------------------
  // buildRedirectUrl — x-forwarded-proto / x-forwarded-host usage
  // -------------------------------------------------------------------------
  describe('buildRedirectUrl — forwarded headers', () => {
    it('uses x-forwarded-host and x-forwarded-proto when building redirect URL', async () => {
      // No token — triggers redirect to /login. The redirect URL should use the forwarded host/proto.
      const req = makeNextRequest('http://localhost/dashboard', {
        headers: {
          'x-forwarded-host': 'admin.jeffistores.in',
          'x-forwarded-proto': 'https',
        },
      })
      const res = await middleware(req)
      expect(res.status).toBe(307)
      const loc = res.headers.get('location') ?? ''
      expect(loc).toContain('admin.jeffistores.in')
    })
  })
})
