import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/payments/wallet', () => ({ getTenantWallet: vi.fn() }))

import { GET } from '@admin/app/api/(admin)/admin/financial/wallet/topup/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { getTenantWallet } from '@/lib/payments/wallet'

const req = (tenantId?: string) =>
  new NextRequest('http://localhost/api/admin/financial/wallet/topup', { headers: tenantId ? { 'x-tenant-id': tenantId } : {} })

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(authenticateAdmin).mockResolvedValue({ adminId: 'a1' } as any)
})

describe('GET /api/admin/financial/wallet/topup', () => {
  it('returns 401 when unauthenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    expect((await GET(req('t1'))).status).toBe(401)
    expect(getTenantWallet).not.toHaveBeenCalled()
  })

  it('returns 400 without the x-tenant-id header', async () => {
    const res = await GET(req())
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'No tenant context' })
  })

  it('returns the wallet of the header tenant', async () => {
    vi.mocked(getTenantWallet).mockResolvedValue({ balanceInr: 700, ledger: [{ id: 'l1' }] } as any)
    const res = await GET(req('t9'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ balanceInr: 700, ledger: [{ id: 'l1' }] })
    expect(getTenantWallet).toHaveBeenCalledWith('t9')
  })

  it('lets a wallet failure propagate', async () => {
    vi.mocked(getTenantWallet).mockRejectedValue(new Error('db'))
    await expect(GET(req('t1'))).rejects.toThrow('db')
  })
})
