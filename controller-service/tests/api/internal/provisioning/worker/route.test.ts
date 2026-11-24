import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

const client = vi.hoisted(() => ({ query: vi.fn(), release: vi.fn() }))
const pool = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn() }))
const reg = vi.hoisted(() => ({ activeProvisioningJobs: vi.fn(), getProvisioningJob: vi.fn() }))
vi.mock('@/lib/tenant-registry', () => ({ ...reg, controlPlanePool: () => pool }))
const prov = vi.hoisted(() => ({ pendingK8sPlanTenants: vi.fn() }))
vi.mock('@/lib/tenant-registry/provisioning', () => prov)
const steps = vi.hoisted(() => ({ advanceProvisioningJob: vi.fn(), reconcileK8sPlan: vi.fn() }))
vi.mock('@controller/lib/provisioning/steps', () => steps)
vi.mock('@controller/lib/provisioning', () => ({ getProvisioningProvider: () => ({ deleteAppInstance: vi.fn() }) }))
const owner = vi.hoisted(() => ({ fireOwnerAdmin: vi.fn(async () => {}) }))
vi.mock('@controller/lib/tenancy/tenant-admin-provision', () => owner)
const pipeline = vi.hoisted(() => ({ issuesOwnerCertificate: vi.fn() }))
vi.mock('@controller/lib/provisioning/pipeline', () => pipeline)
const compute = vi.hoisted(() => ({ dueComputeChanges: vi.fn(), dueLayoutSwitches: vi.fn() }))
vi.mock('@controller/lib/compute/store', () => compute)
const cr = vi.hoisted(() => ({ reconcileCompute: vi.fn() }))
vi.mock('@controller/lib/provisioning/compute-reconcile', () => cr)
const layout = vi.hoisted(() => ({ reconcileLayout: vi.fn() }))
vi.mock('@controller/lib/provisioning/layout-switch', () => layout)
const start = vi.hoisted(() => ({ startStoreIfReady: vi.fn() }))
vi.mock('@controller/lib/provisioning/start-store', () => start)
const k8s = vi.hoisted(() => ({ k8sComputeEnabled: vi.fn(), reclaimEmptyPoolNodes: vi.fn() }))
vi.mock('@/lib/k8s/tenant-compute', () => k8s)
const alerts = vi.hoisted(() => ({ sweepProvisioningIncidents: vi.fn() }))
vi.mock('@controller/lib/provisioning/alerts', () => alerts)

import { GET } from '@controller/app/api/(internal)/internal/provisioning/worker/route'

const call = (auth: string | null = 'Bearer test-cron-secret') =>
  GET(new NextRequest('http://localhost/api/internal/provisioning/worker', { headers: auth ? { authorization: auth } : {} }))

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('CRON_SECRET', 'test-cron-secret')
  pool.connect.mockResolvedValue(client)
  client.query.mockResolvedValue({ rows: [{ ok: true }] })
  pool.query.mockResolvedValue({ rows: [] })
  reg.activeProvisioningJobs.mockResolvedValue([])
  reg.getProvisioningJob.mockResolvedValue(null)
  prov.pendingK8sPlanTenants.mockResolvedValue([])
  compute.dueComputeChanges.mockResolvedValue([])
  compute.dueLayoutSwitches.mockResolvedValue([])
  start.startStoreIfReady.mockResolvedValue(true)
  k8s.k8sComputeEnabled.mockReturnValue(false)
  alerts.sweepProvisioningIncidents.mockResolvedValue({ opened: 0 })
  steps.advanceProvisioningJob.mockResolvedValue('pending')
  pipeline.issuesOwnerCertificate.mockReturnValue(false)
})
afterEach(() => vi.unstubAllEnvs())

