// Every database mode × plan × layout × open store request, run tick by tick through the real runner and the
// real workload render (k8s client, AWS and databases stubbed): no step may hit a guard like "runs no
// all-in-one app to keep", the render keeps the old app only where one runs, and a stop or deprovision at
// any step leaves the job failed, never done.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { StubProvisioningProvider } from '@controller/lib/provisioning/stub-provider'
import { buildPipeline } from '@controller/lib/provisioning/pipeline'
import { presetSpec } from '@/lib/compute/presets'

vi.mock('server-only', () => ({}))

const reg = vi.hoisted(() => ({
  getTenant: vi.fn(),
  getProvisioningJob: vi.fn(),
  updateProvisioningJob: vi.fn(),
  setTenantStatus: vi.fn(),
  setStoreRequest: vi.fn(),
  writeTenantInfra: vi.fn(),
  writeTenantEc2: vi.fn(),
  clearTenantInfra: vi.fn(),
  clearTenantCache: vi.fn(),
  getTenantWarehouse: vi.fn(),
  getKyc: vi.fn(),
  controlPlanePool: vi.fn(),
}))
vi.mock('@/lib/tenant-registry', () => reg)
vi.mock('@/lib/tenant-registry/custom-domains', () => ({ listCustomDomains: vi.fn(async () => []), routedCustomDomains: vi.fn(async () => []) }))
const client = vi.hoisted(() => ({ get: vi.fn(), apply: vi.fn(), list: vi.fn(), listAll: vi.fn(), remove: vi.fn(), patchMerge: vi.fn() }))
vi.mock('@/lib/k8s/client', () => client)
// The real render and apply (where the guard lives); servers, disks and pod readiness answer at once.
vi.mock('@/lib/k8s/tenant-compute', async importOriginal => ({
  ...(await importOriginal<any>()),
  ensureTenantNodes: vi.fn(async () => ({ ready: true, instances: {} })),
  ensureNodeDbVolume: vi.fn(async () => ({ attached: true, detail: 'attached' })),
  postgresPodReady: vi.fn(async () => true),
}))
vi.mock('@/lib/shared/ec2-client', () => ({ describeTenantDbVolume: vi.fn(async () => null) }))
vi.mock('@controller/lib/provisioning/tenant-db-secret', () => ({ getOrCreateTenantDbPassword: vi.fn(async () => 'pw') }))
vi.mock('@controller/lib/provisioning/tenant-admin-pool', async importOriginal => ({
  ...(await importOriginal<any>()),
  withTenantAdminPool: vi.fn(async (_t: unknown, fn: (p: any) => unknown) => fn({ query: async () => ({ rowCount: 1, rows: [{}] }) })),
  tenantAdminPool: vi.fn(async () => null),
}))
vi.mock('@controller/lib/compute/shared-db', () => ({
  // The seat's host is an instance the stub provider knows, so wait_db_available finds its endpoint.
  reserveSharedDbHost: vi.fn(async (p: any) => (await p.createDbInstance({ dbInstanceId: 'shared-1' }), { id: 'shared-1' })),
  markSharedDbHostAvailable: vi.fn(),
  releaseSharedDbSeat: vi.fn(),
  tenantDbNames: (slug: string) => ({ db: `t_${slug}`, role: `app_${slug}` }),
}))
vi.mock('@controller/lib/legals/provision', () => ({ generateTenantLegals: vi.fn() }))
vi.mock('@controller/lib/provisioning/start-store', () => ({ notifyStoreLive: vi.fn(async () => false) }))
vi.mock('@/lib/billing/requested-addons', () => ({ activateRequestedAddons: vi.fn(async () => undefined) }))
vi.mock('@controller/lib/provisioning/alerts', () => ({ alertProvisioningFailure: vi.fn() }))

type Mode = 'node' | 'dedicated' | 'shared'
type Layout = 'new' | 'stale' | 'old-app'
const MODES: Mode[] = ['node', 'dedicated', 'shared']
const PLANS = [
  ['basic', 'basic'],
  ['growth', 'small'],
  ['pro', 'medium'],
  ['enterprise', 'large'],
] as const
// new: no applied spec yet. stale: an applied spec naming no layout (as the compute worker once wrote it) and no
// old app. old-app: the store still runs the all-in-one app.
const LAYOUTS: Layout[] = ['new', 'stale', 'old-app']
const DB = {
  node: { mode: 'node', class: null, storageGb: 20, multiAz: false },
  dedicated: { mode: 'dedicated', class: 'db.t4g.micro', storageGb: 20, multiAz: false },
  shared: { mode: 'shared', class: null, storageGb: 10, multiAz: false },
} as const
const SLUG = 'acme'
const OLD_APP = `${SLUG}-controller-service`
const GUARD = /all-in-one|can only run its own services/

