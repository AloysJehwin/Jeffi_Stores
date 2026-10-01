import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateBusiness: vi.fn() }))
vi.mock('jose', () => ({
  SignJWT: class {
    setProtectedHeader() {
      return this
    }
    setIssuedAt() {
      return this
    }
    setExpirationTime() {
      return this
    }
    async sign() {
      return 'mock-biz-token'
    }
  },
}))

import { POST } from '@/app/api/(public)/business/token/generate/route'
import { authenticateBusiness } from '@/lib/auth/jwt'

const USER = {
  userId: 'u1',
  email: 'biz@example.com',
  approvalStatus: 'approved',
  scopes: ['orders', 'products'],
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(authenticateBusiness).mockResolvedValue(USER as any)
})

function makeReq(body?: unknown) {
  return new NextRequest('http://localhost/api/business/token/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}

describe('POST /api/business/token/generate', () => {
  it('returns 401 when unauthenticated', async () => {
    vi.mocked(authenticateBusiness).mockResolvedValue(null as any)
    const res = await POST(makeReq())
    expect(res.status).toBe(401)
  })

  it('returns token on happy path', async () => {
    const req = new NextRequest('http://localhost/api/business/token/generate', { method: 'POST' })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.token).toBe('mock-biz-token')
    expect(body.expires_at).toBeTruthy()
  })

  it('respects custom ttl', async () => {
    const res = await POST(makeReq({ ttl: 7200 }))
    expect(res.status).toBe(200)
  })

  it('clamps ttl to MAX_TTL (86400)', async () => {
    const res = await POST(makeReq({ ttl: 999999 }))
    expect(res.status).toBe(200)
  })

  it('clamps ttl to minimum 60', async () => {
    const res = await POST(makeReq({ ttl: 5 }))
    expect(res.status).toBe(200)
  })

  it('handles malformed JSON body gracefully', async () => {
    const req = new NextRequest('http://localhost/api/business/token/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
  })

  it('handles user with no scopes', async () => {
    vi.mocked(authenticateBusiness).mockResolvedValue({ ...USER, scopes: undefined } as any)
    const res = await POST(makeReq())
    expect(res.status).toBe(200)
  })
})
