import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/tenancy/tenant-context', () => ({ resolveTenantId: vi.fn() }))
vi.mock('@/lib/shipping/delhivery', () => ({ deactivateDelhiveryPickupLocation: vi.fn() }))
vi.mock('@/lib/catalog/site-controls', () => ({ getBusinessValues: vi.fn() }))

import { POST } from '@admin/app/api/(admin)/admin/delhivery/pickup-locations/deactivate/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { resolveTenantId } from '@/lib/tenancy/tenant-context'
import { deactivateDelhiveryPickupLocation } from '@/lib/shipping/delhivery'
import { getBusinessValues } from '@/lib/catalog/site-controls'

const req = (body: unknown) => new NextRequest('http://localhost/x', { method: 'POST', body: JSON.stringify(body) })

describe('POST delhivery/pickup-locations/deactivate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateAdmin).mockResolvedValue({ adminId: 'a1', role: 'manager', scopes: [] } as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(resolveTenantId).mockResolvedValue('t1' as any)
    vi.mocked(getBusinessValues).mockResolvedValue({ pickupLocation: 'HQ' } as any)
    vi.mocked(deactivateDelhiveryPickupLocation).mockResolvedValue({ ok: true } as any)
  })

  it('401s and 403s', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    expect((await POST(req({ name: 'W' }))).status).toBe(401)
    vi.mocked(authenticateAdmin).mockResolvedValue({ adminId: 'a1', role: 'm', scopes: [] } as any)
    vi.mocked(hasScope).mockReturnValue(false)
    expect((await POST(req({ name: 'W' }))).status).toBe(403)
    expect(hasScope).toHaveBeenCalledWith('m', [], 'delhivery:write')
  })

  it('400s without a name', async () => {
    expect((await POST(req({ name: ' ' }))).status).toBe(400)
  })

  it('409s for the default warehouse', async () => {
    expect((await POST(req({ name: 'HQ' }))).status).toBe(409)
    expect(deactivateDelhiveryPickupLocation).not.toHaveBeenCalled()
  })

  it('deactivates a non-default warehouse', async () => {
    expect(await (await POST(req({ name: 'W2' }))).json()).toEqual({ ok: true, name: 'W2' })
    expect(deactivateDelhiveryPickupLocation).toHaveBeenCalledWith('W2', 't1')
  })

  it('proceeds when business values cannot be read', async () => {
    vi.mocked(getBusinessValues).mockRejectedValue(new Error('db'))
    expect((await POST(req({ name: 'HQ' }))).status).toBe(200)
  })

  it('502s when Delhivery refuses', async () => {
    vi.mocked(deactivateDelhiveryPickupLocation).mockResolvedValue({ ok: false, error: 'Has pickups' } as any)
    const res = await POST(req({ name: 'W2' }))
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: 'Has pickups' })
  })
})
