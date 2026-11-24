import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const auth = vi.hoisted(() => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/jwt', () => auth)
const reg = vi.hoisted(() => ({ getTenant: vi.fn(), setOwnDelhivery: vi.fn() }))
vi.mock('@/lib/tenant-registry', () => reg)
const res_ = vi.hoisted(() => ({ hasOwnDelhiveryToken: vi.fn() }))
vi.mock('@/lib/integrations/resolve', () => res_)

import { PATCH } from '@controller/app/api/(admin)/admin/ecom/[tenantId]/delivery-mode/route'

const call = (body: unknown) =>
  PATCH(new NextRequest('http://localhost/api/admin/ecom/t-1/delivery-mode', { method: 'PATCH', body: typeof body === 'string' ? body : JSON.stringify(body) }), {
    params: Promise.resolve({ tenantId: 't-1' }),
  })

beforeEach(() => {
  vi.clearAllMocks()
  auth.authenticateAdmin.mockResolvedValue({ adminId: 'a-1', role: 'administrator', scopes: [] })
  reg.getTenant.mockResolvedValue({ id: 't-1' })
  res_.hasOwnDelhiveryToken.mockResolvedValue(true)
})

describe('PATCH /api/admin/ecom/[tenantId]/delivery-mode', () => {
  it('401s when unauthenticated', async () => {
    auth.authenticateAdmin.mockResolvedValue(null)
    expect((await call({ own_delhivery: true })).status).toBe(401)
  })

  it('403s for a non-administrator', async () => {
    auth.authenticateAdmin.mockResolvedValue({ adminId: 'a-2', role: 'super_admin', scopes: [] })
    expect((await call({ own_delhivery: true })).status).toBe(403)
    expect(reg.setOwnDelhivery).not.toHaveBeenCalled()
  })

  it('404s for an unknown tenant', async () => {
    reg.getTenant.mockResolvedValue(null)
    expect((await call({ own_delhivery: true })).status).toBe(404)
  })

  it('400s for a bad body', async () => {
    expect((await call({ own_delhivery: 1 })).status).toBe(400)
  })

  it('refuses own-Delhivery without a connected token', async () => {
    res_.hasOwnDelhiveryToken.mockResolvedValue(false)
    expect((await call({ own_delhivery: true })).status).toBe(409)
    expect(reg.setOwnDelhivery).not.toHaveBeenCalled()
  })

  it('enables and disables own-Delhivery', async () => {
    expect(await (await call({ own_delhivery: true })).json()).toEqual({ success: true, own_delhivery: true })
    expect(reg.setOwnDelhivery).toHaveBeenLastCalledWith('t-1', true)
    await call({ own_delhivery: false })
    expect(reg.setOwnDelhivery).toHaveBeenLastCalledWith('t-1', false)
  })
})
