// A running store's compute change: servers move by generation without downtime, the database changes
// online first and its class in the window, and a move between a shared and its own database copies
// the data while the store is offline.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { StubProvisioningProvider } from '@controller/lib/provisioning/stub-provider'
import { presetSpec } from '@/lib/compute/presets'
import type { ComputeSpec } from '@/lib/compute/spec'

vi.mock('server-only', () => ({}))

const reg = vi.hoisted(() => ({
  getTenant: vi.fn(),
  getProvisioningJob: vi.fn(),
  updateProvisioningJob: vi.fn(),
  clearTenantCache: vi.fn(),
  setTenantInstanceState: vi.fn(),
  writeTenantEc2: vi.fn(),
  writeTenantInfra: vi.fn(),
  controlPlanePool: vi.fn(),
}))
vi.mock('@/lib/tenant-registry', () => reg)
vi.mock('@/lib/tenant-registry/custom-domains', () => ({ listCustomDomains: vi.fn().mockResolvedValue([]) }))
vi.mock('@/lib/tenant-registry/lifecycle', () => ({ clearTenantEc2Instance: vi.fn() }))
vi.mock('@controller/lib/provisioning/alerts', () => ({ alertProvisioningFailure: vi.fn() }))

let row: any
const store = vi.hoisted(() => ({ getTenantCompute: vi.fn(), patchTenantCompute: vi.fn() }))
vi.mock('@controller/lib/compute/store', () => store)
vi.mock('@controller/lib/compute/catalog', () => ({
  computeSpecEnabled: () => true,
  getCatalog: () => Promise.reject(new Error('no db')),
  DEFAULT_SETTINGS: { sharedDbMaxConnections: 200, sharedDbCapacity: 8 },
}))
const shared = vi.hoisted(() => ({
  reserveSharedDbHost: vi.fn(),
  markSharedDbHostAvailable: vi.fn(),
  releaseSharedDbSeat: vi.fn(),
  tenantDbNames: (slug: string) => ({ db: `t_${slug}`, role: `app_${slug}` }),
}))
vi.mock('@controller/lib/compute/shared-db', () => shared)

const k8s = vi.hoisted(() => ({
  ensureTenantNodes: vi.fn(),
  applyTenantWorkload: vi.fn(),
  tenantRolloutComplete: vi.fn(),
  removeTenantNodes: vi.fn(),
  terminateTenantInstance: vi.fn(),
  clusterIngressIp: () => '198.51.100.7',
  restartTenantWorkload: vi.fn(),
}))
vi.mock('@/lib/k8s/tenant-compute', () => k8s)

import { reconcileCompute } from '@controller/lib/provisioning/compute-reconcile'

const TENANT = { id: 't-1', slug: 'acme', plan: 'pro', status: 'active', rds_endpoint: 'old-ep', rds_db: 'jeffi_stores', rds_user: null, shared_db_host: null, s3_bucket: 'b' }
const SHARED_SOURCE = { kind: 'shared', id: 'jeffi-starter-1', endpoint: 'host-ep', dbName: 't_acme', role: 'app_acme' }
const OWN_TARGET = { kind: 'dedicated', id: 'jeffi-tenant-acme', endpoint: 'new-ep', dbName: 'jeffi_stores', role: null }
const small = presetSpec('small')
const medium = presetSpec('medium')

function given(applied: ComputeSpec, desired: ComputeSpec, extra: any = {}) {
  row = { tenant_id: 't-1', applied, desired, status: 'pending', apply_mode: 'window', node_gen: 0, attempts: 0, progress: null, last_error: null, ...extra }
}

beforeEach(() => {
  vi.clearAllMocks()
  reg.getTenant.mockResolvedValue({ ...TENANT })
  reg.getProvisioningJob.mockResolvedValue({ id: 'job-1', created_resources: { dbInstanceId: 'jeffi-tenant-acme' } })
  for (const f of [reg.updateProvisioningJob, reg.setTenantInstanceState, reg.writeTenantEc2, reg.writeTenantInfra, k8s.applyTenantWorkload, k8s.restartTenantWorkload]) f.mockResolvedValue(undefined)
  store.getTenantCompute.mockImplementation(async () => row)
  store.patchTenantCompute.mockImplementation(async (_id: string, patch: any) => {
    row = { ...row, ...JSON.parse(JSON.stringify(patch)) }
  })
  k8s.tenantRolloutComplete.mockResolvedValue(true)
  k8s.removeTenantNodes.mockResolvedValue(['i-old'])
  k8s.terminateTenantInstance.mockResolvedValue('terminated')
})

