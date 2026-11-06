// The Database steps of a store whose Postgres runs on its own server (node-db-steps.ts), and how the
// runner bounds their waits (STEP_CATALOG timeouts from step_started_at).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { StubProvisioningProvider } from '@controller/lib/provisioning/stub-provider'

vi.mock('server-only', () => ({}))

const reg = vi.hoisted(() => ({
  getTenant: vi.fn(),
  getProvisioningJob: vi.fn(),
  updateProvisioningJob: vi.fn(),
  setTenantStatus: vi.fn(),
  writeTenantInfra: vi.fn(),
  writeTenantEc2: vi.fn(),
  clearTenantInfra: vi.fn(),
  clearTenantCache: vi.fn(),
  controlPlanePool: vi.fn(),
}))
vi.mock('@/lib/tenant-registry', () => reg)
const k8s = vi.hoisted(() => ({ ensureTenantNodes: vi.fn(), ensureNodeDbVolume: vi.fn(), postgresPodReady: vi.fn() }))
vi.mock('@/lib/k8s/tenant-compute', () => k8s)
const secret = vi.hoisted(() => ({ getOrCreateTenantDbPassword: vi.fn() }))
vi.mock('@controller/lib/provisioning/tenant-db-secret', () => secret)
const adminPool = vi.hoisted(() => ({ withTenantAdminPool: vi.fn() }))
vi.mock('@controller/lib/provisioning/tenant-admin-pool', async importOriginal => ({ ...(await importOriginal<any>()), ...adminPool }))

import { attachDbDisk, createDatabase, launchServer, startPostgres, type NodeDbCtx } from '@controller/lib/provisioning/node-db-steps'

const SPEC = {
  node: { placement: 'dedicated', type: 't4g.small', count: 1 },
  db: { mode: 'node', class: null, storageGb: 20, multiAz: false },
  services: Object.fromEntries(['storefront', 'admin', 'business', 'messaging', 'documents'].map(k => [k, { replicas: 1, maxReplicas: 1, size: 'S' }])),
  storage: { s3Gb: 20 },
} as any

function ctx(res: Record<string, any> = {}, ready = true): NodeDbCtx & { placeNodes: any; applyWorkload: any } {
  return {
    slug: 'acme',
    res,
    compute: async () => ({ spec: SPEC, nodeGen: 0, dbPoolMax: 5 }),
    placeNodes: vi.fn().mockResolvedValue({ ready }),
    applyWorkload: vi.fn().mockResolvedValue(undefined),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.PROVISIONING_COMPUTE = 'k8s'
  secret.getOrCreateTenantDbPassword.mockResolvedValue('pw')
})
afterEach(() => {
  delete process.env.PROVISIONING_COMPUTE
})

describe('node-db steps', () => {
  it('launch_server records the database host, places the servers without the volume and waits until they join', async () => {
    const c = ctx({}, false)
    expect(await launchServer(c)).toMatchObject({ wait: true })
    expect(c.placeNodes).toHaveBeenCalledWith(expect.anything(), { dbVolume: false })
    expect(c.res.endpoint).toMatch(/acme/)
    expect(c.res.computeMode).toBeUndefined()

    const ready = ctx({}, true)
    expect(await launchServer(ready)).toEqual({ ok: true })
    expect(ready.res.computeMode).toBe('k8s')
    // ensure_compute's own 15-minute clock must not start here.
    expect(ready.res.computeWaitStartedAt).toBeUndefined()
  })

  it('without a cluster (stub engine) every step skips, and the database host is still recorded', async () => {
    delete process.env.PROVISIONING_COMPUTE
    const c = ctx()
    for (const step of [launchServer, attachDbDisk, startPostgres, createDatabase]) expect(await step(c)).toEqual({ skip: 'no cluster (stub engine)' })
    expect(c.placeNodes).not.toHaveBeenCalled()
    expect(c.res).toMatchObject({ endpoint: expect.stringMatching(/acme/), dbName: expect.any(String) })
  })

  it('attach_db_disk waits with the volume detail until it is attached to the first server', async () => {
    k8s.ensureNodeDbVolume.mockResolvedValueOnce({ attached: false, detail: 'attaching the database volume' }).mockResolvedValueOnce({ attached: true, detail: '' })
    const c = ctx({ nodeInstances: { 't-acme': 'i-1' } })
    expect(await attachDbDisk(c)).toEqual({ wait: true, detail: 'attaching the database volume' })
    expect(k8s.ensureNodeDbVolume).toHaveBeenCalledWith('acme', 't-acme', 20, 'i-1')
    expect(await attachDbDisk(c)).toEqual({ ok: true })
  })

  it('start_postgres applies the namespace with the stored password and waits for the pod', async () => {
    k8s.postgresPodReady.mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    const c = ctx()
    expect(await startPostgres(c)).toMatchObject({ wait: true })
    expect(secret.getOrCreateTenantDbPassword).toHaveBeenCalledWith('acme')
    expect(c.applyWorkload).toHaveBeenCalled()
    expect(await startPostgres(c)).toEqual({ ok: true })
  })

  it('create_database creates the store database once and waits on a connect error', async () => {
    const q = vi.fn().mockResolvedValueOnce({ rowCount: 0 }).mockResolvedValue({ rowCount: 1 })
    adminPool.withTenantAdminPool.mockImplementationOnce(async (_t: any, fn: any) => fn({ query: q }))
    const c = ctx()
    expect(await createDatabase(c)).toEqual({ ok: true })
    expect(q).toHaveBeenCalledWith(expect.stringMatching(/^CREATE DATABASE/))
    expect(adminPool.withTenantAdminPool).toHaveBeenCalledWith(expect.objectContaining({ dbName: 'postgres', dbPassword: 'pw' }), expect.any(Function))

    adminPool.withTenantAdminPool.mockRejectedValueOnce(new Error('ECONNREFUSED'))
    const down = ctx()
    expect(await createDatabase(down)).toEqual({ wait: true, detail: 'ECONNREFUSED' })
    expect(down.res.dbConnectError).toBe('ECONNREFUSED')
  })
})

