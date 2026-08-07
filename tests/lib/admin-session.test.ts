import { describe, it, expect, vi, beforeEach } from 'vitest'

// issueAdminSession no longer signs a JWT. It creates an opaque server-side session via
// createSession() and sets the admin_sid cookie to the returned session id (sid).
vi.mock('@/lib/auth-sessions', () => ({
  createSession: vi.fn(),
}))

vi.mock('@/lib/jwt', () => ({
  JWT_MAX_AGE_S: 28800,
}))

vi.mock('@/lib/cookie-domain', () => ({
  cookieDomainOption: vi.fn().mockReturnValue({}),
}))

vi.mock('next/server', () => {
  const mockSet = vi.fn()
  const MockNextResponse = {
    json: vi.fn().mockImplementation((body: unknown) => ({
      body,
      cookies: { set: mockSet },
      _mockCookieSet: mockSet,
    })),
  }
  return { NextResponse: MockNextResponse }
})

import { issueAdminSession } from '@/lib/admin-session'
import { createSession } from '@/lib/auth-sessions'
import { NextResponse } from 'next/server'

const mockCreateSession = vi.mocked(createSession)

describe('issueAdminSession', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCreateSession.mockResolvedValue({ sid: 'fake-uuid', expiresAt: '2099-01-01T00:00:00.000Z' })
  })

  it('creates an opaque admin session with the admin fields', async () => {
    const admin = {
      id: 'admin-1',
      email: 'alice@example.com',
      first_name: 'Alice',
      last_name: 'Smith',
      role: 'superadmin',
      scopes: ['read', 'write'],
    }
    await issueAdminSession(admin)
    expect(mockCreateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        principalType: 'admin',
        principalId: 'admin-1',
        role: 'superadmin',
        scopes: ['read', 'write'],
        ttlSeconds: 28800,
      })
    )
  })

  it('sets admin_sid cookie to the returned session id', async () => {
    const admin = { id: 'admin-2', email: 'bob@example.com', role: 'admin', scopes: null }
    const response = await issueAdminSession(admin)
    const mockSet = (response as any)._mockCookieSet ?? (response.cookies as any).set
    expect(mockSet).toHaveBeenCalledWith(
      'admin_sid',
      'fake-uuid',
      expect.objectContaining({ httpOnly: true, path: '/', sameSite: 'strict', maxAge: 28800 })
    )
  })

  it('returns NextResponse.json with success:true', async () => {
    const admin = { id: 'a1', email: 'test@example.com', role: 'admin', scopes: [] }
    const response = await issueAdminSession(admin)
    expect(NextResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true })
    )
    expect(response).toBeDefined()
  })

  it('snapshots certCN onto the session when provided', async () => {
    const admin = { id: 'a1', email: 'test@example.com', role: 'admin', scopes: [] }
    await issueAdminSession(admin, 'client-cert-cn')
    expect(mockCreateSession).toHaveBeenCalledWith(
      expect.objectContaining({ certCN: 'client-cert-cn' })
    )
  })

  it('merges extraBody into response body', async () => {
    const admin = { id: 'a1', email: 'test@example.com', role: 'admin', scopes: [] }
    await issueAdminSession(admin, undefined, { redirectTo: '/dashboard' })
    expect(NextResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({ redirectTo: '/dashboard' })
    )
  })

  it('handles null scopes by defaulting to empty array', async () => {
    const admin = { id: 'a1', email: 'test@example.com', role: 'admin', scopes: null }
    await issueAdminSession(admin)
    expect(mockCreateSession).toHaveBeenCalledWith(
      expect.objectContaining({ scopes: [] })
    )
  })
})
