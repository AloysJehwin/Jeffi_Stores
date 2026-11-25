import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/tenancy/tenant-context', () => ({ resolveTenantId: vi.fn() }))
vi.mock('@/lib/shipping/delhivery', () => ({ createDelhiveryPickupLocation: vi.fn(), checkPincodeServiceability: vi.fn() }))

import { POST } from '@admin/app/api/(admin)/admin/delhivery/pickup-locations/create/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { resolveTenantId } from '@/lib/tenancy/tenant-context'
import { createDelhiveryPickupLocation, checkPincodeServiceability } from '@/lib/shipping/delhivery'

const req = (body: unknown) => new NextRequest('http://localhost/x', { method: 'POST', body: JSON.stringify(body) })
const good = { name: ' HQ ', phone: '+91 98765-43210', pincode: '560001', address: '1 Main St', city: 'Blr' }

describe('POST delhivery/pickup-locations/create', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateAdmin).mockResolvedValue({ adminId: 'a1', role: 'manager', scopes: [] } as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(resolveTenantId).mockResolvedValue('t1' as any)
    vi.mocked(checkPincodeServiceability).mockResolvedValue({ pickup: true } as any)
    vi.mocked(createDelhiveryPickupLocation).mockResolvedValue({ ok: true } as any)
  })

  it('401s and 403s', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    expect((await POST(req(good))).status).toBe(401)
    vi.mocked(authenticateAdmin).mockResolvedValue({ adminId: 'a1', role: 'm', scopes: [] } as any)
    vi.mocked(hasScope).mockReturnValue(false)
    expect((await POST(req(good))).status).toBe(403)
    expect(hasScope).toHaveBeenCalledWith('m', [], 'delhivery:write')
  })

  it('400s on missing name/address, short phone and bad pincode', async () => {
    expect((await POST(req({ ...good, name: '' }))).status).toBe(400)
    expect((await POST(req({ ...good, address: '' }))).status).toBe(400)
    expect((await POST(req({ ...good, phone: '123' }))).status).toBe(400)
    expect((await POST(req({ ...good, pincode: '5600' }))).status).toBe(400)
    expect(createDelhiveryPickupLocation).not.toHaveBeenCalled()
  })

  it('422s when Delhivery cannot pick up from the pincode', async () => {
    vi.mocked(checkPincodeServiceability).mockResolvedValue({ pickup: false, error: 'No pickup' } as any)
    const res = await POST(req(good))
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({ error: 'No pickup' })
    expect(createDelhiveryPickupLocation).not.toHaveBeenCalled()
  })

  it('creates the warehouse with cleaned fields', async () => {
    const res = await POST(req(good))
    expect(await res.json()).toEqual({ ok: true, name: 'HQ' })
    expect(checkPincodeServiceability).toHaveBeenCalledWith('560001', 't1')
    expect(createDelhiveryPickupLocation).toHaveBeenCalledWith(expect.objectContaining({ name: 'HQ', phone: '919876543210', pincode: '560001', address: '1 Main St', city: 'Blr', tenantId: 't1' }))
  })

  it('502s when the create call fails', async () => {
    vi.mocked(createDelhiveryPickupLocation).mockResolvedValue({ ok: false, error: 'Duplicate' } as any)
    const res = await POST(req(good))
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: 'Duplicate' })
  })
})
