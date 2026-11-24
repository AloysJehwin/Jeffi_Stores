import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const auth = vi.hoisted(() => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/jwt', () => auth)
const reg = vi.hoisted(() => ({ getTenant: vi.fn() }))
vi.mock('@/lib/tenant-registry', () => reg)
const ca = vi.hoisted(() => ({ revokeTenantAdminCert: vi.fn() }))
vi.mock('@/lib/tenancy/tenant-ca', () => ca)
const portal = vi.hoisted(() => ({ revokePortalCerts: vi.fn() }))
vi.mock('@/lib/tenancy/portal-certs', () => portal)
const prov = vi.hoisted(() => ({ markTenantDbCertsRevoked: vi.fn() }))
vi.mock('@controller/lib/tenancy/tenant-admin-provision', () => prov)

import { POST } from '@controller/app/api/(admin)/admin/ecom/[tenantId]/certs/revoke/route'

const call = (body: unknown) =>
  POST(new NextRequest('http://localhost/api/admin/ecom/t-1/certs/revoke', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) }), {
    params: Promise.resolve({ tenantId: 't-1' }),
  })

beforeEach(() => {
  vi.clearAllMocks()
  auth.authenticateAdmin.mockResolvedValue({ adminId: 'a-1', email: 'op@example.com', role: 'administrator', scopes: [] })
  reg.getTenant.mockResolvedValue({ id: 't-1' })
  ca.revokeTenantAdminCert.mockResolvedValue(true)
})

describe('POST /api/admin/ecom/[tenantId]/certs/revoke', () => {
  it('401s when unauthenticated', async () => {
    auth.authenticateAdmin.mockResolvedValue(null)
    expect((await call({ serial: 'S1' })).status).toBe(401)
  })

  it('403s for a non-administrator', async () => {
    auth.authenticateAdmin.mockResolvedValue({ adminId: 'a-2', role: 'super_admin', scopes: [] })
    expect((await call({ serial: 'S1' })).status).toBe(403)
    expect(ca.revokeTenantAdminCert).not.toHaveBeenCalled()
  })

  it('404s for an unknown tenant', async () => {
    reg.getTenant.mockResolvedValue(null)
    expect((await call({ serial: 'S1' })).status).toBe(404)
  })

  it.each([[{}], [{ serial: '' }], ['not json']])('400s for a bad body %#', async body => {
    expect((await call(body)).status).toBe(400)
    expect(ca.revokeTenantAdminCert).not.toHaveBeenCalled()
  })

  it('revokes in the CA registry, the portal registry and the store database', async () => {
    const res = await call({ serial: 'S1' })
    expect(await res.json()).toEqual({ success: true, alreadyRevoked: false })
    expect(ca.revokeTenantAdminCert).toHaveBeenCalledWith('S1', 'op@example.com')
    expect(portal.revokePortalCerts).toHaveBeenCalledWith(['S1'])
    expect(prov.markTenantDbCertsRevoked).toHaveBeenCalledWith('t-1', ['S1'])
  })

  it('reports an already revoked certificate', async () => {
    ca.revokeTenantAdminCert.mockResolvedValue(false)
    expect((await (await call({ serial: 'S1' })).json()).alreadyRevoked).toBe(true)
  })
})
