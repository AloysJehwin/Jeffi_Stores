import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/auth-sessions', () => ({ revokeSession: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({ queryOne: vi.fn() }))

import { POST } from '@admin/app/api/(admin)/admin/sessions/[id]/revoke/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { revokeSession } from '@/lib/auth/auth-sessions'
import { queryOne } from '@/lib/shared/db'

const mockAuth = vi.mocked(authenticateAdmin)
const mockQueryOne = vi.mocked(queryOne)
const admin = { adminId: 'a1', username: 'admin', role: 'admin', scopes: [] }
const call = () =>
  POST(new NextRequest('http://localhost/api/admin/sessions/s1/revoke', { method: 'POST' }), {
    params: Promise.resolve({ id: 's1' }),
  })

describe('POST /api/admin/sessions/[id]/revoke', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null)
    expect((await call()).status).toBe(401)
    expect(revokeSession).not.toHaveBeenCalled()
  })

  it('returns 404 when the session does not exist', async () => {
    mockAuth.mockResolvedValue(admin)
    mockQueryOne.mockResolvedValue(null)
    expect((await call()).status).toBe(404)
    expect(revokeSession).not.toHaveBeenCalled()
  })

  it("returns 403 for another admin's session", async () => {
    mockAuth.mockResolvedValue(admin)
    mockQueryOne.mockResolvedValue({ principal_type: 'admin', principal_id: 'other' })
    expect((await call()).status).toBe(403)
    expect(revokeSession).not.toHaveBeenCalled()
  })

  it('returns 403 for a non-admin principal with the same id', async () => {
    mockAuth.mockResolvedValue(admin)
    mockQueryOne.mockResolvedValue({ principal_type: 'customer', principal_id: 'a1' })
    expect((await call()).status).toBe(403)
    expect(revokeSession).not.toHaveBeenCalled()
  })

  it('revokes the own session', async () => {
    mockAuth.mockResolvedValue(admin)
    mockQueryOne.mockResolvedValue({ principal_type: 'admin', principal_id: 'a1' })
    const res = await call()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true })
    expect(revokeSession).toHaveBeenCalledWith('s1')
  })

  it('propagates a revoke failure', async () => {
    mockAuth.mockResolvedValue(admin)
    mockQueryOne.mockResolvedValue({ principal_type: 'admin', principal_id: 'a1' })
    vi.mocked(revokeSession).mockRejectedValue(new Error('db'))
    await expect(call()).rejects.toThrow('db')
  })
})
