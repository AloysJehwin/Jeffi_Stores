import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const { mockVerifyToken, mockRevokeSession, mockRevokeAll } = vi.hoisted(() => ({
  mockVerifyToken: vi.fn().mockResolvedValue(null),
  mockRevokeSession: vi.fn().mockResolvedValue(undefined),
  mockRevokeAll: vi.fn().mockResolvedValue(1),
}))

vi.mock('next/headers', () => ({
  cookies: vi.fn(),
}))
vi.mock('@/lib/auth/cookie-domain', () => ({
  cookieDomainOption: vi.fn().mockReturnValue({ domain: '.jeffistores.in' }),
}))
// Opaque sessions: the route resolves the admin_sid cookie via verifyToken and
// revokes the server-side session before clearing the cookie.
vi.mock('@/lib/auth/jwt', () => ({
  verifyToken: mockVerifyToken,
}))
vi.mock('@/lib/auth/auth-sessions', () => ({
  revokeSession: mockRevokeSession,
  revokeAllForPrincipal: mockRevokeAll,
}))

import { POST } from '@/app/api/(admin)/admin/logout/route'
import { cookies } from 'next/headers'

const mockCookies = vi.mocked(cookies)

function makeSetFn() {
  return vi.fn()
}

describe('POST /api/admin/logout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockVerifyToken.mockResolvedValue(null)
    mockRevokeSession.mockResolvedValue(undefined)
  })

  it('clears admin_sid cookie and returns logged out message', async () => {
    const setCookie = makeSetFn()
    mockCookies.mockResolvedValue({ set: setCookie, get: vi.fn().mockReturnValue(undefined) } as any)

    const res = await POST()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.message).toMatch(/logged out/i)
    expect(setCookie).toHaveBeenCalledTimes(2)
  })

  it('sets cookie with maxAge=0 to expire it', async () => {
    const setCookie = makeSetFn()
    mockCookies.mockResolvedValue({ set: setCookie, get: vi.fn().mockReturnValue(undefined) } as any)

    await POST()
    const firstCall = setCookie.mock.calls[0]
    expect(firstCall[0]).toBe('admin_sid')
    expect(firstCall[1]).toBe('')
    expect(firstCall[2]).toMatchObject({ maxAge: 0, httpOnly: true })
  })

  it('sets Set-Cookie header on response', async () => {
    const setCookie = makeSetFn()
    mockCookies.mockResolvedValue({ set: setCookie, get: vi.fn().mockReturnValue(undefined) } as any)

    const res = await POST()
    const setCookieHeader = res.headers.get('Set-Cookie')
    expect(setCookieHeader).toContain('admin_sid=')
    expect(setCookieHeader).toContain('Max-Age=0')
  })

  it('ends every session of the admin behind the admin_sid cookie', async () => {
    const setCookie = makeSetFn()
    const get = vi.fn().mockReturnValue({ value: 'cookie-sid' })
    mockCookies.mockResolvedValue({ set: setCookie, get } as any)
    mockVerifyToken.mockResolvedValue({ adminId: 'admin-1', sid: 'admin-sid', role: 'admin', scopes: [] })

    const res = await POST()
    expect(res.status).toBe(200)
    expect(mockVerifyToken).toHaveBeenCalledWith('cookie-sid')
    expect(mockRevokeAll).toHaveBeenCalledWith('admin', 'admin-1')
    expect(mockRevokeSession).not.toHaveBeenCalled()
    expect(setCookie).toHaveBeenCalled()
  })

  it('returns 500 on unexpected error', async () => {
    mockCookies.mockRejectedValue(new Error('unexpected'))

    const res = await POST()
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/internal server error/i)
  })
})

it('handles verifyToken throwing without crashing (best-effort revoke)', async () => {
  const setCookie = makeSetFn()
  const get = vi.fn().mockReturnValue({ value: 'bad-token' })
  mockCookies.mockResolvedValue({ set: setCookie, get } as any)
  mockVerifyToken.mockRejectedValue(new Error('bad token'))
  const res = await POST()
  expect(res.status).toBe(200)
  expect(mockRevokeSession).not.toHaveBeenCalled()
})

it('does not revoke when payload has no sid', async () => {
  const setCookie = makeSetFn()
  const get = vi.fn().mockReturnValue({ value: 'cookie-val' })
  mockCookies.mockResolvedValue({ set: setCookie, get } as any)
  mockVerifyToken.mockResolvedValue({ adminId: 'a1', role: 'admin', scopes: [] } as any)
  const res = await POST()
  expect(res.status).toBe(200)
  expect(mockRevokeSession).not.toHaveBeenCalled()
})