describe('GET /api/internal/provisioning/worker', () => {
  it('rejects a missing or wrong secret', async () => {
    expect((await call(null)).status).toBe(401)
    expect((await call('Bearer x')).status).toBe(401)
    expect(pool.connect).not.toHaveBeenCalled()
  })

  it('skips when a previous tick holds the advisory lock', async () => {
    client.query.mockResolvedValue({ rows: [{ ok: false }] })
    const res = await call()
    expect(await res.json()).toEqual({ success: true, skipped: 'previous tick still running' })
    expect(reg.activeProvisioningJobs).not.toHaveBeenCalled()
    expect(client.release).toHaveBeenCalled()
  })

  it('an idle tick still sweeps incidents and releases the lock', async () => {
    const res = await call()
    expect(await res.json()).toEqual({ success: true, advanced: 0, results: [], incidents: { opened: 0 } })
    expect(alerts.sweepProvisioningIncidents).toHaveBeenCalledTimes(1)
    const sqls = client.query.mock.calls.map(c => c[0])
    expect(sqls[0]).toContain('pg_try_advisory_lock')
    expect(sqls[1]).toContain('pg_advisory_unlock')
    expect(client.release).toHaveBeenCalledTimes(1)
  })

  it('advances each live job one step and creates the owner admin on done', async () => {
    reg.activeProvisioningJobs.mockResolvedValue([{ tenant_id: 't-1' }, { tenant_id: 't-2' }, { tenant_id: 't-3' }])
    reg.getProvisioningJob
      .mockResolvedValueOnce({ tenant_id: 't-1', status: 'running', step: 'a', pipeline: [] })
      .mockResolvedValueOnce({ tenant_id: 't-2', status: 'done', step: 'z', pipeline: [] })
      .mockResolvedValueOnce({ tenant_id: 't-3', status: 'running', step: 'b', pipeline: [] })
    steps.advanceProvisioningJob.mockResolvedValueOnce('done').mockRejectedValueOnce(new Error('rds'))
    const body = await (await call()).json()
    expect(body.results).toEqual([
      { tenantId: 't-1', step: 'a', status: 'done' },
      { tenantId: 't-3', step: 'b', status: 'error: rds' },
    ])
    expect(owner.fireOwnerAdmin).toHaveBeenCalledTimes(1)
    expect(owner.fireOwnerAdmin).toHaveBeenCalledWith('t-1')
  })

  it('runs plan, compute, layout and start-store follow-ups', async () => {
    prov.pendingK8sPlanTenants.mockResolvedValue(['p-1'])
    steps.reconcileK8sPlan.mockResolvedValue({ ok: true })
    compute.dueComputeChanges.mockResolvedValue(['c-1', 'c-2'])
    cr.reconcileCompute.mockResolvedValueOnce({ ok: true, status: 'applied' }).mockRejectedValueOnce(new Error('node'))
    compute.dueLayoutSwitches.mockResolvedValue(['l-1'])
    layout.reconcileLayout.mockResolvedValue({ ok: true, status: 'services', detail: 'moved' })
    pool.query.mockResolvedValue({ rows: [{ id: 's-1' }] })
    const body = await (await call()).json()
    expect(body.results).toEqual([
      { tenantId: 'p-1', step: 'k8s_plan', status: 'applied' },
      { tenantId: 'c-1', step: 'compute_change', status: 'applied' },
      { tenantId: 'c-2', step: 'compute_change', status: 'error: node' },
      { tenantId: 'l-1', step: 'layout_switch', status: 'services: moved' },
      { tenantId: 's-1', step: 'start_store', status: 'started' },
    ])
    expect(start.startStoreIfReady).toHaveBeenCalledWith('s-1')
  })

  it('reclaims empty pool nodes in k8s mode', async () => {
    k8s.k8sComputeEnabled.mockReturnValue(true)
    k8s.reclaimEmptyPoolNodes.mockResolvedValue(['i-1'])
    const body = await (await call()).json()
    expect(body.results).toEqual([{ tenantId: '-', step: 'pool_reclaim', status: 'terminated i-1' }])
  })

  it('survives a failing incident sweep', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    alerts.sweepProvisioningIncidents.mockRejectedValue(new Error('mail'))
    const body = await (await call()).json()
    expect(body.success).toBe(true)
    expect(body.incidents).toBeNull()
  })
})
