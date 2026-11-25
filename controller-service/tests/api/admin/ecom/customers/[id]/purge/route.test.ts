import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const auth = vi.hoisted(() => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/jwt', () => auth)
const reg = vi.hoisted(() => ({ getTenant: vi.fn(), purgeTenant: vi.fn() }))
vi.mock('@/lib/tenant-registry', () => reg)

import { POST } from '@controller/app/api/(admin)/admin/ecom/customers/[id]/purge/route'

const call = (body: unknown) =>
  POST(new NextRequest('http://localhost/api/admin/ecom/customers/t-1/purge', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) }), {
    params: Promise.resolve({ id: 't-1' }),
  })

beforeEach(() => {
  vi.clearAllMocks()
  auth.authenticateAdmin.mockResolvedValue({ adminId: 'a-1', role: 'administrator', scopes: [] })
  reg.getTenant.mockResolvedValue({ id: 't-1' })
  reg.purgeTenant.mockResolvedValue({ ok: true, deletedBackups: 3 })
})

describe('POST /api/admin/ecom/customers/[id]/purge', () => {
  it('401s and 403s', async () => {
    auth.authenticateAdmin.mockResolvedValue(null)
    expect((await call({ confirm: true })).status).toBe(401)
    auth.authenticateAdmin.mockResolvedValue({ adminId: 'a-2', role: 'super_admin', scopes: [] })
    expect((await call({ confirm: true })).status).toBe(403)
    expect(reg.purgeTenant).not.toHaveBeenCalled()
  })

  it('404s for an unknown tenant', async () => {
    reg.getTenant.mockResolvedValue(null)
    expect((await call({ confirm: true })).status).toBe(404)
  })

  it.each([[{}], [{ confirm: 'yes' }], ['not json']])('needs an explicit confirm %#', async body => {
    expect((await call(body)).status).toBe(400)
    expect(reg.purgeTenant).not.toHaveBeenCalled()
  })

  it('purges and reports the deleted backups', async () => {
    const res = await call({ confirm: true })
    expect(await res.json()).toEqual({ ok: true, deletedBackups: 3 })
    expect(reg.purgeTenant).toHaveBeenCalledWith('t-1')
  })

  it('relays a purge refusal as 400', async () => {
    reg.purgeTenant.mockResolvedValue({ ok: false, error: 'tenant is live' })
    const res = await call({ confirm: true })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ ok: false, error: 'tenant is live' })
  })
})
