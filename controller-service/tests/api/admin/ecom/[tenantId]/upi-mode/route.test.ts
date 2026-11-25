import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const auth = vi.hoisted(() => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/jwt', () => auth)
const reg = vi.hoisted(() => ({ getTenant: vi.fn(), setUpiMode: vi.fn() }))
vi.mock('@/lib/tenant-registry', () => reg)
const creds = vi.hoisted(() => ({ invalidateUpiModeCache: vi.fn() }))
vi.mock('@/lib/payments/upi/creds', () => creds)

import { PATCH } from '@controller/app/api/(admin)/admin/ecom/[tenantId]/upi-mode/route'

const call = (body: unknown) =>
  PATCH(new NextRequest('http://localhost/api/admin/ecom/t-1/upi-mode', { method: 'PATCH', body: typeof body === 'string' ? body : JSON.stringify(body) }), {
    params: Promise.resolve({ tenantId: 't-1' }),
  })

beforeEach(() => {
  vi.clearAllMocks()
  auth.authenticateAdmin.mockResolvedValue({ adminId: 'a-1', role: 'administrator', scopes: [] })
  reg.getTenant.mockResolvedValue({ id: 't-1' })
})

describe('PATCH /api/admin/ecom/[tenantId]/upi-mode', () => {
  it('401s when unauthenticated', async () => {
    auth.authenticateAdmin.mockResolvedValue(null)
    expect((await call({ mode: 'off' })).status).toBe(401)
  })

  it('403s for a non-administrator', async () => {
    auth.authenticateAdmin.mockResolvedValue({ adminId: 'a-2', role: 'super_admin', scopes: [] })
    expect((await call({ mode: 'off' })).status).toBe(403)
    expect(reg.setUpiMode).not.toHaveBeenCalled()
  })

  it('404s for an unknown tenant', async () => {
    reg.getTenant.mockResolvedValue(null)
    expect((await call({ mode: 'off' })).status).toBe(404)
  })

  it.each([[{}], [{ mode: 'on' }], ['not json']])('400s for a bad body %#', async body => {
    expect((await call(body)).status).toBe(400)
    expect(reg.setUpiMode).not.toHaveBeenCalled()
  })

  it('sets the mode and drops the cached value', async () => {
    const res = await call({ mode: 'off' })
    expect(await res.json()).toEqual({ success: true, mode: 'off', upi_mode: 'off' })
    expect(reg.setUpiMode).toHaveBeenCalledWith('t-1', 'off')
    expect(creds.invalidateUpiModeCache).toHaveBeenCalledWith('t-1')
  })

  it('accepts the upi_mode alias', async () => {
    await call({ upi_mode: 'auto' })
    expect(reg.setUpiMode).toHaveBeenCalledWith('t-1', 'auto')
  })
})
