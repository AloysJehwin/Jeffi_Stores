// ── Set env BEFORE any imports so module-level guard doesn't throw ────────────
// vi.stubEnv is hoisted but runs after module evaluation; use process.env directly.
process.env.JWT_SECRET = 'test-secret-for-jwt-unit-tests-minimum-length'

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Hoist mock functions so vi.mock factory can reference them ────────────────
const { mockSign, mockJwtVerify } = vi.hoisted(() => ({
  mockSign: vi.fn(),
  mockJwtVerify: vi.fn(),
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
import {
  generateToken,
  verifyToken,
  authenticateAdmin,
  authenticateUser,
  authenticateBusiness,
  authenticateAnyUser,
  requireAdminScope,
  requireUserScope,
  JWT_EXPIRES_IN,
  JWT_MAX_AGE_S,
} from '@/lib/jwt'

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

describe('generateToken', () => {
  beforeEach(() => {
    mockSign.mockResolvedValue('signed.jwt.token')
  })

  it('returns the signed token string', async () => {
    const payload = { adminId: 'a1', username: 'alice', role: 'admin', scopes: [] }
    const token = await generateToken(payload)
    expect(token).toBe('signed.jwt.token')
  })

  it('calls sign with the provided payload', async () => {
    const payload = { adminId: 'a1', username: 'alice', role: 'super_admin', scopes: ['products'] }
    await generateToken(payload)
    expect(mockSign).toHaveBeenCalledWith(payload)
  })
})

// ─────────────────────────────────────────────────────────────────────────────

describe('verifyToken', () => {
  it('returns parsed payload on valid token', async () => {
    const fakePayload = { adminId: 'a1', username: 'alice', role: 'admin', scopes: [] }
    mockJwtVerify.mockResolvedValueOnce({ payload: fakePayload })
    const result = await verifyToken('valid.token')
    expect(result).toEqual(fakePayload)
  })

  it('returns null on expired token', async () => {
    mockJwtVerify.mockRejectedValueOnce(new Error('JWTExpired'))
    const result = await verifyToken('expired.token')
    expect(result).toBeNull()
  })

  it('returns null on tampered token', async () => {
    mockJwtVerify.mockRejectedValueOnce(new Error('JWSInvalid'))
    const result = await verifyToken('tampered.token')
    expect(result).toBeNull()
  })

  it('returns null on completely invalid token', async () => {
    mockJwtVerify.mockRejectedValueOnce(new Error('invalid'))
    const result = await verifyToken('not-a-jwt')
    expect(result).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────

describe('authenticateAdmin', () => {
  const validAdminPayload = {
    adminId: 'admin-123',
    username: 'bob',
    first_name: 'Bob',
    last_name: 'Smith',
    role: 'admin',
    scopes: ['products', 'orders'],
  }

  it('returns admin payload from Bearer header', async () => {
    mockJwtVerify.mockResolvedValueOnce({ payload: validAdminPayload })
    const req = makeRequest({ authHeader: 'Bearer sometoken' })
    const result = await authenticateAdmin(req)
    expect(result).toMatchObject({ adminId: 'admin-123', role: 'admin' })
  })

  it('returns admin payload from admin_token cookie', async () => {
    mockJwtVerify.mockResolvedValueOnce({ payload: validAdminPayload })
    const req = makeRequest({ cookies: { admin_token: 'cookietoken' } })
    const result = await authenticateAdmin(req)
    expect(result?.adminId).toBe('admin-123')
  })

  it('returns null when no token is present', async () => {
    const req = makeRequest({})
    const result = await authenticateAdmin(req)
    expect(result).toBeNull()
  })

  it('returns null when payload lacks adminId', async () => {
    mockJwtVerify.mockResolvedValueOnce({ payload: { username: 'bob', role: 'admin', scopes: [] } })
    const req = makeRequest({ authHeader: 'Bearer token' })
    const result = await authenticateAdmin(req)
    expect(result).toBeNull()
  })

  it('returns null on verification error', async () => {
    mockJwtVerify.mockRejectedValueOnce(new Error('JWTExpired'))
    const req = makeRequest({ authHeader: 'Bearer expired' })
    const result = await authenticateAdmin(req)
    expect(result).toBeNull()
  })

  it('includes scopes as empty array when not present in payload', async () => {
    mockJwtVerify.mockResolvedValueOnce({ payload: { adminId: 'a1', username: 'u', role: 'admin' } })
    const req = makeRequest({ authHeader: 'Bearer token' })
    const result = await authenticateAdmin(req)
    expect(result?.scopes).toEqual([])
  })

  it('Bearer header is case-insensitive', async () => {
    mockJwtVerify.mockResolvedValueOnce({ payload: validAdminPayload })
    const req = makeRequest({ authHeader: 'BEARER sometoken' })
    const result = await authenticateAdmin(req)
    expect(result?.adminId).toBe('admin-123')
  })
})

// ─────────────────────────────────────────────────────────────────────────────

describe('authenticateUser – customer portal isolation', () => {
  const validCustomerPayload = {
    userId: 'user-456',
    email: 'customer@example.com',
    type: 'customer',
    scopes: ['read'],
  }

  it('returns user payload for valid customer token in auth_token cookie', async () => {
    mockJwtVerify.mockResolvedValueOnce({ payload: validCustomerPayload })
    const req = makeRequest({ cookies: { auth_token: 'ctoken' } })
    const result = await authenticateUser(req)
    expect(result?.userId).toBe('user-456')
    expect(result?.email).toBe('customer@example.com')
  })

  it('returns null when type is business (portal isolation)', async () => {
    mockJwtVerify.mockResolvedValueOnce({ payload: { userId: 'u1', email: 'b@b.com', type: 'business' } })
    const req = makeRequest({ cookies: { auth_token: 'btoken' } })
    const result = await authenticateUser(req)
    expect(result).toBeNull()
  })

  it('returns null when type is admin (portal isolation)', async () => {
    mockJwtVerify.mockResolvedValueOnce({ payload: { userId: 'u1', email: 'a@a.com', type: 'admin' } })
    const req = makeRequest({ cookies: { auth_token: 'atoken' } })
    const result = await authenticateUser(req)
    expect(result).toBeNull()
  })

  it('returns null when payload has no userId', async () => {
    mockJwtVerify.mockResolvedValueOnce({ payload: { email: 'x@x.com', type: 'customer' } })
    const req = makeRequest({ cookies: { auth_token: 'token' } })
    const result = await authenticateUser(req)
    expect(result).toBeNull()
  })

  it('returns null when no token', async () => {
    const req = makeRequest({})
    const result = await authenticateUser(req)
    expect(result).toBeNull()
  })

  it('defaults scopes to empty array when absent', async () => {
    mockJwtVerify.mockResolvedValueOnce({ payload: { userId: 'u1', email: 'x@x.com', type: 'customer' } })
    const req = makeRequest({ cookies: { auth_token: 'token' } })
    const result = await authenticateUser(req)
    expect(result?.scopes).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────────────────────

describe('authenticateBusiness – business portal isolation', () => {
  const validBusinessPayload = {
    userId: 'biz-789',
    email: 'biz@company.com',
    type: 'business',
    isBusiness: true,
    approvalStatus: 'approved',
    scopes: [],
  }

  it('returns business payload from business_auth_token cookie', async () => {
    mockJwtVerify.mockResolvedValueOnce({ payload: validBusinessPayload })
    const req = makeRequest({ cookies: { business_auth_token: 'btoken' } })
    const result = await authenticateBusiness(req)
    expect(result?.userId).toBe('biz-789')
    expect(result?.isBusiness).toBe(true)
    expect(result?.approvalStatus).toBe('approved')
  })

  it('returns null when type is not business', async () => {
    mockJwtVerify.mockResolvedValueOnce({ payload: { userId: 'u1', email: 'x@x.com', type: 'customer', isBusiness: true } })
    const req = makeRequest({ cookies: { business_auth_token: 'token' } })
    const result = await authenticateBusiness(req)
    expect(result).toBeNull()
  })

  it('returns null when isBusiness flag is missing/false', async () => {
    mockJwtVerify.mockResolvedValueOnce({ payload: { userId: 'u1', email: 'x@x.com', type: 'business', isBusiness: false } })
    const req = makeRequest({ cookies: { business_auth_token: 'token' } })
    const result = await authenticateBusiness(req)
    expect(result).toBeNull()
  })

  it('returns null when no token', async () => {
    const req = makeRequest({})
    const result = await authenticateBusiness(req)
    expect(result).toBeNull()
  })

  it('returns null on verification error', async () => {
    mockJwtVerify.mockRejectedValueOnce(new Error('expired'))
    const req = makeRequest({ cookies: { business_auth_token: 'expired' } })
    const result = await authenticateBusiness(req)
    expect(result).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────

describe('authenticateAnyUser – portal routing', () => {
  const customerPayload = { userId: 'c1', email: 'c@c.com', type: 'customer', scopes: [] }
  const bizPayload = { userId: 'b1', email: 'b@b.com', type: 'business', isBusiness: true, scopes: [] }

  it('with x-auth-portal: business, only tries business_auth_token', async () => {
    mockJwtVerify.mockResolvedValueOnce({ payload: bizPayload })
    const req = makeRequest({
      headers: { 'x-auth-portal': 'business' },
      cookies: { business_auth_token: 'btoken' },
    })
    const result = await authenticateAnyUser(req)
    expect(result?.userId).toBe('b1')
    expect(mockJwtVerify).toHaveBeenCalledTimes(1)
  })

  it('without portal header, tries auth_token first and returns customer', async () => {
    mockJwtVerify.mockResolvedValueOnce({ payload: customerPayload })
    const req = makeRequest({ cookies: { auth_token: 'ctoken' } })
    const result = await authenticateAnyUser(req)
    expect(result?.userId).toBe('c1')
  })

  it('without portal header, falls back to business_auth_token if auth_token fails', async () => {
    // First call (authenticateUser) succeeds but wrong type → returns null
    mockJwtVerify.mockResolvedValueOnce({ payload: { userId: 'x', email: 'x@x.com', type: 'business' } })
    // Second call (authenticateBusiness)
    mockJwtVerify.mockResolvedValueOnce({ payload: bizPayload })
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
  const adminPayload = { adminId: 'a1', username: 'alice', role: 'admin', scopes: ['products'] }

  it('returns admin payload when scope is satisfied', async () => {
    mockJwtVerify.mockResolvedValueOnce({ payload: adminPayload })
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
    mockJwtVerify.mockResolvedValueOnce({ payload: adminPayload })
    const req = makeRequest({ authHeader: 'Bearer token' })
    const result = await requireAdminScope(req, 'settings') as any
    expect(result.status).toBe(403)
  })

  it('super_admin bypasses scope check', async () => {
    const superPayload = { ...adminPayload, role: 'super_admin' }
    mockJwtVerify.mockResolvedValueOnce({ payload: superPayload })
    const req = makeRequest({ authHeader: 'Bearer token' })
    const result = await requireAdminScope(req, 'settings')
    expect((result as any).role).toBe('super_admin')
  })

  it('returns admin when scope param is null (no scope check)', async () => {
    mockJwtVerify.mockResolvedValueOnce({ payload: adminPayload })
    const req = makeRequest({ authHeader: 'Bearer token' })
    const result = await requireAdminScope(req, null)
    expect((result as any).adminId).toBe('a1')
  })
})

// ─────────────────────────────────────────────────────────────────────────────

describe('requireUserScope', () => {
  const userPayload = { userId: 'u1', email: 'u@u.com', type: 'customer', scopes: ['read'] }

  it('returns user payload when scope is present', async () => {
    mockJwtVerify.mockResolvedValueOnce({ payload: userPayload })
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
    mockJwtVerify.mockResolvedValueOnce({ payload: userPayload })
    const req = makeRequest({ cookies: { auth_token: 'token' } })
    const result = await requireUserScope(req, 'write') as any
    expect(result.status).toBe(403)
  })
})
