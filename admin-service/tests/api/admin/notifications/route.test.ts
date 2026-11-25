import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/shared/admin-notify', () => ({ listAdminNotifications: vi.fn() }))

import { GET } from '@admin/app/api/(admin)/admin/notifications/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { listAdminNotifications } from '@/lib/shared/admin-notify'

const mockAuth = vi.mocked(authenticateAdmin)
const mockList = vi.mocked(listAdminNotifications)
const admin = { adminId: 'a1', username: 'admin', role: 'admin', scopes: ['orders'] }
const req = () => new NextRequest('http://localhost/api/admin/notifications')

describe('GET /api/admin/notifications', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await GET(req())
    expect(res.status).toBe(401)
    expect(mockList).not.toHaveBeenCalled()
  })

  it('lists notifications scoped to the admin', async () => {
    mockAuth.mockResolvedValue(admin)
    mockList.mockResolvedValue({ items: [{ id: 'n1' }], unreadCount: 3 } as never)
    const res = await GET(req())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ items: [{ id: 'n1' }], unreadCount: 3 })
    expect(mockList).toHaveBeenCalledWith('admin', ['orders'], 30, 'a1')
  })

  it('returns 500 when listing fails', async () => {
    mockAuth.mockResolvedValue(admin)
    mockList.mockRejectedValue(new Error('db'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await GET(req())
    expect(res.status).toBe(500)
  })
})
