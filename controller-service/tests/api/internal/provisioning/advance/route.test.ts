import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

const reg = vi.hoisted(() => ({ getProvisioningJob: vi.fn() }))
vi.mock('@/lib/tenant-registry', () => reg)
const steps = vi.hoisted(() => ({ advanceProvisioningJob: vi.fn() }))
vi.mock('@controller/lib/provisioning/steps', () => steps)
vi.mock('@controller/lib/provisioning', () => ({ getProvisioningProvider: () => ({ name: 'fake' }) }))
const owner = vi.hoisted(() => ({ fireOwnerAdmin: vi.fn(async () => {}) }))
vi.mock('@controller/lib/tenancy/tenant-admin-provision', () => owner)
const pipeline = vi.hoisted(() => ({ issuesOwnerCertificate: vi.fn() }))
vi.mock('@controller/lib/provisioning/pipeline', () => pipeline)
const redis = vi.hoisted(() => ({ set: vi.fn() }))
vi.mock('@/lib/shared/redis', () => ({ default: redis }))

import { POST } from '@controller/app/api/(internal)/internal/provisioning/advance/route'

const call = (body: unknown = { tenantId: 't-1' }, auth: string | null = 'Bearer test-cron-secret') =>
  POST(
    new NextRequest('http://localhost/api/internal/provisioning/advance', {
      method: 'POST',
      headers: auth ? { authorization: auth } : {},
      body: typeof body === 'string' ? body : JSON.stringify(body),
    })
  )
const job = (over: Record<string, unknown> = {}) => ({ tenant_id: 't-1', status: 'running', step: 'create_db', pipeline: [], next_attempt_at: null, ...over })

beforeEach(() => {
  vi.clearAllMocks()
  vi.useRealTimers()
  vi.stubEnv('CRON_SECRET', 'test-cron-secret')
  vi.stubEnv('APP_URL', 'http://app.test')
  reg.getProvisioningJob.mockResolvedValue(job())
  steps.advanceProvisioningJob.mockResolvedValue('done')
  pipeline.issuesOwnerCertificate.mockReturnValue(false)
  redis.set.mockResolvedValue('OK')
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('POST /api/internal/provisioning/advance', () => {
  it('rejects a missing or wrong secret', async () => {
    expect((await call({ tenantId: 't-1' }, null)).status).toBe(401)
    expect((await call({ tenantId: 't-1' }, 'Bearer x')).status).toBe(401)
    expect(steps.advanceProvisioningJob).not.toHaveBeenCalled()
  })

  it('needs a tenantId', async () => {
    expect((await call({})).status).toBe(400)
    expect((await call('not json')).status).toBe(400)
  })

  it('stops the loop for a finished job, creating the owner admin once', async () => {
    reg.getProvisioningJob.mockResolvedValue(job({ status: 'done' }))
    const res = await call()
    expect(await res.json()).toEqual({ done: true, status: 'done' })
    expect(owner.fireOwnerAdmin).toHaveBeenCalledWith('t-1')
    expect(steps.advanceProvisioningJob).not.toHaveBeenCalled()
  })

  it('skips the owner admin when the pipeline issued the certificate', async () => {
    reg.getProvisioningJob.mockResolvedValue(job({ status: 'done' }))
    pipeline.issuesOwnerCertificate.mockReturnValue(true)
    await call()
    expect(owner.fireOwnerAdmin).not.toHaveBeenCalled()
  })

  it('reports none for an unknown job', async () => {
    reg.getProvisioningJob.mockResolvedValue(null)
    expect(await (await call()).json()).toEqual({ done: true, status: 'none' })
  })

  it('waits when the backoff timer is not due', async () => {
    reg.getProvisioningJob.mockResolvedValue(job({ next_attempt_at: new Date(Date.now() + 30_000).toISOString() }))
    const res = await call()
    const body = await res.json()
    expect(body.waiting).toBe(true)
    expect(body.dueInMs).toBeGreaterThan(0)
    expect(steps.advanceProvisioningJob).not.toHaveBeenCalled()
  })

  it('skips when another tick holds the lock', async () => {
    redis.set.mockResolvedValue(null)
    expect(await (await call()).json()).toEqual({ skipped: 'locked' })
    expect(steps.advanceProvisioningJob).not.toHaveBeenCalled()
  })

  it('advances one step and creates the owner admin on done', async () => {
    const res = await call()
    expect(await res.json()).toEqual({ advanced: true, step: 'create_db', status: 'done' })
    expect(redis.set).toHaveBeenCalledWith('prov:lock:t-1', '1', 'PX', 30000, 'NX')
    expect(steps.advanceProvisioningJob).toHaveBeenCalledTimes(1)
    expect(owner.fireOwnerAdmin).toHaveBeenCalledWith('t-1')
  })

  it('schedules the next tick while the job is pending', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn().mockResolvedValue({})
    vi.stubGlobal('fetch', fetchMock)
    steps.advanceProvisioningJob.mockResolvedValue('pending')
    const res = await call()
    expect((await res.json()).status).toBe('pending')
    expect(fetchMock).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(15_000)
    expect(fetchMock).toHaveBeenCalledWith(
      'http://app.test/api/internal/provisioning/advance',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ tenantId: 't-1' }) })
    )
  })

  it('stops and reports the error when a step throws', async () => {
    steps.advanceProvisioningJob.mockRejectedValue(new Error('rds quota'))
    const res = await call()
    expect((await res.json()).status).toBe('error: rds quota')
    expect(owner.fireOwnerAdmin).not.toHaveBeenCalled()
  })
})
