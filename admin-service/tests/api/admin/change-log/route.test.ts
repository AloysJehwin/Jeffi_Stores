import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/admin/change-log', () => ({
  CHANGE_LOG_KINDS: { order: { scope: 'orders:read' } },
  getChangeLog: vi.fn(),
}))

import { GET } from '@admin/app/api/(admin)/admin/change-log/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { getChangeLog } from '@/lib/admin/change-log'

const req = (qs: string) => new NextRequest(`http://localhost/api/admin/change-log${qs}`)

describe('GET /api/admin/change-log', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateAdmin).mockResolvedValue({ adminId: 'a1', role: 'manager', scopes: [] } as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(getChangeLog).mockResolvedValue({ entries: [], next: null } as any)
  })

  it('401s without a session (passive auth)', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    expect((await GET(req('?kind=order&id=1'))).status).toBe(401)
    expect(authenticateAdmin).toHaveBeenCalledWith(expect.anything(), { passive: true })
  })

  it('400s on an unknown kind or bad id', async () => {
    expect((await GET(req('?kind=nope&id=1'))).status).toBe(400)
    expect((await GET(req('?kind=order&id=a b'))).status).toBe(400)
    expect((await GET(req('?kind=order'))).status).toBe(400)
    expect(getChangeLog).not.toHaveBeenCalled()
  })

  it('403s without the kinds scope', async () => {
    vi.mocked(hasScope).mockReturnValue(false)
    expect((await GET(req('?kind=order&id=1'))).status).toBe(403)
    expect(hasScope).toHaveBeenCalledWith('manager', [], 'orders:read')
  })

  it('returns the page, with IPs only for audit:read', async () => {
    vi.mocked(hasScope).mockImplementation(((_r: string, _s: string[], scope: string) => scope === 'orders:read') as any)
    const res = await GET(req('?kind=order&id=o-1&fields=status,,payment_status&before=c1&limit=5'))
    expect(await res.json()).toEqual({ entries: [], next: null })
    expect(getChangeLog).toHaveBeenCalledWith('order', 'o-1', { fields: ['status', 'payment_status'], before: 'c1', limit: 5, withIp: false })
    vi.mocked(hasScope).mockReturnValue(true)
    await GET(req('?kind=order&id=o-1&limit=bad'))
    expect(getChangeLog).toHaveBeenLastCalledWith('order', 'o-1', expect.objectContaining({ limit: 30, withIp: true }))
  })

  it('propagates a store failure', async () => {
    vi.mocked(getChangeLog).mockRejectedValue(new Error('db'))
    await expect(GET(req('?kind=order&id=1'))).rejects.toThrow('db')
  })
})
