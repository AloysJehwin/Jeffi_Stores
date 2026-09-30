import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── hoisted mocks ────────────────────────────────────────────────────────────
const { queryOneMock, queryMock, authenticateAdminMock } = vi.hoisted(() => ({
  queryOneMock: vi.fn(),
  queryMock: vi.fn(),
  authenticateAdminMock: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  query: queryMock,
  queryOne: queryOneMock,
  queryMany: vi.fn(),
  queryCount: vi.fn(),
}))

vi.mock('@/lib/jwt', () => ({
  authenticateAdmin: authenticateAdminMock,
  authenticateUser: vi.fn().mockResolvedValue(null),
}))

// ── import handler AFTER mocks ───────────────────────────────────────────────
import { PATCH, DELETE } from '@/app/api/products/[id]/route'

// ── helpers ──────────────────────────────────────────────────────────────────
function makeReq(method: string, body?: Record<string, unknown>) {
  return new Request('http://localhost/api/products/prod-1', {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer mock-token' },
    body: body ? JSON.stringify(body) : undefined,
  })
}

const adminPayload = { adminId: 'admin-1', username: 'admin', role: 'super_admin', scopes: ['products:write'] }

describe('PATCH /api/products/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authenticateAdminMock.mockResolvedValue(adminPayload)
  })

  it('returns 401 when not authenticated', async () => {
    authenticateAdminMock.mockResolvedValue(null)

    const res = await PATCH(makeReq('PATCH', { is_active: false }) as any, {
      params: Promise.resolve({ id: 'prod-1' }),
    })
    expect(res.status).toBe(401)

    const body = await res.json()
    expect(body).toHaveProperty('error', 'Unauthorized')
  })

  it('returns 400 when no valid fields provided', async () => {
    const res = await PATCH(makeReq('PATCH', { unknown_field: 'value' }) as any, {
      params: Promise.resolve({ id: 'prod-1' }),
    })
    expect(res.status).toBe(400)

    const body = await res.json()
    expect(body.error).toMatch(/no valid fields/i)
  })

  it('returns 404 when product does not exist', async () => {
    queryOneMock.mockResolvedValue(null)

    const res = await PATCH(makeReq('PATCH', { is_active: false }) as any, {
      params: Promise.resolve({ id: 'nonexistent-id' }),
    })
    expect(res.status).toBe(404)

    const body = await res.json()
    expect(body.error).toMatch(/not found/i)
  })

  it('deactivates product successfully', async () => {
    queryOneMock.mockResolvedValue({ id: 'prod-1' })

    const res = await PATCH(makeReq('PATCH', { is_active: false }) as any, {
      params: Promise.resolve({ id: 'prod-1' }),
    })
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body).toHaveProperty('success', true)
  })

  it('features a product when fewer than 6 are already featured', async () => {
    // First queryOne = featured count check, second = UPDATE RETURNING
    queryOneMock.mockResolvedValueOnce({ count: '3' }).mockResolvedValueOnce({ id: 'prod-1' })

    const res = await PATCH(makeReq('PATCH', { is_featured: true }) as any, {
      params: Promise.resolve({ id: 'prod-1' }),
    })
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.success).toBe(true)
  })

  it('returns 409 when trying to feature but 6 already featured', async () => {
    queryOneMock.mockResolvedValue({ count: '6' })

    const res = await PATCH(makeReq('PATCH', { is_featured: true }) as any, {
      params: Promise.resolve({ id: 'prod-1' }),
    })
    expect(res.status).toBe(409)

    const body = await res.json()
    expect(body.error).toMatch(/maximum 6/i)
  })
})

describe('DELETE /api/products/[id]', () => {
  it('always returns 405 with informative message', async () => {
    const res = await DELETE(new NextRequest('http://localhost/api/products/test'), {
      params: Promise.resolve({ id: 'test' }),
    })
    expect(res.status).toBe(405)

    const body = await res.json()
    expect(body.error).toMatch(/cannot be deleted/i)
  })
})
