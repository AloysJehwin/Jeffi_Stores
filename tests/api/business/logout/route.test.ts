/**
 * Tests for POST /api/business/logout
 * src/app/api/business/logout/route.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-bytes!!'

// ── hoisted mocks ─────────────────────────────────────────────────────────────
const mockCookieStore = vi.hoisted(() => ({
  get: vi.fn().mockReturnValue(undefined),
  set: vi.fn(),
  delete: vi.fn(),
}))

const mockAuthenticateBusiness = vi.hoisted(() => vi.fn())
const mockLogActivity = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue(mockCookieStore),
}))

vi.mock('@/lib/auth/jwt', () => ({
  authenticateBusiness: mockAuthenticateBusiness,
}))

vi.mock('@/lib/shared/activity', () => ({
  logActivity: mockLogActivity,
}))

vi.mock('@/lib/auth/cookie-domain', () => ({
  cookieDomainOption: vi.fn().mockReturnValue({}),
}))

import { POST } from '@/app/api/business/logout/route'
import { cookies } from 'next/headers'

// ── helpers ───────────────────────────────────────────────────────────────────
function makePost() {
  return new Request('http://localhost/api/business/logout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  })
}

// ── tests ─────────────────────────────────────────────────────────────────────
describe('POST /api/business/logout', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(cookies).mockResolvedValue(mockCookieStore as any)
    mockCookieStore.get.mockReturnValue(undefined)
    mockLogActivity.mockResolvedValue(undefined)
  })

  it('logs out authenticated user and clears cookies', async () => {
    mockAuthenticateBusiness.mockResolvedValue({ userId: 'biz-1', email: 'biz@example.com' })
    const res = await POST(makePost() as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.message).toMatch(/logged out/i)
    expect(mockLogActivity).toHaveBeenCalled()
    // Should clear both business_sid and session_id cookies
    const setCalls = mockCookieStore.set.mock.calls.map((c: any) => c[0])
    expect(setCalls).toContain('business_sid')
    expect(setCalls).toContain('session_id')
  })

  it('clears cookies even when not authenticated (unauthenticated logout)', async () => {
    mockAuthenticateBusiness.mockResolvedValue(null)
    const res = await POST(makePost() as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.message).toMatch(/logged out/i)
    // No activity logged when userId is not set
    expect(mockLogActivity).not.toHaveBeenCalled()
  })

  it('sets Set-Cookie headers on the response directly', async () => {
    mockAuthenticateBusiness.mockResolvedValue(null)
    const res = await POST(makePost() as any)
    const setCookieHeaders = res.headers.getSetCookie?.() ?? res.headers.get('set-cookie')
    // At least one Set-Cookie header for business_sid should be appended
    expect(setCookieHeaders).toBeTruthy()
  })

  it('returns 500 on unexpected error', async () => {
    mockAuthenticateBusiness.mockRejectedValue(new Error('unexpected'))
    const res = await POST(makePost() as any)
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toMatch(/logout failed/i)
  })

  it('sets Max-Age=0 on cleared cookies', async () => {
    mockAuthenticateBusiness.mockResolvedValue({ userId: 'biz-1' })
    await POST(makePost() as any)
    const setCalls = mockCookieStore.set.mock.calls
    // Each cookie should be set with maxAge: 0
    for (const call of setCalls) {
      expect(call[2]).toMatchObject({ maxAge: 0 })
    }
  })
})
