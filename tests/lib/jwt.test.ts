// ── Set env BEFORE any imports so module-level guard doesn't throw ────────────
// vi.stubEnv is hoisted but runs after module evaluation; use process.env directly.
process.env.JWT_SECRET = 'test-secret-for-jwt-unit-tests-minimum-length'

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Hoist mock functions so vi.mock factory can reference them ────────────────
// mockSign/mockJwtVerify back the jose mock used by the still-stateless REVIEW tokens.
// mockResolveSession backs @/lib/auth-sessions — the opaque server-side session store
// that every authenticate*/verify* function now delegates to.
const { mockSign, mockJwtVerify, mockResolveSession } = vi.hoisted(() => ({
  mockSign: vi.fn(),
  mockJwtVerify: vi.fn(),
  mockResolveSession: vi.fn(),
}))

vi.mock('jose', () => {
  class SignJWT {
    private payload: Record<string, unknown>
    constructor(payload: Record<string, unknown>) {
      this.payload = payload
    }
    setProtectedHeader() { return this }
    setIssuedAt() { return this }
    setExpirationTime() { return this }
    async sign() { return mockSign(this.payload) }
  }
  return { SignJWT, jwtVerify: mockJwtVerify }
})

// ── Mock the opaque session store (single source of truth for auth) ───────────
vi.mock('@/lib/auth-sessions', () => ({
  resolveSession: mockResolveSession,
}))

// A helper that builds a ResolvedSession row for a given principal.
function resolved(overrides: Record<string, unknown>) {
  return {
    sid: 'sid-uuid',
    principalType: 'admin',
    principalId: 'p1',
    role: null,
    scopes: [],
    certCN: null,
    approvalStatus: null,
    email: null,
    displayName: null,
    ...overrides,
  }
}

// ── Mock next/server ─────────────────────────────────────────────────────────
vi.mock('next/server', () => ({
  NextResponse: {
    json: vi.fn((body: unknown, init?: { status?: number }) => ({
      _isNextResponse: true,
      body,
      status: init?.status ?? 200,
    })),
  },
}))

// ── Mock ./scopes ─────────────────────────────────────────────────────────────
vi.mock('@/lib/scopes', () => ({
  hasScope: vi.fn((role: string, scopes: string[], required: string) => {
    if (role === 'super_admin') return true
    return scopes.includes(required)
  }),
  getScopeForPath: vi.fn(),
}))

// ── Mock ./audit-context ──────────────────────────────────────────────────────
vi.mock('@/lib/audit-context', () => ({
  setAuditAdminId: vi.fn(),
}))

// ── Helpers ───────────────────────────────────────────────────────────────────
function makeRequest(opts: {
  authHeader?: string
  cookies?: Record<string, string>
  headers?: Record<string, string>
}) {
  const cookieStore = new Map(Object.entries(opts.cookies ?? {}))
  const headerStore = new Map<string, string>()
  if (opts.authHeader) headerStore.set('authorization', opts.authHeader)
  for (const [k, v] of Object.entries(opts.headers ?? {})) {
    headerStore.set(k.toLowerCase(), v)
  }
  return {
    headers: { get: (k: string) => headerStore.get(k.toLowerCase()) ?? null },
    cookies: { get: (name: string) => cookieStore.has(name) ? { value: cookieStore.get(name) } : undefined },
  } as any
}

// ── Import after mocks ────────────────────────────────────────────────────────
vi.mock('@/lib/db', () => ({ queryOne: vi.fn() }))
import * as dbMod from '@/lib/db'
const mockDbQueryOne = vi.mocked(dbMod.queryOne)

import {
  verifyToken,
  authenticateAdmin,
  authenticateUser,
  authenticateBusiness,
  authenticateAnyUser,
  requireAdminScope,
  requireUserScope,
  generateReviewToken,
  verifyReviewToken,
  verifyUserToken,
  verifyBusinessToken,
  authenticateServiceAccount,
  JWT_EXPIRES_IN,
  JWT_MAX_AGE_S,
} from '@/lib/jwt'

beforeEach(() => {
  vi.clearAllMocks()
})

// ─────────────────────────────────────────────────────────────────────────────

