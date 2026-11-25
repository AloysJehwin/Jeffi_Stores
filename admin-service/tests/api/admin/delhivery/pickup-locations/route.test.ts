import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/tenancy/tenant-context', () => ({ resolveTenantId: vi.fn() }))
vi.mock('@/lib/shipping/delhivery', () => ({ listDelhiveryPickupLocations: vi.fn() }))

import { GET } from '@admin/app/api/(admin)/admin/delhivery/pickup-locations/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { resolveTenantId } from '@/lib/tenancy/tenant-context'
import { listDelhiveryPickupLocations } from '@/lib/shipping/delhivery'

const req = () => new NextRequest('http://localhost/api/admin/delhivery/pickup-locations')

describe('GET delhivery/pickup-locations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateAdmin).mockResolvedValue({ adminId: 'a1', role: 'manager', scopes: [] } as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(resolveTenantId).mockResolvedValue('t1' as any)
  })

  it('401s and 403s', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    expect((await GET(req())).status).toBe(401)
    vi.mocked(authenticateAdmin).mockResolvedValue({ adminId: 'a1', role: 'm', scopes: [] } as any)
    vi.mocked(hasScope).mockReturnValue(false)
    expect((await GET(req())).status).toBe(403)
    expect(hasScope).toHaveBeenCalledWith('m', [], 'delhivery:read')
  })

  it('lists the locations for the tenant', async () => {
    vi.mocked(listDelhiveryPickupLocations).mockResolvedValue([{ name: 'HQ' }] as any)
    expect(await (await GET(req())).json()).toEqual({ locations: [{ name: 'HQ' }] })
    expect(listDelhiveryPickupLocations).toHaveBeenCalledWith('t1')
  })

  it('passes undefined for the platform store', async () => {
    vi.mocked(resolveTenantId).mockResolvedValue(null as any)
    vi.mocked(listDelhiveryPickupLocations).mockResolvedValue([])
    await GET(req())
    expect(listDelhiveryPickupLocations).toHaveBeenCalledWith(undefined)
  })

  it('propagates a Delhivery failure', async () => {
    vi.mocked(listDelhiveryPickupLocations).mockRejectedValue(new Error('api'))
    await expect(GET(req())).rejects.toThrow('api')
  })
})
