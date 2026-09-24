import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks (must precede imports) ───────────────────────────────────────────
// Opaque sessions: the route resolves the admin_sid cookie via resolveSession()
// (NOT verifyToken/JWT) and returns expiresAt from the session row. It also passes
// the request User-Agent so a cookie replayed from a different browser is rejected.

vi.mock('@/lib/auth-sessions', () => ({
  resolveSession: vi.fn(),
}))
vi.mock('next/headers', () => ({
  cookies: vi.fn(),
}))

// ── Imports ────────────────────────────────────────────────────────────────

import { GET } from '@/app/api/admin/check-session/route'
import { resolveSession } from '@/lib/auth-sessions'
import { cookies } from 'next/headers'

// ── Helpers ────────────────────────────────────────────────────────────────

function makeReq(host = 'admin.example.com', ua = 'Chrome', certHeaders: Record<string, string> = {}) {
  const url = `http://${host}/api/admin/check-session`
  return new NextRequest(url, {
    method: 'GET',
    headers: new Headers({ host, 'user-agent': ua, ...certHeaders }),
  })
}

const mockResolveSession = vi.mocked(resolveSession)
const mockCookies = vi.mocked(cookies)

function setCookieToken(value: string | null) {
  mockCookies.mockReturnValue({
    get: (name: string) => (name === 'admin_sid' && value ? { value } : undefined),
  } as any)
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('GET /api/admin/check-session', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  // ── No token ─────────────────────────────────────────────────────────────

  it('returns authenticated:false when no token cookie', async () => {
    setCookieToken(null)
    const res = await GET(makeReq())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.authenticated).toBe(false)
    expect(body.expiresAt).toBeNull()
  })

  it('sets x-cert-status to valid when a verified cert identity is present', async () => {
    setCookieToken(null)
    const res = await GET(makeReq('admin.jeffistores.com', 'Chrome', { 'x-client-cert-serial': 'AB12' }))
    expect(res.headers.get('x-cert-status')).toBe('valid')
  })

  it('sets x-cert-status to valid for a tenant admin host verified by middleware', async () => {
    setCookieToken(null)
    const res = await GET(makeReq('admin-acme.jeffistores.com', 'Chrome', { 'x-client-cert-cn': 'owner@acme.test' }))
    expect(res.headers.get('x-cert-status')).toBe('valid')
  })

  it('does not claim valid on an admin host with no verified cert', async () => {
    setCookieToken(null)
    const res = await GET(makeReq('admin.jeffistores.com'))
    expect(res.headers.get('x-cert-status')).toBe('missing')
  })

  it('sets x-cert-status to development on localhost', async () => {
    setCookieToken(null)
    const res = await GET(makeReq('localhost:3000'))
    expect(res.headers.get('x-cert-status')).toBe('development')
  })

  it('sets x-cert-status to missing on other hosts', async () => {
    setCookieToken(null)
    const res = await GET(makeReq('www.example.com'))
    expect(res.headers.get('x-cert-status')).toBe('missing')
  })

  // ── Invalid / non-resolving session ────────────────────────────────────────

  it('returns authenticated:false when the session does not resolve', async () => {
    setCookieToken('bad-sid')
    mockResolveSession.mockResolvedValue(null)
    const res = await GET(makeReq())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.authenticated).toBe(false)
    expect(body.expiresAt).toBeNull()
  })

  it('returns authenticated:false when the resolved principal is not an admin', async () => {
    setCookieToken('customer-sid')
    mockResolveSession.mockResolvedValue({
      sid: 'customer-sid', principalType: 'customer', principalId: 'u1',
      role: null, scopes: [], certCN: null, approvalStatus: null,
      email: 'u@x.com', displayName: 'U', expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    } as any)
    const res = await GET(makeReq())
    const body = await res.json()
    expect(body.authenticated).toBe(false)
  })

  // ── Valid admin session ─────────────────────────────────────────────────────

  it('returns authenticated:true with expiresAt (epoch ms) from the session row', async () => {
    setCookieToken('valid-sid')
    const expIso = new Date(Date.now() + 3600_000).toISOString()
    mockResolveSession.mockResolvedValue({
      sid: 'valid-sid', principalType: 'admin', principalId: 'admin-1',
      role: 'super_admin', scopes: ['*'], certCN: null, approvalStatus: null,
      email: 'a@x.com', displayName: 'A', expiresAt: expIso,
    } as any)
    const res = await GET(makeReq())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.authenticated).toBe(true)
    expect(body.expiresAt).toBe(new Date(expIso).getTime())
    expect(body.user).toBeDefined()
    expect(body.user.adminId).toBe('admin-1')
  })

  // ── Device binding: mismatch → session rejected ─────────────────────────────

  it('passes the request device-binding signals into resolveSession (device binding)', async () => {
    setCookieToken('valid-sid')
    mockResolveSession.mockResolvedValue(null) // resolveSession revokes+returns null on a clear mismatch
    await GET(makeReq('admin.example.com', 'Safari/iOS'))
    expect(mockResolveSession).toHaveBeenCalledWith(
      'valid-sid',
      expect.objectContaining({ userAgent: 'Safari/iOS' }),
      { touch: false }
    )
  })

  // ── Error handling ───────────────────────────────────────────────────────

  it('returns authenticated:false on unexpected error', async () => {
    mockCookies.mockImplementation(() => { throw new Error('cookie error') })
    const res = await GET(makeReq())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.authenticated).toBe(false)
  })
})
