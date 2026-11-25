import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/shared/admin-notify', () => ({ markRead: vi.fn(), markAllRead: vi.fn() }))

import { POST } from '@admin/app/api/(admin)/admin/notifications/read/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { markRead, markAllRead } from '@/lib/shared/admin-notify'

const mockAuth = vi.mocked(authenticateAdmin)
const admin = { adminId: 'a1', username: 'admin', role: 'admin', scopes: [] }
const req = (body?: unknown) =>
  new NextRequest('http://localhost/api/admin/notifications/read', {
    method: 'POST',
    body: body === undefined ? 'not json' : JSON.stringify(body),
  })

describe('POST /api/admin/notifications/read', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await POST(req({ all: true }))
    expect(res.status).toBe(401)
    expect(markAllRead).not.toHaveBeenCalled()
  })

  it('returns 400 when neither ids nor all is given', async () => {
    mockAuth.mockResolvedValue(admin)
    expect((await POST(req({}))).status).toBe(400)
    expect((await POST(req())).status).toBe(400)
    expect(markRead).not.toHaveBeenCalled()
  })

  it('marks all read for the admin', async () => {
    mockAuth.mockResolvedValue(admin)
    const res = await POST(req({ all: true }))
    expect(res.status).toBe(200)
    expect(markAllRead).toHaveBeenCalledWith('a1')
  })

  it('marks only string ids as read', async () => {
    mockAuth.mockResolvedValue(admin)
    const res = await POST(req({ ids: ['n1', 5, 'n2'] }))
    expect(res.status).toBe(200)
    expect(markRead).toHaveBeenCalledWith(['n1', 'n2'])
  })

  it('returns 500 when marking fails', async () => {
    mockAuth.mockResolvedValue(admin)
    vi.mocked(markAllRead).mockRejectedValue(new Error('db'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect((await POST(req({ all: true }))).status).toBe(500)
  })
})
