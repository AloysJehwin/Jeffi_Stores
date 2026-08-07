import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/jwt', () => ({
  authenticateAdmin: vi.fn(),
  JWT_MAX_AGE_S: 28800,
}))

vi.mock('@/lib/auth-sessions', () => ({
  extendSession: vi.fn(),
}))

vi.mock('@/lib/cookie-domain', () => ({
  cookieDomainOption: vi.fn().mockReturnValue({}),
}))

import { POST } from '@/app/api/admin/refresh/route'
import { authenticateAdmin, JWT_MAX_AGE_S } from '@/lib/jwt'
import { extendSession } from '@/lib/auth-sessions'

const mockAuth = vi.mocked(authenticateAdmin)
const mockExtend = vi.mocked(extendSession)

const admin = {
  adminId: 'a1',
  role: 'super_admin',
  scopes: ['products'],
  sid: 'session-uuid',
}

function makeReq() {
  return new NextRequest('http://localhost/api/admin/refresh', { method: 'POST' })
}

beforeEach(() => { vi.clearAllMocks() })

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

  it('slides the session expiry and re-sets the cookie to the same sid on happy path', async () => {
    mockAuth.mockResolvedValue(admin as any)
    mockExtend.mockResolvedValue(undefined)
    const res = await POST(makeReq())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(mockExtend).toHaveBeenCalledWith('session-uuid', JWT_MAX_AGE_S)
    expect(res.cookies.get('admin_sid')?.value).toBe('session-uuid')
  })
})
