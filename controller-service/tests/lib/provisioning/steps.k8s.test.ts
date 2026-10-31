// k8s compute paths of the provisioning engine: preflight, verify_serving, rollback/deprovision safety
// (never touch a shared node) and plan-change reconcile (errors recorded, retried or terminal).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { StubProvisioningProvider } from '@controller/lib/provisioning/stub-provider'

vi.mock('server-only', () => ({}))

const reg = {
  getTenant: vi.fn(),
  getProvisioningJob: vi.fn(),
  updateProvisioningJob: vi.fn(),
  setTenantStatus: vi.fn(),
  writeTenantInfra: vi.fn(),
  writeTenantEc2: vi.fn(),
  clearTenantInfra: vi.fn(),
  clearTenantCache: vi.fn(),
  getDraft: vi.fn(),
  controlPlanePool: vi.fn(),
}
vi.mock('@/lib/tenant-registry', () => reg)
const lifecycle = vi.hoisted(() => ({ clearTenantEc2Instance: vi.fn() }))
vi.mock('@/lib/tenant-registry/lifecycle', () => lifecycle)
vi.mock('@/lib/tenant-registry/custom-domains', () => ({ listCustomDomains: vi.fn().mockResolvedValue([]) }))
vi.mock('@/lib/tenancy/tenant-backup-store', () => ({ getTenantBackup: vi.fn(), putTenantBackup: vi.fn() }))
const poolAuto = vi.hoisted(() => ({ ensurePoolInstance: vi.fn(), deletePoolIfEmpty: vi.fn() }))
vi.mock('@controller/lib/tenancy/pool-autoscale', () => poolAuto)
const alerts = vi.hoisted(() => ({ alertProvisioningFailure: vi.fn() }))
vi.mock('@controller/lib/provisioning/alerts', () => alerts)
vi.mock('@/lib/shipping/delhivery', () => ({
  deactivateDelhiveryPickupLocation: vi.fn().mockResolvedValue({ ok: true }),
}))

const k8s = vi.hoisted(() => ({ list: vi.fn(), get: vi.fn(), apply: vi.fn(), remove: vi.fn() }))
vi.mock('@/lib/k8s/client', () => k8s)
const ec2 = vi.hoisted(() => ({ runInstance: vi.fn(), describeInstanceName: vi.fn() }))
vi.mock('@/lib/shared/ec2-client', () => ec2)

const TENANT = { id: 't-1', slug: 'acme', plan: 'basic', status: 'active', rds_endpoint: 'db', ec2_instance_id: null }
const job = (over: any = {}) => ({
  id: 'job-1',
  tenant_id: 't-1',
  step: 'preflight',
  status: 'pending',
  attempts: 0,
  created_resources: {},
  ...over,
})
const lastResources = () => {
  const c = reg.updateProvisioningJob.mock.calls
  return c.length ? c[c.length - 1][1].created_resources : null
}
const readyNode = (labels: Record<string, string>) => ({
  metadata: { labels },
  status: { conditions: [{ type: 'Ready', status: 'True' }] },
  spec: {},
})