describe('reconcileCompute', () => {
  it('moves to a bigger server type by starting the next generation, then removes the old servers', async () => {
    given(small, { ...small, node: { ...small.node, type: 't4g.medium' } })
    k8s.ensureTenantNodes.mockImplementation(async (_s: string, _n: any, gen: number, _k: any, onLaunched: any) => {
      await onLaunched('i-new', 'dedicated', `t-acme.${gen}-0`)
      return { ready: true }
    })
    const provider = new StubProvisioningProvider(0)
    expect(await reconcileCompute('t-1', provider)).toMatchObject({ ok: true, status: 'applied' })
    expect(k8s.ensureTenantNodes.mock.calls[0][2]).toBe(1)
    expect(k8s.applyTenantWorkload.mock.calls[0][0]).toMatchObject({ nodeGen: 1 })
    expect(k8s.removeTenantNodes).toHaveBeenCalledWith('acme', ['t-acme.1-0'])
    expect(k8s.terminateTenantInstance).toHaveBeenCalledWith('acme', 'i-old', expect.any(Function))
    expect(reg.writeTenantEc2).toHaveBeenCalledWith('t-1', '198.51.100.7', 'i-new')
    expect(row).toMatchObject({ status: 'applied', node_gen: 1, progress: null })
    expect(row.applied.node.type).toBe('t4g.medium')
  })

  it('waits for pods to move before removing the old servers', async () => {
    given(small, { ...small, node: { ...small.node, type: 't4g.medium' } })
    k8s.ensureTenantNodes.mockResolvedValue({ ready: true })
    k8s.tenantRolloutComplete.mockResolvedValue(false)
    expect(await reconcileCompute('t-1', new StubProvisioningProvider(0))).toMatchObject({ status: 'applying' })
    expect(k8s.removeTenantNodes).not.toHaveBeenCalled()
    expect(row.progress).toMatchObject({ gen: 1, podsApplied: true })
  })

  it('grows storage at once and queues a class change for the maintenance window', async () => {
    given(small, { ...small, db: { ...small.db, class: 'db.t4g.small', storageGb: 50 } })
    const provider = new StubProvisioningProvider(0)
    await provider.createDbInstance({ dbInstanceId: 'jeffi-tenant-acme', paramGroup: 'pg', maxConnections: 50, instanceClass: 'db.t4g.micro', storageGb: 20 })
    const modify = vi.spyOn(provider, 'modifyDbInstance')
    vi.spyOn(provider, 'describeDbInstance').mockImplementation(async () => provider.shapes.get('jeffi-tenant-acme')!)
    await reconcileCompute('t-1', provider)
    expect(modify.mock.calls[0][1]).toEqual({ storageGb: 50, multiAz: undefined, applyImmediately: true })

    // The class change only applies in the window: the stub would apply it at once, so hold it back.
    modify.mockResolvedValue(undefined)
    const r = await reconcileCompute('t-1', provider)
    expect(modify.mock.calls[1][1]).toEqual({ instanceClass: 'db.t4g.small', applyImmediately: false })
    expect(r.status).toBe('waiting for the maintenance window')
    expect(row.applied.db.storageGb).toBe(50)
    expect(row.applied.db.class).toBe('db.t4g.micro')
  })

  it('moves a Starter store onto its own database: copy while offline, switch, keep the old one a day', async () => {
    const starter = presetSpec('shared')
    reg.getTenant.mockResolvedValue({ ...TENANT, plan: 'starter', rds_endpoint: 'host-ep', rds_db: 't_acme', rds_user: 'app_acme', shared_db_host: 'jeffi-starter-1' })
    given(starter, { ...starter, db: small.db })
    k8s.ensureTenantNodes.mockResolvedValue({ ready: true })
    const provider = new StubProvisioningProvider(0)
    const backup = vi.spyOn(provider, 'backupDb').mockResolvedValue(Buffer.from('dump'))
    const restore = vi.spyOn(provider, 'restoreDb')

    await reconcileCompute('t-1', provider) // create
    await reconcileCompute('t-1', provider) // available → schema
    await reconcileCompute('t-1', provider) // offline
    expect(reg.setTenantInstanceState).toHaveBeenCalledWith('t-1', 'migrating')
    await reconcileCompute('t-1', provider) // still draining requests
    expect(backup).not.toHaveBeenCalled()

    row.progress.move.frozenAt = Date.now() - 120_000
    await reconcileCompute('t-1', provider)
    expect(backup).toHaveBeenCalledWith('host-ep', 't_acme')
    expect(restore.mock.calls[0][1]).toBe('jeffi_stores')
    expect(reg.writeTenantInfra).toHaveBeenCalledWith('t-1', { rdsEndpoint: expect.stringContaining('jeffi-tenant-acme'), s3Bucket: 'b' })
    expect(k8s.restartTenantWorkload).toHaveBeenCalledWith('acme')
    expect(reg.setTenantInstanceState).toHaveBeenLastCalledWith('t-1', 'running')
    expect(row.applied.db).toMatchObject({ mode: 'dedicated', class: 'db.t4g.micro' })
    expect(row.progress.oldDb).toMatchObject({ kind: 'shared', id: 'jeffi-starter-1', dbName: 't_acme' })
  })

  it('serves from the old database again when the copy fails', async () => {
    reg.getTenant.mockResolvedValue({ ...TENANT, rds_endpoint: 'host-ep', rds_db: 't_acme', rds_user: 'app_acme', shared_db_host: 'jeffi-starter-1' })
    given(presetSpec('shared'), { ...presetSpec('shared'), db: small.db }, {
      progress: { move: { step: 'copy', frozenAt: 0, source: SHARED_SOURCE, target: OWN_TARGET } },
    })
    const provider = new StubProvisioningProvider(0)
    const backup = vi.spyOn(provider, 'backupDb').mockRejectedValue(new Error('connection reset'))
    const r = await reconcileCompute('t-1', provider)
    expect(backup).toHaveBeenCalledWith('host-ep', 't_acme')
    expect(r.ok).toBe(false)
    expect(reg.setTenantInstanceState).toHaveBeenCalledWith('t-1', 'running')
    expect(row.progress.move.step).toBe('freeze')
    expect(reg.writeTenantInfra).not.toHaveBeenCalled()
  })

  it('keeps the database it moved from when a step after the switch is retried', async () => {
    // The switch landed, so the registry now points at the new database.
    reg.getTenant.mockResolvedValue({ ...TENANT, rds_endpoint: 'new-ep', rds_db: 'jeffi_stores' })
    given(presetSpec('shared'), { ...presetSpec('shared'), db: small.db }, {
      progress: { move: { step: 'copy', frozenAt: 0, source: SHARED_SOURCE, target: OWN_TARGET } },
    })
    const provider = new StubProvisioningProvider(0)
    const backup = vi.spyOn(provider, 'backupDb')
    await reconcileCompute('t-1', provider)
    expect(backup).not.toHaveBeenCalled()
    expect(row.progress.oldDb).toMatchObject({ id: 'jeffi-starter-1', endpoint: 'host-ep', dbName: 't_acme' })

    // A day later the old database goes, never the one in use.
    const drop = vi.spyOn(provider, 'dropTenantDatabase')
    row.progress.oldDb.dropAfter = 0
    row.status = 'applied'
    await reconcileCompute('t-1', provider)
    expect(drop).toHaveBeenCalledWith('host-ep', 't_acme', 'app_acme')
  })

  it('never drops the database a store is using', async () => {
    given(small, small, { status: 'applied', progress: { oldDb: { kind: 'dedicated', id: 'jeffi-tenant-acme', endpoint: 'old-ep', dbName: 'jeffi_stores', role: null, dropAfter: 0 } } })
    const provider = new StubProvisioningProvider(0)
    const del = vi.spyOn(provider, 'deleteDbInstance')
    await reconcileCompute('t-1', provider)
    expect(del).not.toHaveBeenCalled()
    expect(row.progress).toBeNull()
  })

  it('leaves a store alone while it is not live', async () => {
    reg.getTenant.mockResolvedValue({ ...TENANT, status: 'provisioning' })
    given(small, medium)
    expect(await reconcileCompute('t-1', new StubProvisioningProvider(0))).toMatchObject({ status: 'waiting for the store' })
    expect(k8s.ensureTenantNodes).not.toHaveBeenCalled()
  })
})
