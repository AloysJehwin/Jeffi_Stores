import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/auth-sessions', () => ({ listActiveSessions: vi.fn() }))

import { GET } from '@admin/app/api/(admin)/admin/sessions/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { listActiveSessions } from '@/lib/auth/auth-sessions'

const mockAuth = vi.mocked(authenticateAdmin)
const admin = { adminId: 'a1', username: 'admin', role: 'admin', scopes: [] }
const req = () => new NextRequest('http://localhost/api/admin/sessions')

describe('GET /api/admin/sessions', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null)
    expect((await GET(req())).status).toBe(401)
    expect(listActiveSessions).not.toHaveBeenCalled()
  })

  it("lists only the caller's own admin sessions", async () => {
    mockAuth.mockResolvedValue(admin)
    vi.mocked(listActiveSessions).mockResolvedValue([{ id: 's1' }] as never)
    const res = await GET(req())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ sessions: [{ id: 's1' }] })
    expect(listActiveSessions).toHaveBeenCalledWith('admin', 'a1')
  })

  it('propagates a store failure', async () => {
    mockAuth.mockResolvedValue(admin)
    vi.mocked(listActiveSessions).mockRejectedValue(new Error('db'))
    await expect(GET(req())).rejects.toThrow('db')
  })
})