let deployment: any
beforeEach(() => {
  vi.clearAllMocks()
  reg.getTenant.mockResolvedValue({ ...TENANT })
  reg.getProvisioningJob.mockResolvedValue(null)
  for (const f of [
    reg.updateProvisioningJob,
    reg.setTenantStatus,
    reg.writeTenantInfra,
    reg.writeTenantEc2,
    reg.clearTenantInfra,
    lifecycle.clearTenantEc2Instance,
    alerts.alertProvisioningFailure,
    poolAuto.deletePoolIfEmpty,
  ])
    f.mockResolvedValue(undefined)
  reg.controlPlanePool.mockReturnValue({ query: vi.fn().mockResolvedValue({ rows: [] }) })
  reg.getDraft.mockResolvedValue(null)
  k8s.remove.mockResolvedValue(undefined)
  k8s.apply.mockResolvedValue(undefined)
  deployment = null
  k8s.get.mockImplementation(async (kind: string) => (kind === 'Deployment' ? deployment : null))
  k8s.list.mockImplementation(async (kind: string) =>
    kind === 'Node'
      ? [readyNode({ 'jeffi.io/pool': 'basic', 'jeffi.io/pool-capacity': '3' })]
      : kind === 'Deployment' && deployment
        ? ['acme-controller-service', 'acme-messaging-service', 'acme-document-service'].map(name => ({ ...deployment, metadata: { name } }))
        : []
  )
  process.env.PROVISIONING_COMPUTE = 'k8s'
  process.env.CLUSTER_INGRESS_IP = '198.51.100.7'
  process.env.RDS_MASTER_PASSWORD = 'pw'
  process.env.K8S_SERVER_URL = 'https://k:6443'
  process.env.K8S_NODE_AMI_ID = 'ami-1'
  process.env.K8S_NODE_SECURITY_GROUP = 'sg-1'
})
afterEach(() => {
  for (const k of [
    'PROVISIONING_COMPUTE',
    'CLUSTER_INGRESS_IP',
    'RDS_MASTER_PASSWORD',
    'TENANT_APP_TARGET_IP',
    'PROVISIONING_PROVIDER',
    'K8S_SERVER_URL',
    'K8S_NODE_AMI_ID',
    'K8S_NODE_SECURITY_GROUP',
  ])
    delete process.env[k]
})

describe('preflight (k8s)', () => {
  it('does not need TENANT_APP_TARGET_IP, even when the env still points at the flagship', async () => {
    process.env.TENANT_APP_TARGET_IP = '52.20.193.62'
    const { advanceProvisioningJob } = await import('@controller/lib/provisioning/steps')
    expect(await advanceProvisioningJob(job() as any, new StubProvisioningProvider(0))).toBe('pending')
    expect(reg.updateProvisioningJob.mock.calls.some(c => c[1].step === 'create_param_group')).toBe(true)
  })

  it('requires CLUSTER_INGRESS_IP', async () => {
    delete process.env.CLUSTER_INGRESS_IP
    const { advanceProvisioningJob } = await import('@controller/lib/provisioning/steps')
    expect(await advanceProvisioningJob(job() as any, new StubProvisioningProvider(0))).toBe('failed')
  })
})

describe('verify_serving (k8s)', () => {
  it('waits on pod readiness by time, not by a 6-tick count', async () => {
    process.env.PROVISIONING_PROVIDER = 'aws'
    deployment = { status: { readyReplicas: 0 } }
    const { advanceProvisioningJob } = await import('@controller/lib/provisioning/steps')
    const res = { computeMode: 'k8s', verifyAttempts: 10, verifyStartedAt: Date.now() - 60_000 }
    expect(
      await advanceProvisioningJob(job({ step: 'verify_serving', created_resources: res }) as any, null as any)
    ).toBe('pending')
    deployment = { status: { readyReplicas: 1 } }
    await advanceProvisioningJob(job({ step: 'verify_serving', created_resources: res }) as any, null as any)
    expect(reg.updateProvisioningJob.mock.calls.some(c => c[1].step === 'activate')).toBe(true)
  })
})