describe('runner: a node step’s wait is bounded from step_started_at', () => {
  const TENANT = { id: 't-1', slug: 'acme', plan: 'basic', status: 'provisioning', rds_endpoint: null }
  const pipeline = { v: 2, jobs: [{ id: 'database', label: 'Database', steps: ['launch_server', 'attach_db_disk'].map(id => ({ id, label: id })) }] }
  const job = (over: any = {}) => ({ id: 'job-1', tenant_id: 't-1', step: 'launch_server', status: 'pending', attempts: 0, created_resources: { computeSpec: SPEC }, pipeline, ...over })
  const lastPatch = () => reg.updateProvisioningJob.mock.calls.at(-1)?.[1]

  beforeEach(() => {
    reg.getTenant.mockResolvedValue({ ...TENANT })
    reg.updateProvisioningJob.mockResolvedValue(undefined)
    reg.controlPlanePool.mockReturnValue({ query: vi.fn().mockResolvedValue({ rows: [] }) })
    k8s.ensureTenantNodes.mockResolvedValue({ ready: false, instances: {} })
  })

  it('keeps polling inside the timeout, with the wait detail', async () => {
    const { advanceProvisioningJob } = await import('@controller/lib/provisioning/steps')
    const res = await advanceProvisioningJob(job({ step_started_at: new Date(Date.now() - 60_000).toISOString() }) as any, new StubProvisioningProvider(0))
    expect(res).toBe('pending')
    expect(lastPatch()).toMatchObject({ status: 'pending', created_resources: { stepDetail: 'waiting for the server to join the cluster' } })
    // The node is placed without its database volume; attach_db_disk handles that.
    expect(k8s.ensureTenantNodes.mock.calls[0][5]).toBeUndefined()
  })

  it('fails the wait after the step’s timeout (retried like any error)', async () => {
    const { advanceProvisioningJob } = await import('@controller/lib/provisioning/steps')
    const res = await advanceProvisioningJob(job({ step_started_at: new Date(Date.now() - 20 * 60_000).toISOString() }) as any, new StubProvisioningProvider(0))
    expect(res).toBe('pending')
    expect(String(lastPatch().last_error)).toMatch(/launch_server: not ready within 15 min/)
    expect(lastPatch().nextAttemptAt).toBeInstanceOf(Date)
  })

  it('moves on to the next pinned step once the server is ready', async () => {
    k8s.ensureTenantNodes.mockResolvedValue({ ready: true, instances: { 't-acme': 'i-1' } })
    const { advanceProvisioningJob } = await import('@controller/lib/provisioning/steps')
    expect(await advanceProvisioningJob(job() as any, new StubProvisioningProvider(0))).toBe('pending')
    expect(lastPatch()).toMatchObject({ step: 'attach_db_disk', stepStarted: true, created_resources: { computeMode: 'k8s' } })
  })
})
