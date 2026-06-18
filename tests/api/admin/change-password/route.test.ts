import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/lib/jwt', () => ({
  authenticateAdmin: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
}))

vi.mock('bcrypt', () => ({
  default: {
    compare: vi.fn(),
    hash: vi.fn(),
  },
}))

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { POST } from '@/app/api/admin/change-password/route'
import { authenticateAdmin } from '@/lib/jwt'
import { query, queryOne } from '@/lib/db'
import bcrypt from 'bcrypt'

const mockAuth = vi.mocked(authenticateAdmin)
const mockQuery = vi.mocked(query)
const mockQueryOne = vi.mocked(queryOne)
const mockBcryptCompare = vi.mocked(bcrypt.compare)
const mockBcryptHash = vi.mocked(bcrypt.hash)

const adminPayload = {
  adminId: 'admin-1',
  username: 'testadmin',
  role: 'admin',
  scopes: [],
}

function makeRequest(body: Record<string, unknown> = {}) {
  return new NextRequest('http://localhost/api/admin/change-password', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: 'admin_token=valid' },
    body: JSON.stringify(body),
  })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/admin/change-password', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await POST(makeRequest({ currentPassword: 'old', newPassword: 'new123' }))
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toMatch(/unauthorized/i)
  })

  it('returns 404 when admin record not found in DB', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockQueryOne.mockResolvedValue(null)
    const res = await POST(makeRequest({ currentPassword: 'old', newPassword: 'new123' }))
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toMatch(/admin not found/i)
  })

  it('returns 400 when current password is incorrect', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockQueryOne.mockResolvedValue({ password_hash: '$2b$10$hashed' })
    mockBcryptCompare.mockResolvedValue(false as any)

    const res = await POST(makeRequest({ currentPassword: 'wrong', newPassword: 'new123' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/incorrect/i)
  })

  it('updates password and returns success', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockQueryOne.mockResolvedValue({ password_hash: '$2b$10$hashed' })
    mockBcryptCompare.mockResolvedValue(true as any)
    mockBcryptHash.mockResolvedValue('$2b$10$newhash' as any)
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)

    const res = await POST(makeRequest({ currentPassword: 'correct', newPassword: 'NewPass123!' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(mockBcryptHash).toHaveBeenCalledWith('NewPass123!', 10)
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE admins SET password_hash'),
      ['$2b$10$newhash', 'admin-1'],
    )
  })

  it('returns 500 on unexpected error', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockQueryOne.mockRejectedValue(new Error('Unexpected DB error'))

    const res = await POST(makeRequest({ currentPassword: 'old', newPassword: 'new' }))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toMatch(/Unexpected DB error/i)
  })
})
