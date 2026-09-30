import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({
  authenticateAdmin: vi.fn(),
  JWT_MAX_AGE_S: 28800,
}))

vi.mock('@/lib/auth/auth-sessions', () => ({
  extendSession: vi.fn(),
}))

vi.mock('@/lib/auth/cookie-domain', () => ({
  cookieDomainOption: vi.fn().mockReturnValue({}),
}))

import { POST } from '@/app/api/admin/refresh/route'
import { authenticateAdmin, JWT_MAX_AGE_S } from '@/lib/auth/jwt'
import { extendSession } from '@/lib/auth/auth-sessions'

const mockAuth = vi.mocked(authenticateAdmin)
const mockExtend = vi.mocked(extendSession)

const admin = {
  adminId: 'a1',
  role: 'super_admin',
  scopes: ['products'],
  // Opaque session token (64-hex), NOT the row uuid — this is the cookie value now.
  sid: 'b'.repeat(64),
}

function makeReq() {
  return new NextRequest('http://localhost/api/admin/refresh', { method: 'POST' })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('POST /api/admin/refresh', () => {
  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await POST(makeReq())
    expect(res.status).toBe(401)
  })

  it('returns 401 when the session has no sid', async () => {
    mockAuth.mockResolvedValue({ adminId: 'a1', role: 'admin', scopes: [] } as any)
    const res = await POST(makeReq())
    expect(res.status).toBe(401)
  })

  it('slides the session expiry and re-sets the cookie to the same token on happy path', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockExtend.mockResolvedValue(undefined)
    const res = await POST(makeReq())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(mockExtend).toHaveBeenCalledWith('b'.repeat(64), JWT_MAX_AGE_S)
    expect(res.cookies.get('admin_sid')?.value).toBe('b'.repeat(64))
  })
})