describe('rollback / deprovision never touch a shared node', () => {
  it('rollback deletes the namespace and leaves a launched pool node alone', async () => {
    const provider = new StubProvisioningProvider(0)
    const del = vi.spyOn(provider, 'deleteAppInstance')
    reg.getProvisioningJob.mockResolvedValue(job({ created_resources: { poolInstanceId: 'i-pool' } }))
    const { rollbackProvisioning } = await import('@controller/lib/provisioning/steps')
    await rollbackProvisioning('t-1', provider)
    expect(k8s.remove).toHaveBeenCalledWith('Namespace', 'tenant-acme')
    expect(del).not.toHaveBeenCalled()
  })

  it('refuses to terminate an instance that is not the tenant node (e.g. a stale id pointing at core)', async () => {
    const provider = new StubProvisioningProvider(0)
    const del = vi.spyOn(provider, 'deleteAppInstance')
    reg.getTenant.mockResolvedValue({ ...TENANT, ec2_instance_id: 'i-core' })
    reg.getProvisioningJob.mockResolvedValue(job({ created_resources: { computeMode: 'k8s' } }))
    ec2.describeInstanceName.mockResolvedValue('jeffi-k8s-core')
    const { rollbackProvisioning } = await import('@controller/lib/provisioning/steps')
    await rollbackProvisioning('t-1', provider)
    expect(del).not.toHaveBeenCalled()
    expect(lastResources()).toMatchObject({ manualCleanup: { instance: expect.stringContaining('i-core') } })
  })

  it('terminates the tenant dedicated node', async () => {
    const provider = new StubProvisioningProvider(0)
    const del = vi.spyOn(provider, 'deleteAppInstance')
    reg.getProvisioningJob.mockResolvedValue(job({ created_resources: { computeMode: 'k8s', ec2InstanceId: 'i-t' } }))
    ec2.describeInstanceName.mockResolvedValue('jeffi-k8s-t-acme')
    const { rollbackProvisioning } = await import('@controller/lib/provisioning/steps')
    await rollbackProvisioning('t-1', provider)
    expect(del).toHaveBeenCalledWith('i-t')
  })

  it('deprovision in k8s mode never reclaims the legacy pool and survives a namespace delete error', async () => {
    reg.getTenant.mockResolvedValue({ ...TENANT, rds_endpoint: null })
    reg.getProvisioningJob.mockResolvedValue(job({ status: 'done', created_resources: {} }))
    k8s.remove.mockRejectedValue(new Error('k8s DELETE: 403 forbidden'))
    const { deprovisionTenant } = await import('@controller/lib/provisioning/steps')
    const out = await deprovisionTenant('t-1', new StubProvisioningProvider(0), {})
    expect(out.ok).toBe(true)
    expect(poolAuto.deletePoolIfEmpty).not.toHaveBeenCalled()
    expect(lastResources()).toMatchObject({ manualCleanup: { k8sNamespace: expect.stringContaining('403') } })
  })
})

