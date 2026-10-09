import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))
const k8s = vi.hoisted(() => ({ list: vi.fn(), get: vi.fn(), apply: vi.fn(), remove: vi.fn() }))
vi.mock('@/lib/k8s/client', () => k8s)
const ec2 = vi.hoisted(() => ({ runInstance: vi.fn(), describeInstanceName: vi.fn() }))
vi.mock('@/lib/shared/ec2-client', () => ec2)

import { ensureTenantNode, poolCapacity, terminateTenantInstance } from '@/lib/k8s/tenant-compute'

const node = (labels: Record<string, string>, ready = true) => ({
  metadata: { labels },
  status: { conditions: [{ type: 'Ready', status: ready ? 'True' : 'False' }] },
  spec: {},
})
const ns = (n: number) => Array.from({ length: n }, (_, i) => ({ metadata: { name: `tenant-t${i}` } }))

function cluster(nodes: any[], basicTenants: number) {
  k8s.list.mockImplementation(async (kind: string) => (kind === 'Node' ? nodes : ns(basicTenants)))
}

describe('ensureTenantNode – basic pool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.K8S_SERVER_URL = 'https://k:6443'
    process.env.K8S_NODE_AMI_ID = 'ami-1'
    process.env.K8S_NODE_SECURITY_GROUP = 'sg-1'
    ec2.runInstance.mockResolvedValue({ instanceId: 'i-new' })
  })

  it('selects nodes by the pool label, not the role', async () => {
    cluster([node({ 'jeffi.io/role': 'core', 'jeffi.io/pool': 'basic', 'jeffi.io/pool-capacity': '1' })], 0)
    expect(await ensureTenantNode('acme', 'basic', {}, vi.fn())).toEqual({ ready: true })
    expect(k8s.list).toHaveBeenCalledWith('Node', undefined, 'jeffi.io/pool=basic')
    expect(ec2.runInstance).not.toHaveBeenCalled()
  })

  it('respects a per-node capacity cap and launches a pool node when full', async () => {
    cluster([node({ 'jeffi.io/role': 'core', 'jeffi.io/pool': 'basic', 'jeffi.io/pool-capacity': '1' })], 1)
    const onLaunched = vi.fn()
    expect(await ensureTenantNode('acme', 'basic', {}, onLaunched)).toEqual({ ready: false, poolInstanceId: 'i-new' })
    expect(onLaunched).toHaveBeenCalledWith('i-new', 'pool')
    expect(ec2.runInstance.mock.calls[0][0].name).toBe('jeffi-k8s-pool-basic-1')
  })

  it('capacity 0 opts a node out', async () => {
    cluster([node({ 'jeffi.io/pool': 'basic', 'jeffi.io/pool-capacity': '0' })], 0)
    const r = await ensureTenantNode('acme', 'basic', {}, vi.fn())
    expect(r.ready).toBe(false)
  })

  it('defaults to the pool node capacity', () => {
    expect(poolCapacity(node({ 'jeffi.io/pool': 'basic' }))).toBe(6)
    expect(poolCapacity(node({ 'jeffi.io/pool-capacity': 'x' }))).toBe(6)
  })
})

describe('terminateTenantInstance', () => {
  beforeEach(() => vi.clearAllMocks())

  it.each([
    ['jeffi-k8s-t-acme', 'terminated'],
    ['jeffi-tenant-acme', 'terminated'],
    ['jeffi-k8s-core', 'refused'],
    ['jeffi-k8s-pool-basic-1', 'refused'],
    ['jeffi-k8s-t-other', 'refused'],
    ['', 'refused'],
  ])('%s → %s', async (name, want) => {
    ec2.describeInstanceName.mockResolvedValue(name)
    const terminate = vi.fn().mockResolvedValue(undefined)
    expect(await terminateTenantInstance('acme', 'i-1', terminate)).toBe(want)
    expect(terminate).toHaveBeenCalledTimes(want === 'terminated' ? 1 : 0)
  })

  it('an already-gone instance is a no-op', async () => {
    ec2.describeInstanceName.mockResolvedValue(null)
    const terminate = vi.fn()
    expect(await terminateTenantInstance('acme', 'i-1', terminate)).toBe('gone')
    expect(terminate).not.toHaveBeenCalled()
  })
})

describe('legacy storefront Deployment retirement', () => {
  beforeEach(() => vi.clearAllMocks())

  it('removes the old storefront objects only once the slug-named Deployment is ready', async () => {
    const { tenantWorkloadReady } = await import('@/lib/k8s/tenant-compute')
    const state: Record<string, any> = {
      'Deployment/acme': { status: { readyReplicas: 0 } },
      'Deployment/storefront': { status: { readyReplicas: 1 } },
    }
    k8s.get.mockImplementation(async (kind: string, name: string) => state[`${kind}/${name}`] ?? null)
    expect(await tenantWorkloadReady('acme')).toBe(false)
    expect(k8s.remove).not.toHaveBeenCalled()

    state['Deployment/acme'] = { status: { readyReplicas: 1 } }
    expect(await tenantWorkloadReady('acme')).toBe(true)
    expect(k8s.remove.mock.calls.map(c => `${c[0]}/${c[1]}`)).toEqual([
      'HorizontalPodAutoscaler/storefront',
      'PodDisruptionBudget/storefront',
      'Deployment/storefront',
    ])
  })
})
