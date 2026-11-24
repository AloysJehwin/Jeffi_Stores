import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/tenancy/tenant-context', () => ({ resolveTenantId: vi.fn() }))
vi.mock('@/lib/shipping/delhivery', () => ({ setDefaultPickupLocation: vi.fn() }))

import { POST } from '@admin/app/api/(admin)/admin/delhivery/pickup-locations/set-default/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { resolveTenantId } from '@/lib/tenancy/tenant-context'
import { setDefaultPickupLocation } from '@/lib/shipping/delhivery'

const req = (body: unknown) => new NextRequest('http://localhost/x', { method: 'POST', body: JSON.stringify(body) })

describe('POST delhivery/pickup-locations/set-default', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateAdmin).mockResolvedValue({ adminId: 'a1', role: 'manager', scopes: [] } as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(resolveTenantId).mockResolvedValue('t1' as any)
    vi.mocked(setDefaultPickupLocation).mockResolvedValue({ ok: true } as any)
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
    expect((await POST(req({}))).status).toBe(400)
    expect(setDefaultPickupLocation).not.toHaveBeenCalled()
  })

  it('sets the default for the tenant', async () => {
    expect(await (await POST(req({ name: ' W2 ' }))).json()).toEqual({ ok: true, name: 'W2' })
    expect(setDefaultPickupLocation).toHaveBeenCalledWith('W2', 't1')
  })

  it('400s with the helper error', async () => {
    vi.mocked(setDefaultPickupLocation).mockResolvedValue({ ok: false, error: 'Unknown warehouse' } as any)
    const res = await POST(req({ name: 'X' }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Unknown warehouse' })
  })
})