describe('reconcileK8sPlan', () => {
  const growth = { ...TENANT, plan: 'growth' }

  it('a vCPU quota failure is terminal: recorded, alerted, not parked, store left on its namespace', async () => {
    reg.getTenant.mockResolvedValue(growth)
    reg.getProvisioningJob.mockResolvedValue(job({ status: 'done', created_resources: { computeMode: 'k8s' } }))
    ec2.runInstance.mockRejectedValue(new Error('EC2 RunInstances failed (400): VcpuLimitExceeded'))
    const { reconcileK8sPlan } = await import('@controller/lib/provisioning/steps')
    const r = await reconcileK8sPlan('t-1', new StubProvisioningProvider(0), { force: true })
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining('VcpuLimitExceeded') })
    expect(lastResources()).toMatchObject({ k8sPlanError: expect.stringContaining('VcpuLimitExceeded') })
    expect(lastResources().k8sPendingPlan).toBeUndefined()
    expect(alerts.alertProvisioningFailure).toHaveBeenCalledWith('acme', 'k8s_plan_change', expect.any(String), 't-1')
    expect(k8s.apply).not.toHaveBeenCalled()
  })

  it('a transient failure is parked with a backoff the worker honours', async () => {
    reg.getTenant.mockResolvedValue(growth)
    reg.getProvisioningJob.mockResolvedValue(job({ status: 'done', created_resources: { computeMode: 'k8s' } }))
    ec2.runInstance.mockRejectedValue(new Error('EC2 RunInstances failed (503): ServiceUnavailable'))
    const { reconcileK8sPlan } = await import('@controller/lib/provisioning/steps')
    await reconcileK8sPlan('t-1', new StubProvisioningProvider(0), { force: true })
    const saved = lastResources()
    expect(saved).toMatchObject({ k8sPendingPlan: 'growth', k8sPlanAttempts: 1 })
    expect(saved.k8sPlanNextAt).toBeGreaterThan(Date.now())

    reg.getProvisioningJob.mockResolvedValue(job({ status: 'done', created_resources: saved }))
    ec2.runInstance.mockClear()
    const r = await reconcileK8sPlan('t-1', new StubProvisioningProvider(0))
    expect(r.error).toMatch(/backing off/)
    expect(ec2.runInstance).not.toHaveBeenCalled()
  })

  it('gives up on a node that never joins and terminates only the instance it launched', async () => {
    reg.getTenant.mockResolvedValue(growth)
    k8s.get.mockImplementation(async (kind: string) =>
      kind === 'Node' ? { status: { conditions: [{ type: 'Ready', status: 'False' }] }, spec: {} } : null
    )
    reg.getProvisioningJob.mockResolvedValue(
      job({
        status: 'done',
        created_resources: {
          computeMode: 'k8s',
          k8sPendingPlan: 'growth',
          k8sPendingSince: Date.now() - 21 * 60_000,
          ec2InstanceId: 'i-new',
          k8sPlanLaunchedInstanceId: 'i-new',
        },
      })
    )
    ec2.describeInstanceName.mockResolvedValue('jeffi-k8s-t-acme')
    const provider = new StubProvisioningProvider(0)
    const del = vi.spyOn(provider, 'deleteAppInstance')
    const { reconcileK8sPlan } = await import('@controller/lib/provisioning/steps')
    const r = await reconcileK8sPlan('t-1', provider)
    expect(r.ok).toBe(false)
    expect(del).toHaveBeenCalledWith('i-new')
    expect(lastResources().ec2InstanceId).toBeUndefined()
    expect(lastResources().k8sPendingPlan).toBeUndefined()
  })

  it('never launches a node for a store that is no longer active, and drops its parked change', async () => {
    reg.getTenant.mockResolvedValue({ ...growth, status: 'terminated' })
    reg.getProvisioningJob.mockResolvedValue(
      job({ status: 'done', created_resources: { computeMode: 'k8s', k8sPendingPlan: 'growth' } })
    )
    const { reconcileK8sPlan } = await import('@controller/lib/provisioning/steps')
    const r = await reconcileK8sPlan('t-1', new StubProvisioningProvider(0))
    expect(r.ok).toBe(false)
    expect(ec2.runInstance).not.toHaveBeenCalled()
    expect(lastResources().k8sPendingPlan).toBeUndefined()
  })

  it('a downgrade keeps the dedicated node until the pods have rolled onto the pool', async () => {
    reg.getTenant.mockResolvedValue({ ...TENANT, plan: 'basic', ec2_instance_id: 'i-ded' })
    reg.getProvisioningJob.mockResolvedValue(
      job({ status: 'done', created_resources: { computeMode: 'k8s', ec2InstanceId: 'i-ded' } })
    )
    deployment = {
      metadata: { generation: 2 },
      spec: { replicas: 1 },
      status: { observedGeneration: 2, replicas: 2, updatedReplicas: 1, readyReplicas: 1 },
    }
    ec2.describeInstanceName.mockResolvedValue('jeffi-k8s-t-acme')
    const provider = new StubProvisioningProvider(0)
    const del = vi.spyOn(provider, 'deleteAppInstance')
    const { reconcileK8sPlan } = await import('@controller/lib/provisioning/steps')
    const pending = await reconcileK8sPlan('t-1', provider, { force: true })
    expect(pending.error).toMatch(/pods to move/)
    expect(del).not.toHaveBeenCalled()
    expect(lastResources()).toMatchObject({ k8sPendingPlan: 'basic' })

    deployment.status = { observedGeneration: 2, replicas: 1, updatedReplicas: 1, readyReplicas: 1 }
    reg.getProvisioningJob.mockResolvedValue(job({ status: 'done', created_resources: lastResources() }))
    const done = await reconcileK8sPlan('t-1', provider)
    expect(done).toMatchObject({ ok: true })
    expect(k8s.remove).toHaveBeenCalledWith('Node', 't-acme')
    expect(del).toHaveBeenCalledWith('i-ded')
    expect(lifecycle.clearTenantEc2Instance).toHaveBeenCalledWith('t-1')
    expect(lastResources().k8sPendingPlan).toBeUndefined()
  })
})
