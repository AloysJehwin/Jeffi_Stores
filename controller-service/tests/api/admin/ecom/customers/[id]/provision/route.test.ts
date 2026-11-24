import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const auth = vi.hoisted(() => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/jwt', () => auth)
const reg = vi.hoisted(() => ({ getTenant: vi.fn(), getProvisioningJob: vi.fn() }))
vi.mock('@/lib/tenant-registry', () => reg)
const trigger = vi.hoisted(() => ({ triggerProvisioning: vi.fn(), resolveRestoreKey: vi.fn() }))
vi.mock('@controller/lib/provisioning/trigger', () => trigger)

import { POST } from '@controller/app/api/(admin)/admin/ecom/customers/[id]/provision/route'

const call = () => POST(new NextRequest('http://localhost/api/admin/ecom/customers/t-1/provision', { method: 'POST' }), { params: Promise.resolve({ id: 't-1' }) })

beforeEach(() => {
  vi.clearAllMocks()
  auth.authenticateAdmin.mockResolvedValue({ adminId: 'a-1', role: 'administrator', scopes: [] })
  reg.getTenant.mockResolvedValue({ id: 't-1', slug: 'acme', plan: 'basic', status: 'pending', rds_endpoint: 'db.x' })
  reg.getProvisioningJob.mockResolvedValue({ status: 'running', last_error: null })
  trigger.resolveRestoreKey.mockResolvedValue('backups/acme.dump')
  trigger.triggerProvisioning.mockResolvedValue({ ok: true })
})

describe('POST /api/admin/ecom/customers/[id]/provision', () => {
  it('401s and 403s', async () => {
    auth.authenticateAdmin.mockResolvedValue(null)
    expect((await call()).status).toBe(401)
    auth.authenticateAdmin.mockResolvedValue({ adminId: 'a-2', role: 'admin', scopes: ['ecom_customers:read'] })
    expect((await call()).status).toBe(403)
    expect(trigger.triggerProvisioning).not.toHaveBeenCalled()
  })

  it('lets a scoped non-administrator through', async () => {
    auth.authenticateAdmin.mockResolvedValue({ adminId: 'a-2', role: 'admin', scopes: ['ecom_customers:write'] })
    expect((await call()).status).toBe(200)
  })

  it('404s for an unknown tenant and 409s for an active one', async () => {
    reg.getTenant.mockResolvedValue(null)
    expect((await call()).status).toBe(404)
    reg.getTenant.mockResolvedValue({ id: 't-1', slug: 'acme', status: 'active' })
    expect((await call()).status).toBe(409)
    expect(trigger.triggerProvisioning).not.toHaveBeenCalled()
  })

  it('starts provisioning with the restore key and reports the job', async () => {
    const res = await call()
    expect(await res.json()).toEqual({ success: true, jobStatus: 'running', tenantStatus: 'pending', rdsEndpoint: 'db.x', error: null })
    expect(trigger.triggerProvisioning).toHaveBeenCalledWith({
      action: 'provision',
      tenantId: 't-1',
      slug: 'acme',
      plan: 'basic',
      ownerId: null,
      restoreFromKey: 'backups/acme.dump',
      reason: 'operator',
    })
  })

  it('reports the job error when provisioning fails', async () => {
    trigger.triggerProvisioning.mockResolvedValue({ ok: false, error: 'quota' })
    reg.getProvisioningJob.mockResolvedValue({ status: 'failed', last_error: 'RDS quota exceeded' })
    const body = await (await call()).json()
    expect(body).toMatchObject({ success: false, jobStatus: 'failed', error: 'RDS quota exceeded' })
  })
})