const specFor = (mode: Mode, preset: string) => ({ ...presetSpec(preset as any), db: { ...DB[mode] } })

interface Scenario {
  mode: Mode
  plan: string
  preset: string
  layout: Layout
  storeRequest: boolean
}

const scenarios: Scenario[] = MODES.flatMap(mode =>
  PLANS.flatMap(([plan, preset]) =>
    LAYOUTS.flatMap(layout => [false, true].map(storeRequest => ({ mode, plan, preset, layout, storeRequest })))
  )
)
const label = (s: Scenario) => `${s.mode} · ${s.plan} · ${s.layout}${s.storeRequest ? ' · store request open' : ''}`

let tenant: any
let job: any
let stopped: boolean
let terminateAfterReads: number | null

function setup(s: Scenario) {
  const spec = specFor(s.mode, s.preset)
  tenant = {
    id: 't-1',
    slug: SLUG,
    plan: s.plan,
    display_name: 'Acme',
    // A services workspace stays active while its store request is open.
    status: s.storeRequest ? 'active' : 'provisioning',
    store_request: s.storeRequest ? 'provisioning' : null,
    service_types: s.storeRequest ? ['messaging', 'store'] : ['store'],
    rds_endpoint: null,
    ec2_instance_id: null,
  }
  job = { id: 'job-1', tenant_id: 't-1', step: 'preflight', status: 'pending', attempts: 0, last_error: null, created_resources: { computeSpec: spec }, pipeline: null }
  stopped = false
  terminateAfterReads = null
  const applied = s.layout === 'new' ? null : s.layout === 'stale' ? spec : { ...spec, layout: 'controller' }
  reg.controlPlanePool.mockReturnValue({
    query: vi.fn(async (sql: string) => ({
      rows: /FROM tenant_compute WHERE tenant_id/.test(sql) && applied ? [{ tenant_id: 't-1', desired: spec, applied, node_gen: 0, status: 'applied' }] : [],
      rowCount: 0,
    })),
  })
  const oldApp = s.layout === 'old-app' ? { metadata: { name: OLD_APP }, spec: { template: { spec: { containers: [{ image: 'ctrl:old' }] } } }, status: { readyReplicas: 1 } } : null
  client.get.mockImplementation(async (kind: string, name: string) => (kind === 'Deployment' && name === OLD_APP ? oldApp : null))
}

// The worker's view: re-read the job each tick, as activeProvisioningJobs/getProvisioningJob do.
reg.getTenant.mockImplementation(async () => {
  if (terminateAfterReads !== null && terminateAfterReads-- <= 0) tenant.status = 'terminated'
  return { ...tenant }
})
reg.getProvisioningJob.mockImplementation(async () => ({ ...job }))
reg.updateProvisioningJob.mockImplementation(async (_id: string, patch: any) => {
  if (patch.step) job.step = patch.step
  if (patch.pipeline) job.pipeline = patch.pipeline
  if (patch.created_resources) job.created_resources = patch.created_resources
  if (patch.last_error !== undefined) job.last_error = patch.last_error
  // updateProvisioningJob's sticky stop: a stopped job stays failed whatever the patch says.
  if (patch.status) job.status = stopped ? 'failed' : patch.status
  return job.status
})
reg.writeTenantInfra.mockImplementation(async (_id: string, infra: any) => {
  tenant.rds_endpoint = infra.rdsEndpoint ?? tenant.rds_endpoint
})

async function drive(stopAt?: { step: string; kind: 'before' | 'during' | 'sticky' }): Promise<{ returned: string[]; errors: string[] }> {
  const { advanceProvisioningJob } = await import('@controller/lib/provisioning/steps')
  const provider = new StubProvisioningProvider(0)
  const returned: string[] = []
  const errors: string[] = []
  for (let tick = 0; tick < 40 && job.status !== 'done' && job.status !== 'failed'; tick++) {
    const read = { ...job }
    if (stopAt && job.step === stopAt.step) {
      if (stopAt.kind === 'before') tenant.status = 'terminated'
      // The tick's first read sees the store; the teardown lands while the step runs.
      if (stopAt.kind === 'during') terminateAfterReads = 1
      // stopProvisioningJob lands after the worker read the job as pending.
      if (stopAt.kind === 'sticky') {
        stopped = true
        job.status = 'failed'
        job.last_error = 'stopped by ops: deprovisioned'
      }
      stopAt = undefined
    }
    returned.push(await advanceProvisioningJob(read as any, provider))
    if (job.last_error && !/^stopped/.test(job.last_error)) errors.push(`${read.step}: ${job.last_error}`)
  }
  return { returned, errors }
}

const appliedDeployments = () =>
  client.apply.mock.calls.map(c => c[0]).filter((o: any) => o?.kind === 'Deployment').map((o: any) => o.metadata.name as string)
