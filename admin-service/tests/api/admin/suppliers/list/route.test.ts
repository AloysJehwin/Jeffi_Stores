import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/plan-gate', () => ({ hasPlanScope: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({ queryMany: vi.fn() }))

import { GET } from '@admin/app/api/(admin)/admin/suppliers/list/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasPlanScope } from '@/lib/auth/plan-gate'
import { queryMany } from '@/lib/shared/db'

const admin = { adminId: 'a1', username: 'a', role: 'admin', scopes: ['inventory:read'] }
const call = (qs = '') => GET(new NextRequest(`http://localhost/x${qs}`))

describe('GET /api/admin/suppliers/list', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateAdmin).mockResolvedValue(admin)
    vi.mocked(hasPlanScope).mockResolvedValue(true as never)
  })

  it('returns 401 and 403', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null)
    expect((await call()).status).toBe(401)
    vi.mocked(authenticateAdmin).mockResolvedValue(admin)
    vi.mocked(hasPlanScope).mockResolvedValue(false as never)
    expect((await call()).status).toBe(403)
    expect(hasPlanScope).toHaveBeenLastCalledWith('admin', ['inventory:read'], 'inventory:read')
    expect(queryMany).not.toHaveBeenCalled()
  })

  it('lists only active suppliers by default', async () => {
    vi.mocked(queryMany).mockResolvedValue([{ id: 's1', name: 'Acme', is_active: true }])
    const res = await call()
    expect(await res.json()).toEqual([{ id: 's1', name: 'Acme', is_active: true }])
    expect(vi.mocked(queryMany).mock.calls[0][0]).toMatch(/WHERE is_active = true/)
  })

  it('includes inactive suppliers with active=false', async () => {
    vi.mocked(queryMany).mockResolvedValue([])
    await call('?active=false')
    expect(vi.mocked(queryMany).mock.calls[0][0]).not.toMatch(/WHERE/)
  })

  it('returns 500 when the query fails', async () => {
    vi.mocked(queryMany).mockRejectedValue(new Error('db'))
    expect((await call()).status).toBe(500)
  })
})
