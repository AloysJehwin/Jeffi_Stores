import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/loyalty/reconcile', () => ({ reconcileLoyaltyUntilDone: vi.fn() }))

import { POST } from '@controller/app/api/(admin)/admin/loyalty/recalculate/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { reconcileLoyaltyUntilDone } from '@/lib/loyalty/reconcile'

const mockAuth = authenticateAdmin as ReturnType<typeof vi.fn>
const mockHasScope = hasScope as ReturnType<typeof vi.fn>
const mockPasses = reconcileLoyaltyUntilDone as ReturnType<typeof vi.fn>

const req = () => new NextRequest('http://localhost/api/admin/loyalty/recalculate', { method: 'POST' })

describe('POST /api/admin/loyalty/recalculate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue({ adminId: 'a1', role: 'admin', scopes: [] })
    mockHasScope.mockReturnValue(true)
    mockPasses.mockResolvedValue({ enabled: true, users: 2, earned: 10, reversed: 0, upgrades: 1 })
  })

  it('needs an admin with write access to campaigns', async () => {
    mockAuth.mockResolvedValueOnce(null)
    expect((await POST(req())).status).toBe(401)
    mockHasScope.mockReturnValue(false)
    expect((await POST(req())).status).toBe(403)
    expect(mockHasScope).toHaveBeenCalledWith('admin', [], 'campaigns:write')
    expect(mockPasses).not.toHaveBeenCalled()
  })

  it('runs the points job and returns its totals', async () => {
    const res = await POST(req())
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ users: 2, earned: 10, upgrades: 1 })
  })

  it('answers 409 while the program is off', async () => {
    mockPasses.mockResolvedValue({ enabled: false, users: 0 })
    expect((await POST(req())).status).toBe(409)
  })

  it('answers 500 with the reason when the job fails', async () => {
    mockPasses.mockRejectedValue(new Error('boom'))
    const res = await POST(req())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('boom')
  })
})
