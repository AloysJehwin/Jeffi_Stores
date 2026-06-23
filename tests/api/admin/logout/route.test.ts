import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('next/headers', () => ({
  cookies: vi.fn(),
}))
vi.mock('@/lib/cookie-domain', () => ({
  cookieDomainOption: vi.fn().mockReturnValue({ domain: '.jeffistores.in' }),
}))

import { POST } from '@/app/api/admin/logout/route'
import { cookies } from 'next/headers'

const mockCookies = vi.mocked(cookies)

function makeSetFn() {
  return vi.fn()
}

describe('POST /api/admin/logout', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('clears admin_token cookie and returns logged out message', async () => {
    const setCookie = makeSetFn()
    mockCookies.mockResolvedValue({ set: setCookie } as any)

    const res = await POST()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.message).toMatch(/logged out/i)
    expect(setCookie).toHaveBeenCalledTimes(2)
  })

  it('sets cookie with maxAge=0 to expire it', async () => {
    const setCookie = makeSetFn()
    mockCookies.mockResolvedValue({ set: setCookie } as any)

    await POST()
    const firstCall = setCookie.mock.calls[0]
    expect(firstCall[0]).toBe('admin_token')
    expect(firstCall[1]).toBe('')
    expect(firstCall[2]).toMatchObject({ maxAge: 0, httpOnly: true })
  })

  it('sets Set-Cookie header on response', async () => {
    const setCookie = makeSetFn()
    mockCookies.mockResolvedValue({ set: setCookie } as any)

    const res = await POST()
    const setCookieHeader = res.headers.get('Set-Cookie')
    expect(setCookieHeader).toContain('admin_token=')
    expect(setCookieHeader).toContain('Max-Age=0')
  })

  it('returns 500 on unexpected error', async () => {
    mockCookies.mockRejectedValue(new Error('unexpected'))

    const res = await POST()
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/internal server error/i)
  })
})
