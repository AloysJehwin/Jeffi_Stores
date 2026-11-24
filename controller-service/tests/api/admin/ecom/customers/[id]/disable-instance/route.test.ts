import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const auth = vi.hoisted(() => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/jwt', () => auth)
const reg = vi.hoisted(() => ({ getTenant: vi.fn(), getProvisioningJob: vi.fn(), setTenantInstanceState: vi.fn() }))
vi.mock('@/lib/tenant-registry', () => reg)
const provider = vi.hoisted(() => ({ stopDbInstance: vi.fn(), startDbInstance: vi.fn() }))
vi.mock('@controller/lib/provisioning', () => ({ getProvisioningProvider: () => provider }))
vi.mock('@controller/lib/provisioning/steps', () => ({ dbInstanceId: (slug: string) => `db-${slug}` }))

import { POST } from '@controller/app/api/(admin)/admin/ecom/customers/[id]/disable-instance/route'

const call = (body: unknown) =>
  POST(new NextRequest('http://localhost/api/admin/ecom/customers/t-1/disable-instance', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) }), {
    params: Promise.resolve({ id: 't-1' }),
  })

beforeEach(() => {
  vi.clearAllMocks()
  auth.authenticateAdmin.mockResolvedValue({ adminId: 'a-1', role: 'administrator', scopes: [] })
  reg.getTenant.mockResolvedValue({ id: 't-1', slug: 'test', iam_auth: true })
  reg.getProvisioningJob.mockResolvedValue({ created_resources: {} })
})

describe('POST /api/admin/ecom/customers/[id]/disable-instance', () => {
  it('401s and 403s', async () => {
    auth.authenticateAdmin.mockResolvedValue(null)
    expect((await call({ action: 'disable' })).status).toBe(401)
    auth.authenticateAdmin.mockResolvedValue({ adminId: 'a-2', role: 'super_admin', scopes: [] })
    expect((await call({ action: 'disable' })).status).toBe(403)
    expect(provider.stopDbInstance).not.toHaveBeenCalled()
  })

  it('404s for an unknown tenant', async () => {
    reg.getTenant.mockResolvedValue(null)
    expect((await call({ action: 'disable' })).status).toBe(404)
  })

  it('refuses any tenant but the test one', async () => {
    reg.getTenant.mockResolvedValue({ id: 't-1', slug: 'acme', iam_auth: true })
    expect((await call({ action: 'disable' })).status).toBe(403)
    expect(provider.stopDbInstance).not.toHaveBeenCalled()
  })

  it('400s for a bad action', async () => {
    expect((await call({ action: 'delete' })).status).toBe(400)
    expect((await call('not json')).status).toBe(400)
  })

  it('409s for a store whose database is on its own server', async () => {
    reg.getTenant.mockResolvedValue({ id: 't-1', slug: 'test', iam_auth: false })
    expect((await call({ action: 'disable' })).status).toBe(409)
    reg.getTenant.mockResolvedValue({ id: 't-1', slug: 'test', iam_auth: true })
    reg.getProvisioningJob.mockResolvedValue({ created_resources: { computeSpec: { db: { mode: 'node' } } } })
    expect((await call({ action: 'disable' })).status).toBe(409)
    expect(provider.stopDbInstance).not.toHaveBeenCalled()
  })

  it('stops the instance and records the state', async () => {
    const res = await call({ action: 'disable' })
    expect(await res.json()).toEqual({ success: true, instanceState: 'stopped' })
    expect(provider.stopDbInstance).toHaveBeenCalledWith('db-test')
    expect(reg.setTenantInstanceState).toHaveBeenCalledWith('t-1', 'stopped')
  })

  it('starts the recorded instance on enable', async () => {
    reg.getProvisioningJob.mockResolvedValue({ created_resources: { dbInstanceId: 'rds-xyz' } })
    const res = await call({ action: 'enable' })
    expect(await res.json()).toEqual({ success: true, instanceState: 'running' })
    expect(provider.startDbInstance).toHaveBeenCalledWith('rds-xyz')
    expect(reg.setTenantInstanceState).toHaveBeenCalledWith('t-1', 'running')
  })

  it('500s when the RDS call fails, leaving state alone', async () => {
    provider.stopDbInstance.mockRejectedValue(new Error('rds busy'))
    const res = await call({ action: 'disable' })
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'rds busy' })
    expect(reg.setTenantInstanceState).not.toHaveBeenCalled()
  })
})
