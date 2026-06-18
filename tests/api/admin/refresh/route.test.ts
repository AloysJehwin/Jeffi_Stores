import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/jwt', () => ({
  authenticateAdmin: vi.fn(),
  generateToken: vi.fn(),
  JWT_MAX_AGE_S: 28800,
}))

vi.mock('@/lib/cookie-domain', () => ({
  cookieDomainOption: vi.fn().mockReturnValue({}),
}))

import { POST } from '@/app/api/admin/refresh/route'
import { authenticateAdmin, generateToken } from '@/lib/jwt'

const mockAuth = vi.mocked(authenticateAdmin)
const mockGenToken = vi.mocked(generateToken)

const admin = {
  adminId: 'a1',
  username: 'admin',
  first_name: 'Test',
  last_name: 'Admin',
  role: 'super_admin',
  scopes: ['products'],
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

  it('generates new token and sets cookie on happy path', async () => {
    mockAuth.mockResolvedValue(admin)
    mockGenToken.mockResolvedValue('new-jwt-token')
    const res = await POST(makeReq())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(mockGenToken).toHaveBeenCalledWith(expect.objectContaining({ adminId: 'a1' }))
  })
})
