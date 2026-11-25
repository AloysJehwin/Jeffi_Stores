import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const auth = vi.hoisted(() => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/jwt', () => auth)
const reg = vi.hoisted(() => ({ getTenant: vi.fn(), getProvisioningJob: vi.fn(), resumeProvisioningJob: vi.fn() }))
vi.mock('@/lib/tenant-registry', () => reg)
const steps = vi.hoisted(() => ({ advanceProvisioningJob: vi.fn() }))
vi.mock('@controller/lib/provisioning/steps', () => steps)
vi.mock('@controller/lib/provisioning/pipeline', () => ({ LEGACY_STEP_IDS: ['legacy'] }))
vi.mock('@controller/lib/provisioning', () => ({ getProvisioningProvider: () => ({ name: 'fake' }) }))

import { POST } from '@controller/app/api/(admin)/admin/ecom/customers/[id]/retry/route'

const call = (body: unknown = {}) =>
  POST(new NextRequest('http://localhost/api/admin/ecom/customers/t-1/retry', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) }), {
    params: Promise.resolve({ id: 't-1' }),
  })

beforeEach(() => {
  vi.clearAllMocks()
  auth.authenticateAdmin.mockResolvedValue({ adminId: 'a-1', role: 'admin', scopes: ['ecom_customers:write'] })
  reg.getTenant.mockResolvedValue({ id: 't-1' })
  reg.resumeProvisioningJob.mockResolvedValue({ ok: true, resumedFrom: 'create_db' })
  reg.getProvisioningJob.mockResolvedValue({ id: 'j', status: 'running', step: 'create_db', last_error: null })
  steps.advanceProvisioningJob.mockResolvedValue('pending')
})

describe('POST /api/admin/ecom/customers/[id]/retry', () => {
  it('401s and 403s', async () => {
    auth.authenticateAdmin.mockResolvedValue(null)
    expect((await call()).status).toBe(401)
    auth.authenticateAdmin.mockResolvedValue({ adminId: 'a-2', role: 'admin', scopes: [] })
    expect((await call()).status).toBe(403)
    expect(reg.resumeProvisioningJob).not.toHaveBeenCalled()
  })

  it('404s for an unknown tenant', async () => {
    reg.getTenant.mockResolvedValue(null)
    expect((await call()).status).toBe(404)
  })

  it('400s for a bad fromStep', async () => {
    expect((await call({ fromStep: '' })).status).toBe(400)
    expect(reg.resumeProvisioningJob).not.toHaveBeenCalled()
  })

  it('409s when the job cannot be resumed', async () => {
    reg.resumeProvisioningJob.mockResolvedValue({ ok: false, reason: 'not_failed', detail: 'Job is not failed' })
    const res = await call()
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'Job is not failed', reason: 'not_failed' })
    expect(steps.advanceProvisioningJob).not.toHaveBeenCalled()
  })

  it('resumes from the failed step and kicks one advance', async () => {
    const res = await call({ fromStep: 'create_db' })
    expect(await res.json()).toEqual({ ok: true, resumedFrom: 'create_db', jobStatus: 'running', step: 'create_db', error: null })
    expect(reg.resumeProvisioningJob).toHaveBeenCalledWith('t-1', { fromStep: 'create_db', legacySteps: ['legacy'] })
    expect(steps.advanceProvisioningJob).toHaveBeenCalledTimes(1)
  })

  it('accepts an empty body and survives a failing advance', async () => {
    steps.advanceProvisioningJob.mockRejectedValue(new Error('boom'))
    const res = await POST(new NextRequest('http://localhost/x', { method: 'POST' }), { params: Promise.resolve({ id: 't-1' }) })
    expect(res.status).toBe(200)
    expect(reg.resumeProvisioningJob).toHaveBeenCalledWith('t-1', { fromStep: undefined, legacySteps: ['legacy'] })
  })
})
