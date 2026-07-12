import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('jose', () => ({
  SignJWT: class {
    setProtectedHeader() { return this }
    setIssuedAt() { return this }
    setExpirationTime() { return this }
    async sign() { return 'mock-jwt-token' }
  },
}))

import { POST } from '@/app/api/admin/token/generate/route'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'

const ADMIN = {
  adminId: 'a1',
  username: 'admin',
  first_name: 'Test',
  last_name: 'Admin',
  role: 'super_admin',
  scopes: ['orders', 'inventory', 'products'],
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
  vi.mocked(hasScope).mockReturnValue(true)
})

function makeReq(body?: unknown) {
  return new NextRequest('http://localhost/api/admin/token/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}

describe('POST /api/admin/token/generate', () => {
  it('returns 401 when unauthenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    const res = await POST(makeReq())
    expect(res.status).toBe(401)
  })

  it('returns token on happy path with no body', async () => {
    const req = new NextRequest('http://localhost/api/admin/token/generate', { method: 'POST' })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.token).toBe('mock-jwt-token')
    expect(body.expires_at).toBeTruthy()
    expect(Array.isArray(body.scopes)).toBe(true)
  })

  it('returns token with default scopes when no scopes requested', async () => {
    const res = await POST(makeReq({ ttl: 1800 }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.token).toBe('mock-jwt-token')
  })

  it('filters requested scopes through hasScope', async () => {
    vi.mocked(hasScope).mockImplementation((_role, _scopes, s) => s === 'orders')
    const res = await POST(makeReq({ scopes: ['orders', 'inventory'] }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.scopes).toEqual(['orders'])
  })

  it('clamps ttl to MAX_TTL (86400)', async () => {
    const res = await POST(makeReq({ ttl: 999999 }))
    expect(res.status).toBe(200)
  })

  it('clamps ttl to minimum 60', async () => {
    const res = await POST(makeReq({ ttl: 1 }))
    expect(res.status).toBe(200)
  })

  it('handles malformed JSON body gracefully', async () => {
    const req = new NextRequest('http://localhost/api/admin/token/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
  })
})
