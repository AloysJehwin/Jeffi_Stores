import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const getTenant = vi.fn()
const ensureOwnerAdmin = vi.fn()
const logAdminAudit = vi.fn()
vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ isPlatformAdmin: vi.fn() }))
vi.mock('@/lib/tenant-registry', () => ({ getTenant: (...a: unknown[]) => getTenant(...a) }))
vi.mock('@/lib/shared/admin-audit', () => ({ logAdminAudit: (...a: unknown[]) => logAdminAudit(...a) }))
vi.mock('@controller/lib/tenancy/tenant-admin-provision', () => ({ ensureOwnerAdmin: (...a: unknown[]) => ensureOwnerAdmin(...a) }))

import { POST } from '@controller/app/api/(admin)/admin/ecom/[tenantId]/certs/issue/route'
import { requireAdminScope } from '@/lib/auth/jwt'
import { isPlatformAdmin } from '@/lib/auth/scopes'

const TID = '11111111-1111-1111-1111-111111111111'
const params = { params: Promise.resolve({ tenantId: TID }) }
const send = (body?: unknown) =>
  new NextRequest(`http://localhost/api/admin/ecom/${TID}/certs/issue`, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) })
const ISSUED = { success: true, outcome: 'reissued', serial: 'AB12', expiresAt: new Date('2027-11-01T00:00:00Z'), emailed: true, revoked: ['OLD1'], caCreated: false, email: 'owner@acme.test', slug: 'acme' }

describe('POST /api/admin/ecom/[tenantId]/certs/issue', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a-1', email: 'ops@jeffi.test', role: 'administrator', scopes: [] } as any)
    vi.mocked(isPlatformAdmin).mockReturnValue(true)
    getTenant.mockResolvedValue({ id: TID, slug: 'acme', rds_endpoint: 'acme-postgres' })
    ensureOwnerAdmin.mockResolvedValue(ISSUED)
    logAdminAudit.mockResolvedValue(undefined)
  })

  it('re-issues the owner certificate on ecom_customers:write, revoking the old ones when asked, and audits it', async () => {
    const res = await POST(send({ revokeExisting: true }), params)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ serial: 'AB12', issuedTo: 'owner@acme.test', expiresAt: '2027-11-01T00:00:00.000Z', emailed: true, revoked: ['OLD1'] })
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'ecom_customers:write')
    expect(ensureOwnerAdmin).toHaveBeenCalledWith(TID, {
      force: true,
      revokeExisting: true,
      email: undefined,
      name: undefined,
      revokedBy: 'ops@jeffi.test',
      refreshFleet: 'if-ca-created',
    })
    expect(logAdminAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'create', entityType: 'tenant_admin_cert', entityId: 'AB12' }))
  })

  it('issues to another email (lower-cased) without revoking by default', async () => {
    await POST(send({ email: 'Second@Acme.test', name: 'Second' }), params)
    expect(ensureOwnerAdmin).toHaveBeenCalledWith(TID, expect.objectContaining({ email: 'second@acme.test', name: 'Second', revokeExisting: false }))
  })

  it('refuses without the write scope or outside the platform', async () => {
    vi.mocked(requireAdminScope).mockResolvedValueOnce(NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 }))
    expect((await POST(send({}), params)).status).toBe(403)
    vi.mocked(isPlatformAdmin).mockReturnValue(false)
    expect((await POST(send({}), params)).status).toBe(403)
    expect(ensureOwnerAdmin).not.toHaveBeenCalled()
  })

  it('404s an unknown tenant and 409s a store without a database', async () => {
    getTenant.mockResolvedValueOnce(null)
    expect((await POST(send({}), params)).status).toBe(404)
    getTenant.mockResolvedValueOnce({ id: TID, slug: 'acme', rds_endpoint: null })
    expect((await POST(send({}), params)).status).toBe(409)
    expect(ensureOwnerAdmin).not.toHaveBeenCalled()
  })

  it('validates the body', async () => {
    expect((await POST(send({ email: 'not-an-email' }), params)).status).toBe(400)
    expect((await POST(send({ name: 'x'.repeat(121) }), params)).status).toBe(400)
    expect(ensureOwnerAdmin).not.toHaveBeenCalled()
  })

  it('reports a store with no owner and a failed issue, and audits neither', async () => {
    ensureOwnerAdmin.mockResolvedValueOnce({ success: false, noOwner: true, emailed: false, revoked: [], caCreated: false })
    expect((await POST(send(), params)).status).toBe(422)
    ensureOwnerAdmin.mockResolvedValueOnce({ success: false, error: 'tenant DB unreachable', emailed: false, revoked: [], caCreated: false })
    const res = await POST(send({}), params)
    expect(res.status).toBe(502)
    expect((await res.json()).error).toMatch(/unreachable/)
    expect(logAdminAudit).not.toHaveBeenCalled()
  })
})