const recordedLayouts = () =>
  reg.controlPlanePool.mock.results
    .flatMap(r => r.value.query.mock.calls)
    .filter((c: any[]) => /INSERT INTO tenant_compute/.test(c[0]))
    .map((c: any[]) => JSON.parse(c[1][1]).layout)

beforeEach(() => {
  vi.clearAllMocks()
  for (const f of [reg.setTenantStatus, reg.setStoreRequest, reg.writeTenantEc2, reg.clearTenantInfra, client.apply, client.remove, client.patchMerge])
    f.mockResolvedValue(undefined)
  reg.getTenantWarehouse.mockResolvedValue(null)
  reg.getKyc.mockResolvedValue(null)
  client.list.mockResolvedValue([])
  client.listAll.mockResolvedValue([])
  process.env.PROVISIONING_COMPUTE = 'k8s'
  process.env.CLUSTER_INGRESS_IP = '198.51.100.7'
  process.env.RDS_MASTER_PASSWORD = 'pw'
})
afterEach(() => {
  for (const k of ['PROVISIONING_COMPUTE', 'CLUSTER_INGRESS_IP', 'RDS_MASTER_PASSWORD']) delete process.env[k]
})

const DB_STEPS: Record<Mode, string[]> = {
  node: ['launch_server', 'attach_db_disk', 'start_postgres', 'create_database'],
  shared: ['create_db_instance', 'wait_db_available'],
  dedicated: ['create_param_group', 'create_db_instance', 'wait_db_available'],
}

describe('pipeline matrix: a build runs to done on every database mode, plan and layout', () => {
  it.each(scenarios.map(s => [label(s), s] as const))('%s', async (_name, s) => {
    setup(s)
    const pipeline = buildPipeline(specFor(s.mode, s.preset) as any, s.plan, { engine: 'k8s', provider: 'stub', restore: false, seed: false })
    expect(pipeline.jobs.find(j => j.id === 'database')!.steps.map(x => x.id)).toEqual(DB_STEPS[s.mode])

    const { returned, errors } = await drive()

    expect(errors).toEqual([])
    expect(errors.join(' ')).not.toMatch(GUARD)
    expect(job.status).toBe('done')
    expect(returned.at(-1)).toBe('done')
    // Every step the pipeline pinned ran in order.
    expect(job.step).toBe(job.pipeline.jobs.at(-1).steps.at(-1).id)

    // The render keeps the old app only where one runs; anything else gets its own services.
    const deployed = appliedDeployments()
    if (s.layout === 'old-app') {
      expect(deployed).toContain(OLD_APP)
      expect(deployed).not.toContain(`${SLUG}-storefront-service`)
    } else {
      expect(deployed).toContain(`${SLUG}-storefront-service`)
      expect(deployed).not.toContain(OLD_APP)
    }
    // ...and records it, so the next render agrees.
    expect(new Set(recordedLayouts())).toEqual(new Set([s.layout === 'old-app' ? 'controller' : 'services']))
    expect(reg.setTenantStatus).toHaveBeenCalledWith('t-1', 'active')
    expect(reg.setStoreRequest).toHaveBeenCalledWith('t-1', null)
  })
})

describe('pipeline matrix: a store still being built is left to its own job', () => {
  it.each(MODES)('%s: plan-change reconcile waits for an open store request', async mode => {
    setup({ mode, plan: 'basic', preset: 'basic', layout: 'new', storeRequest: true })
    const { reconcileK8sPlan } = await import('@controller/lib/provisioning/steps')
    const r = await reconcileK8sPlan('t-1', new StubProvisioningProvider(0), { force: true })
    expect(r).toMatchObject({ ok: false, error: 'store still being built' })
    expect(client.apply).not.toHaveBeenCalled()
  })
})

describe('pipeline matrix: a stop or deprovision at any step never ends done', () => {
  const stops = MODES.flatMap(mode =>
    [false, true].flatMap(storeRequest => {
      const s: Scenario = { mode, plan: 'basic', preset: 'basic', layout: 'new', storeRequest }
      const steps = buildPipeline(specFor(mode, 'basic') as any, 'basic', { engine: 'k8s', provider: 'stub', restore: false, seed: false }).jobs.flatMap(j =>
        j.steps.map(x => x.id)
      )
      return steps.flatMap(step => (['before', 'during', 'sticky'] as const).map(kind => [`${label(s)} · ${kind} ${step}`, s, step, kind] as const))
    })
  )

  it.each(stops)('%s', async (_name, s, step, kind) => {
    setup(s)
    const { returned } = await drive({ step, kind })
    expect(job.status).toBe('failed')
    expect(returned).not.toContain('done')
    expect(job.last_error).toMatch(/^stopped/)
    // Never brought back online once the teardown has it.
    expect(reg.setTenantStatus).not.toHaveBeenCalledWith('t-1', 'active')
  })
})