describe('jwt.ts – constants', () => {
  it('JWT_EXPIRES_IN is 8h', () => {
    expect(JWT_EXPIRES_IN).toBe('8h')
  })

  it('JWT_MAX_AGE_S equals 8 hours in seconds', () => {
    expect(JWT_MAX_AGE_S).toBe(8 * 60 * 60)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// verifyToken now resolves an opaque admin session id via resolveSession (no JWT).

describe('verifyToken – opaque admin session resolve', () => {
  it('maps a resolved admin session onto the admin payload', async () => {
    mockResolveSession.mockResolvedValueOnce(resolved({
      principalType: 'admin',
      principalId: 'admin-123',
      role: 'admin',
      scopes: ['products'],
      certCN: 'CN=bob',
      email: 'bob@example.com',
      sid: 'sid-abc',
    }))
    const result = await verifyToken('sid-abc')
    expect(result).toEqual({
      adminId: 'admin-123',
      email: 'bob@example.com',
      role: 'admin',
      scopes: ['products'],
      authCertCN: 'CN=bob',
      sid: 'sid-abc',
    })
  })

  it('returns null when the session does not resolve (invalid/expired/revoked)', async () => {
    mockResolveSession.mockResolvedValueOnce(null)
    const result = await verifyToken('not-a-live-session')
    expect(result).toBeNull()
  })

  it('returns null when the resolved principal is not an admin', async () => {
    mockResolveSession.mockResolvedValueOnce(resolved({ principalType: 'customer' }))
    const result = await verifyToken('customer-sid')
    expect(result).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────

describe('authenticateAdmin', () => {
  it('returns admin payload from Bearer header', async () => {
    mockResolveSession.mockResolvedValueOnce(resolved({
      principalType: 'admin', principalId: 'admin-123', role: 'admin', scopes: ['products', 'orders'],
    }))
    const req = makeRequest({ authHeader: 'Bearer sometoken' })
    const result = await authenticateAdmin(req)
    expect(result).toMatchObject({ adminId: 'admin-123', role: 'admin' })
  })

  it('returns admin payload from admin_token cookie', async () => {
    mockResolveSession.mockResolvedValueOnce(resolved({ principalType: 'admin', principalId: 'admin-123', role: 'admin' }))
    const req = makeRequest({ cookies: { admin_token: 'cookietoken' } })
    const result = await authenticateAdmin(req)
    expect(result?.adminId).toBe('admin-123')
  })

  it('exposes the session id (sid) on the payload', async () => {
    mockResolveSession.mockResolvedValueOnce(resolved({ principalType: 'admin', principalId: 'admin-123', sid: 'sid-xyz' }))
    const req = makeRequest({ cookies: { admin_token: 'sid-xyz' } })
    const result = await authenticateAdmin(req)
    expect(result?.sid).toBe('sid-xyz')
  })

  it('returns null when no token is present', async () => {
    const req = makeRequest({})
    const result = await authenticateAdmin(req)
    expect(result).toBeNull()
  })

  it('returns null when the session does not resolve', async () => {
    mockResolveSession.mockResolvedValueOnce(null)
    const req = makeRequest({ authHeader: 'Bearer token' })
    const result = await authenticateAdmin(req)
    expect(result).toBeNull()
  })

  it('returns null when the resolved principal is not an admin', async () => {
    mockResolveSession.mockResolvedValueOnce(resolved({ principalType: 'business' }))
    const req = makeRequest({ authHeader: 'Bearer token' })
    const result = await authenticateAdmin(req)
    expect(result).toBeNull()
  })

  it('includes scopes from the resolved session', async () => {
    mockResolveSession.mockResolvedValueOnce(resolved({ principalType: 'admin', principalId: 'a1', scopes: [] }))
    const req = makeRequest({ authHeader: 'Bearer token' })
    const result = await authenticateAdmin(req)
    expect(result?.scopes).toEqual([])
  })

  it('Bearer header is case-insensitive', async () => {
    mockResolveSession.mockResolvedValueOnce(resolved({ principalType: 'admin', principalId: 'admin-123', role: 'admin' }))
    const req = makeRequest({ authHeader: 'BEARER sometoken' })
    const result = await authenticateAdmin(req)
    expect(result?.adminId).toBe('admin-123')
  })
})

// ─────────────────────────────────────────────────────────────────────────────

describe('authenticateUser – customer portal isolation', () => {
  it('returns user payload for valid customer session in auth_token cookie', async () => {
    mockResolveSession.mockResolvedValueOnce(resolved({
      principalType: 'customer', principalId: 'user-456', email: 'customer@example.com', scopes: ['read'],
    }))
    const req = makeRequest({ cookies: { auth_token: 'ctoken' } })
    const result = await authenticateUser(req)
    expect(result?.userId).toBe('user-456')
    expect(result?.email).toBe('customer@example.com')
  })

  it('returns null when principal is business (portal isolation)', async () => {
    mockResolveSession.mockResolvedValueOnce(resolved({ principalType: 'business', principalId: 'u1' }))
    const req = makeRequest({ cookies: { auth_token: 'btoken' } })
    const result = await authenticateUser(req)
    expect(result).toBeNull()
  })

  it('returns null when principal is admin (portal isolation)', async () => {
    mockResolveSession.mockResolvedValueOnce(resolved({ principalType: 'admin', principalId: 'u1' }))
    const req = makeRequest({ cookies: { auth_token: 'atoken' } })
    const result = await authenticateUser(req)
    expect(result).toBeNull()
  })

  it('returns null when the session does not resolve', async () => {
    mockResolveSession.mockResolvedValueOnce(null)
    const req = makeRequest({ cookies: { auth_token: 'token' } })
    const result = await authenticateUser(req)
    expect(result).toBeNull()
  })

  it('returns null when no token', async () => {
    const req = makeRequest({})
    const result = await authenticateUser(req)
    expect(result).toBeNull()
  })

  it('carries scopes from the resolved session', async () => {
    mockResolveSession.mockResolvedValueOnce(resolved({ principalType: 'customer', principalId: 'u1', scopes: [] }))
    const req = makeRequest({ cookies: { auth_token: 'token' } })
    const result = await authenticateUser(req)
    expect(result?.scopes).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────────────────────

describe('authenticateBusiness – business portal isolation', () => {
  it('returns business payload from business_auth_token cookie', async () => {
    mockResolveSession.mockResolvedValueOnce(resolved({
      principalType: 'business', principalId: 'biz-789', email: 'biz@company.com', approvalStatus: 'approved', scopes: [],
    }))
    const req = makeRequest({ cookies: { business_auth_token: 'btoken' } })
    const result = await authenticateBusiness(req)
    expect(result?.userId).toBe('biz-789')
    expect(result?.isBusiness).toBe(true)
    expect(result?.approvalStatus).toBe('approved')
  })

  it('returns null when principal is not business', async () => {
    mockResolveSession.mockResolvedValueOnce(resolved({ principalType: 'customer', principalId: 'u1' }))
    const req = makeRequest({ cookies: { business_auth_token: 'token' } })
    const result = await authenticateBusiness(req)
    expect(result).toBeNull()
  })

  it('returns null when no token', async () => {
    const req = makeRequest({})
    const result = await authenticateBusiness(req)
    expect(result).toBeNull()
  })

  it('returns null when the session does not resolve', async () => {
    mockResolveSession.mockResolvedValueOnce(null)
    const req = makeRequest({ cookies: { business_auth_token: 'expired' } })
    const result = await authenticateBusiness(req)
    expect(result).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────

describe('authenticateAnyUser – portal routing', () => {
  it('with x-auth-portal: business, only tries business_auth_token', async () => {
    mockResolveSession.mockResolvedValueOnce(resolved({ principalType: 'business', principalId: 'b1', scopes: [] }))
    const req = makeRequest({
      headers: { 'x-auth-portal': 'business' },
      cookies: { business_auth_token: 'btoken' },
    })
    const result = await authenticateAnyUser(req)
    expect(result?.userId).toBe('b1')
    expect(mockResolveSession).toHaveBeenCalledTimes(1)
  })

  it('without portal header, tries auth_token first and returns customer', async () => {
    mockResolveSession.mockResolvedValueOnce(resolved({ principalType: 'customer', principalId: 'c1', scopes: [] }))
    const req = makeRequest({ cookies: { auth_token: 'ctoken' } })
    const result = await authenticateAnyUser(req)
    expect(result?.userId).toBe('c1')
  })

  it('without portal header, falls back to business_auth_token if auth_token is not a customer', async () => {
    // First resolve (authenticateUser via auth_token) → wrong type → null
    mockResolveSession.mockResolvedValueOnce(resolved({ principalType: 'business', principalId: 'x' }))
    // Second resolve (authenticateBusiness via business_auth_token) → business
    mockResolveSession.mockResolvedValueOnce(resolved({ principalType: 'business', principalId: 'b1', scopes: [] }))
    const req = makeRequest({
      cookies: { auth_token: 'bad', business_auth_token: 'btoken' },
    })
    const result = await authenticateAnyUser(req)
    expect(result?.userId).toBe('b1')
  })

  it('returns null when both tokens are absent', async () => {
    const req = makeRequest({})
    const result = await authenticateAnyUser(req)
    expect(result).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────

describe('requireAdminScope', () => {
  it('returns admin payload when scope is satisfied', async () => {
    mockResolveSession.mockResolvedValueOnce(resolved({ principalType: 'admin', principalId: 'a1', role: 'admin', scopes: ['products'] }))
    const req = makeRequest({ authHeader: 'Bearer token' })
    const result = await requireAdminScope(req, 'products')
    expect((result as any).adminId).toBe('a1')
  })

  it('returns 401 when no token', async () => {
    const req = makeRequest({})
    const result = await requireAdminScope(req, 'products') as any
    expect(result.status).toBe(401)
  })

  it('returns 403 when admin lacks required scope', async () => {
    mockResolveSession.mockResolvedValueOnce(resolved({ principalType: 'admin', principalId: 'a1', role: 'admin', scopes: ['products'] }))
    const req = makeRequest({ authHeader: 'Bearer token' })
    const result = await requireAdminScope(req, 'settings') as any
    expect(result.status).toBe(403)
  })

  it('super_admin bypasses scope check', async () => {
    mockResolveSession.mockResolvedValueOnce(resolved({ principalType: 'admin', principalId: 'a1', role: 'super_admin', scopes: ['products'] }))
    const req = makeRequest({ authHeader: 'Bearer token' })
    const result = await requireAdminScope(req, 'settings')
    expect((result as any).role).toBe('super_admin')
  })

  it('returns admin when scope param is null (no scope check)', async () => {
    mockResolveSession.mockResolvedValueOnce(resolved({ principalType: 'admin', principalId: 'a1', role: 'admin', scopes: ['products'] }))
    const req = makeRequest({ authHeader: 'Bearer token' })
    const result = await requireAdminScope(req, null)
    expect((result as any).adminId).toBe('a1')
  })
})

// ─────────────────────────────────────────────────────────────────────────────

describe('requireUserScope', () => {
  it('returns user payload when scope is present', async () => {
    mockResolveSession.mockResolvedValueOnce(resolved({ principalType: 'customer', principalId: 'u1', scopes: ['read'] }))
    const req = makeRequest({ cookies: { auth_token: 'token' } })
    const result = await requireUserScope(req, 'read')
    expect((result as any).userId).toBe('u1')
  })

  it('returns 401 when no token', async () => {
    const req = makeRequest({})
    const result = await requireUserScope(req, 'read') as any
    expect(result.status).toBe(401)
  })

  it('returns 403 when user lacks required scope', async () => {
    mockResolveSession.mockResolvedValueOnce(resolved({ principalType: 'customer', principalId: 'u1', scopes: ['read'] }))
    const req = makeRequest({ cookies: { auth_token: 'token' } })
    const result = await requireUserScope(req, 'write') as any
    expect(result.status).toBe(403)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Review tokens are still stateless JWTs (jose) — unchanged by the opaque migration.

describe('generateReviewToken', () => {
  it('signs a review_token and returns the token string', async () => {
    mockSign.mockResolvedValue('review.jwt.token')
    const result = await generateReviewToken({ orderId: 'o1', productId: 'p1', userId: 'u1' })
    expect(result).toBe('review.jwt.token')
    expect(mockSign).toHaveBeenCalledWith(expect.objectContaining({ type: 'review_token', orderId: 'o1', productId: 'p1', userId: 'u1' }))
  })
})

// ─────────────────────────────────────────────────────────────────────────────

describe('verifyReviewToken', () => {
  it('returns payload for a valid review_token', async () => {
    mockJwtVerify.mockResolvedValueOnce({ payload: { type: 'review_token', orderId: 'o1', productId: 'p1', userId: 'u1' } })
    const result = await verifyReviewToken('valid.review.token')
    expect(result).toEqual({ orderId: 'o1', productId: 'p1', userId: 'u1' })
  })

  it('returns null when type is not review_token', async () => {
    mockJwtVerify.mockResolvedValueOnce({ payload: { type: 'customer', orderId: 'o1', productId: 'p1', userId: 'u1' } })
    const result = await verifyReviewToken('bad.token')
    expect(result).toBeNull()
  })

  it('returns null when orderId is missing', async () => {
    mockJwtVerify.mockResolvedValueOnce({ payload: { type: 'review_token', productId: 'p1', userId: 'u1' } })
    const result = await verifyReviewToken('bad.token')
    expect(result).toBeNull()
  })

  it('returns null when productId is missing', async () => {
    mockJwtVerify.mockResolvedValueOnce({ payload: { type: 'review_token', orderId: 'o1', userId: 'u1' } })
    const result = await verifyReviewToken('bad.token')
    expect(result).toBeNull()
  })

  it('returns null when userId is missing', async () => {
    mockJwtVerify.mockResolvedValueOnce({ payload: { type: 'review_token', orderId: 'o1', productId: 'p1' } })
    const result = await verifyReviewToken('bad.token')
    expect(result).toBeNull()
  })

  it('returns null on verification error', async () => {
    mockJwtVerify.mockRejectedValueOnce(new Error('expired'))
    const result = await verifyReviewToken('expired.token')
    expect(result).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────

describe('verifyUserToken – opaque customer session resolve', () => {
  it('returns user payload for a valid customer session', async () => {
    mockResolveSession.mockResolvedValueOnce(resolved({ principalType: 'customer', principalId: 'u1', email: 'u@u.com', scopes: ['read'], sid: 'sid-1' }))
    const result = await verifyUserToken('sid-1')
    expect(result?.userId).toBe('u1')
    expect(result?.scopes).toEqual(['read'])
  })

  it('returns null when principal is not customer', async () => {
    mockResolveSession.mockResolvedValueOnce(resolved({ principalType: 'business', principalId: 'u1' }))
    const result = await verifyUserToken('biz.sid')
    expect(result).toBeNull()
  })

  it('returns null when the session does not resolve', async () => {
    mockResolveSession.mockResolvedValueOnce(null)
    const result = await verifyUserToken('no-session')
    expect(result).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────

describe('verifyBusinessToken – opaque business session resolve', () => {
  it('returns business payload for a valid session', async () => {
    mockResolveSession.mockResolvedValueOnce(resolved({ principalType: 'business', principalId: 'b1', email: 'b@b.com', approvalStatus: 'approved', scopes: [], sid: 'sid-b' }))
    const result = await verifyBusinessToken('sid-b')
    expect(result?.userId).toBe('b1')
    expect(result?.isBusiness).toBe(true)
    expect(result?.approvalStatus).toBe('approved')
  })

  it('returns null when principal is not business', async () => {
    mockResolveSession.mockResolvedValueOnce(resolved({ principalType: 'customer', principalId: 'u1' }))
    const result = await verifyBusinessToken('customer.sid')
    expect(result).toBeNull()
  })

  it('defaults approvalStatus to pending (fail-closed) when the snapshot is absent', async () => {
    mockResolveSession.mockResolvedValueOnce(resolved({ principalType: 'business', principalId: 'b1', approvalStatus: null }))
    const result = await verifyBusinessToken('sid')
    expect(result?.approvalStatus).toBe('pending')
  })

  it('returns null when the session does not resolve', async () => {
    mockResolveSession.mockResolvedValueOnce(null)
    const result = await verifyBusinessToken('expired.sid')
    expect(result).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────

describe('authenticateServiceAccount', () => {
  it('returns null when x-client-cert-serial header is missing', async () => {
    const req = makeRequest({})
    const result = await authenticateServiceAccount(req)
    expect(result).toBeNull()
  })

  it('returns null when serial contains non-hex characters', async () => {
    const req = makeRequest({ headers: { 'x-client-cert-serial': 'ZZZZZZ' } })
    const result = await authenticateServiceAccount(req)
    expect(result).toBeNull()
  })

  it('returns null when no service account matches', async () => {
    mockDbQueryOne.mockResolvedValueOnce(null)
    const req = makeRequest({ headers: { 'x-client-cert-serial': 'DEADBEEF' } })
    const result = await authenticateServiceAccount(req)
    expect(result).toBeNull()
  })

  it('returns service account payload when serial matches', async () => {
    const sa = { id: 'sa-1', name: 'CI Bot', allowed_scopes: ['products:read'] }
    mockDbQueryOne.mockResolvedValueOnce(sa)
    mockDbQueryOne.mockResolvedValueOnce(null)
    const req = makeRequest({ headers: { 'x-client-cert-serial': 'DEADBEEF01' } })
    const result = await authenticateServiceAccount(req)
    expect(result).toEqual(sa)
  })
})
