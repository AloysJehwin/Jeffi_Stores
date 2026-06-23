import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/jwt', () => ({
  authenticateAdmin: vi.fn(),
}))

import { GET } from '@/app/api/admin/token/route'
import { authenticateAdmin } from '@/lib/jwt'

const mockAuth = vi.mocked(authenticateAdmin)

const admin = { adminId: 'a1', username: 'admin', role: 'super_admin', scopes: [] }

// NextRequest cookie parsing may not work in happy-dom — stub cookies.get directly
function makeReq(cookies: Record<string, string> = {}) {
  const req = new NextRequest('http://localhost/api/admin/token')
  const cookieStore = new Map(Object.entries(cookies))
  Object.defineProperty(req, 'cookies', {
    value: { get: (name: string) => cookieStore.has(name) ? { value: cookieStore.get(name) } : undefined },
    writable: false,
  })
  return req
}

beforeEach(() => { vi.clearAllMocks() })

describe('GET /api/admin/token', () => {
  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await GET(makeReq())
    expect(res.status).toBe(401)
  })

  it('returns 404 when no admin_token cookie', async () => {
    mockAuth.mockResolvedValue(admin)
    const res = await GET(makeReq())
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toMatch(/session token/i)
  })

  it('returns token when admin_token cookie present', async () => {
    mockAuth.mockResolvedValue(admin)
    const res = await GET(makeReq({ admin_token: 'my-jwt' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.token).toBe('my-jwt')
  })
})
