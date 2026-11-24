import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

const query = vi.hoisted(() => vi.fn())
vi.mock('@/lib/tenant-registry', () => ({ controlPlanePool: () => ({ query }) }))
const steps = vi.hoisted(() => ({ applyK8sStorePart: vi.fn(), reconcileK8sPlan: vi.fn() }))
vi.mock('@controller/lib/provisioning/steps', () => steps)
vi.mock('@controller/lib/provisioning', () => ({ getProvisioningProvider: () => ({ name: 'fake' }) }))
vi.mock('@/lib/k8s/tenant-workload', () => ({ STORE_PARTS: ['storefront', 'admin'] }))

import { POST } from '@controller/app/api/(internal)/internal/provisioning/reconcile-k8s/route'

const call = (qs = '', auth: string | null = 'Bearer test-cron-secret') =>
  POST(new NextRequest(`http://localhost/api/internal/provisioning/reconcile-k8s${qs}`, { method: 'POST', headers: auth ? { authorization: auth } : {} }))

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('CRON_SECRET', 'test-cron-secret')
  vi.stubEnv('PROVISIONING_COMPUTE', 'k8s')
  query.mockResolvedValue({ rows: [{ id: 't-1', slug: 'acme' }, { id: 't-2', slug: 'beta' }] })
  steps.reconcileK8sPlan.mockResolvedValue({ ok: true })
  steps.applyK8sStorePart.mockResolvedValue({ ok: true, runs: true, error: null })
})
afterEach(() => vi.unstubAllEnvs())

describe('POST /api/internal/provisioning/reconcile-k8s', () => {
  it('rejects a missing or wrong secret', async () => {
    expect((await call('', null)).status).toBe(401)
    expect((await call('', 'Bearer x')).status).toBe(401)
    expect(query).not.toHaveBeenCalled()
  })

  it('refuses outside k8s mode', async () => {
    vi.stubEnv('PROVISIONING_COMPUTE', 'ec2')
    expect((await call()).status).toBe(400)
  })

  it('rejects an unknown part', async () => {
    const res = await call('?part=bogus')
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Unknown part bogus' })
  })

  it('re-applies every active store at the release images', async () => {
    const res = await call()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      success: true,
      part: null,
      tenants: [
        { slug: 'acme', ok: true, error: null },
        { slug: 'beta', ok: true, error: null },
      ],
    })
    expect(steps.reconcileK8sPlan).toHaveBeenCalledWith('t-1', { name: 'fake' }, { force: true })
    expect(query.mock.calls[0][1]).toEqual([null])
  })

  it('limits to one slug', async () => {
    await call('?slug=acme')
    expect(query.mock.calls[0][1]).toEqual(['acme'])
  })

  it('applies one part per store and answers 500 when a store failed', async () => {
    steps.applyK8sStorePart.mockResolvedValueOnce({ ok: true, runs: true }).mockRejectedValueOnce(new Error('apply failed'))
    const res = await call('?part=admin')
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.success).toBe(false)
    expect(body.tenants[1]).toMatchObject({ slug: 'beta', ok: false, error: 'apply failed' })
    expect(steps.applyK8sStorePart).toHaveBeenCalledWith('t-1', 'admin')
    expect(steps.reconcileK8sPlan).not.toHaveBeenCalled()
  })

  it('records a plan error without failing the whole call', async () => {
    steps.reconcileK8sPlan.mockResolvedValueOnce({ ok: false, error: 'boom' }).mockResolvedValueOnce({ ok: true })
    const res = await call()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(false)
    expect(body.tenants[0]).toEqual({ slug: 'acme', ok: false, error: 'boom' })
  })
})
