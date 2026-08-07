import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const { mockVerifyToken, mockRevokeSession } = vi.hoisted(() => ({
  mockVerifyToken: vi.fn().mockResolvedValue(null),
  mockRevokeSession: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('next/headers', () => ({
  cookies: vi.fn(),
}))
vi.mock('@/lib/cookie-domain', () => ({
  cookieDomainOption: vi.fn().mockReturnValue({ domain: '.jeffistores.in' }),
}))
// Opaque sessions: the route resolves the admin_sid cookie via verifyToken and
// revokes the server-side session before clearing the cookie.
vi.mock('@/lib/jwt', () => ({
  verifyToken: mockVerifyToken,
}))
vi.mock('@/lib/auth-sessions', () => ({
  revokeSession: mockRevokeSession,
}))

import { POST } from '@/app/api/admin/logout/route'
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

  it('revokes the server-side session for the admin_sid cookie sid', async () => {
    const setCookie = makeSetFn()
    const get = vi.fn().mockReturnValue({ value: 'cookie-sid' })
    mockCookies.mockResolvedValue({ set: setCookie, get } as any)
    mockVerifyToken.mockResolvedValue({ adminId: 'admin-1', sid: 'admin-sid', role: 'admin', scopes: [] })

    const res = await POST()
    expect(res.status).toBe(200)
    expect(mockVerifyToken).toHaveBeenCalledWith('cookie-sid')
    expect(mockRevokeSession).toHaveBeenCalledWith('admin-sid')
    expect(setCookie).toHaveBeenCalled()
  })

  it('returns 500 on unexpected error', async () => {
    mockCookies.mockRejectedValue(new Error('unexpected'))

    const res = await POST()
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/internal server error/i)
  })
})
