import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks (must precede imports) ───────────────────────────────────────────

vi.mock('@/lib/jwt', () => ({
  authenticateAdmin: vi.fn(),
  verifyToken: vi.fn(),
}))
vi.mock('next/headers', () => ({
  cookies: vi.fn(),
}))

// ── Imports ────────────────────────────────────────────────────────────────

import { GET } from '@/app/api/admin/check-session/route'
import { verifyToken } from '@/lib/jwt'
import { cookies } from 'next/headers'

// ── Helpers ────────────────────────────────────────────────────────────────

function makeReq(host = 'admin.example.com') {
  const url = `http://${host}/api/admin/check-session`
  return new NextRequest(url, {
    method: 'GET',
    headers: new Headers({ host }),
  })
}

const mockVerifyToken = vi.mocked(verifyToken)
const mockCookies = vi.mocked(cookies)

function setCookieToken(value: string | null) {
  mockCookies.mockReturnValue({
    get: (name: string) => (name === 'admin_token' && value ? { value } : undefined),
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

  it('sets x-cert-status to valid on admin subdomain', async () => {
    setCookieToken(null)
    const res = await GET(makeReq('admin.jeffistores.com'))
    expect(res.headers.get('x-cert-status')).toBe('valid')
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

  // ── Invalid token ────────────────────────────────────────────────────────

  it('returns authenticated:false when token verification fails', async () => {
    setCookieToken('bad-token')
    mockVerifyToken.mockResolvedValue(null)
    const res = await GET(makeReq())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.authenticated).toBe(false)
    expect(body.expiresAt).toBeNull()
  })

  // ── Valid token ───────────────────────────────────────────────────────────

  it('returns authenticated:true with expiresAt when token is valid', async () => {
    setCookieToken('valid-token')
    const expSeconds = Math.floor(Date.now() / 1000) + 3600
    mockVerifyToken.mockResolvedValue({ exp: expSeconds, adminId: 'admin-1', role: 'super_admin' } as any)
    const res = await GET(makeReq())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.authenticated).toBe(true)
    expect(body.expiresAt).toBe(expSeconds * 1000)
    expect(body.user).toBeDefined()
  })

  it('returns expiresAt:null when payload has no exp', async () => {
    setCookieToken('valid-token')
    mockVerifyToken.mockResolvedValue({ adminId: 'admin-1', role: 'super_admin' } as any)
    const res = await GET(makeReq())
    const body = await res.json()
    expect(body.authenticated).toBe(true)
    expect(body.expiresAt).toBeNull()
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
