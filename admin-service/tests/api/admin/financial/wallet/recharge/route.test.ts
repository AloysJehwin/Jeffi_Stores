import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/tenancy/tenant-context', () => ({ resolveTenant: vi.fn() }))
vi.mock('@/lib/payments/wallet', () => ({ getTenantWallet: vi.fn() }))

import { GET, POST } from '@admin/app/api/(admin)/admin/financial/wallet/recharge/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { resolveTenant } from '@/lib/tenancy/tenant-context'
import { getTenantWallet } from '@/lib/payments/wallet'

const req = () => new NextRequest('http://localhost/api/admin/financial/wallet/recharge')

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(authenticateAdmin).mockResolvedValue({ adminId: 'a1', role: 'admin', scopes: [] } as any)
  vi.mocked(resolveTenant).mockResolvedValue({ tenantId: 't1' } as any)
})

describe('GET /api/admin/financial/wallet/recharge', () => {
  it('returns 401 when unauthenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    expect((await GET(req())).status).toBe(401)
    expect(getTenantWallet).not.toHaveBeenCalled()
  })

  it('returns 400 without a tenant context', async () => {
    vi.mocked(resolveTenant).mockResolvedValue(null as any)
    const res = await GET(req())
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'No tenant context' })
  })

  it('returns the tenant wallet', async () => {
    vi.mocked(getTenantWallet).mockResolvedValue({ balanceInr: 1500, ledger: [] } as any)
    const res = await GET(req())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ balanceInr: 1500, ledger: [] })
    expect(getTenantWallet).toHaveBeenCalledWith('t1')
  })

  it('lets a wallet failure propagate', async () => {
    vi.mocked(getTenantWallet).mockRejectedValue(new Error('db'))
    await expect(GET(req())).rejects.toThrow('db')
  })
})

describe('POST /api/admin/financial/wallet/recharge', () => {
  it('refuses manual credits with 403 and credits nothing', async () => {
    const res = await POST()
    expect(res.status).toBe(403)
    expect((await res.json()).error).toMatch(/applied by the platform/)
    expect(getTenantWallet).not.toHaveBeenCalled()
  })
})
