import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('server-only', () => ({}))
const k8s = vi.hoisted(() => ({ list: vi.fn(), get: vi.fn(), apply: vi.fn(), remove: vi.fn() }))
vi.mock('@/lib/k8s/client', () => k8s)
const ec2 = vi.hoisted(() => ({
  runInstance: vi.fn(),
  describeInstanceName: vi.fn(),
  describeTenantDbVolume: vi.fn().mockResolvedValue(null),
  attachVolume: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/shared/ec2-client', () => ec2)
const sec = vi.hoisted(() => ({ loadSecretEnv: vi.fn(), getSecretJson: vi.fn() }))
vi.mock('@/lib/secrets/index.mjs', async orig => ({ ...(await orig<typeof import('@/lib/secrets/index.mjs')>()), ...sec }))

import { ensureTenantNodes, poolCapacity, terminateTenantInstance } from '@/lib/k8s/tenant-compute'

const POOL = { placement: 'pool' as const, type: null, count: 1 }

const node = (labels: Record<string, string>, ready = true) => ({
  metadata: { labels },
  status: { conditions: [{ type: 'Ready', status: ready ? 'True' : 'False' }] },
  spec: {},
})
const ns = (n: number) => Array.from({ length: n }, (_, i) => ({ metadata: { name: `tenant-t${i}`, labels: { 'jeffi.io/plan': 'basic' } } }))

function cluster(nodes: any[], basicTenants: number) {
  k8s.list.mockImplementation(async (kind: string) => (kind === 'Node' ? nodes : ns(basicTenants)))
}

describe('ensureTenantNodes – basic pool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.K8S_SERVER_URL = 'https://k:6443'
    process.env.K8S_NODE_AMI_ID = 'ami-1'
    process.env.K8S_NODE_SECURITY_GROUP = 'sg-1'
    ec2.runInstance.mockResolvedValue({ instanceId: 'i-new' })
  })

  it('selects nodes by the pool label, not the role', async () => {
    cluster([node({ 'jeffi.io/role': 'core', 'jeffi.io/pool': 'basic', 'jeffi.io/pool-capacity': '1' })], 0)
    expect(await ensureTenantNodes('acme', POOL, 0, {}, vi.fn())).toEqual({ ready: true })
    expect(k8s.list).toHaveBeenCalledWith('Node', undefined, 'jeffi.io/pool=basic')
    expect(ec2.runInstance).not.toHaveBeenCalled()
  })

  it('respects a per-node capacity cap and launches a pool node when full', async () => {
    cluster([node({ 'jeffi.io/role': 'core', 'jeffi.io/pool': 'basic', 'jeffi.io/pool-capacity': '1' })], 1)
    const onLaunched = vi.fn()
    expect(await ensureTenantNodes('acme', POOL, 0, {}, onLaunched)).toEqual({ ready: false, poolInstanceId: 'i-new' })
    expect(onLaunched).toHaveBeenCalledWith('i-new', 'pool', 'pool-basic-1')
    expect(ec2.runInstance.mock.calls[0][0].name).toBe('jeffi-k8s-pool-basic-1')
  })

  it('capacity 0 opts a node out', async () => {
    cluster([node({ 'jeffi.io/pool': 'basic', 'jeffi.io/pool-capacity': '0' })], 0)
    const r = await ensureTenantNodes('acme', POOL, 0, {}, vi.fn())
    expect(r.ready).toBe(false)
  })

  it('defaults to the pool node capacity', () => {
    expect(poolCapacity(node({ 'jeffi.io/pool': 'basic' }))).toBe(3)
    expect(poolCapacity(node({ 'jeffi.io/pool-capacity': 'x' }))).toBe(3)
    expect(poolCapacity(node({ 'jeffi.io/pool-capacity': '4' }))).toBe(3)
  })

  it('counts pool stores by their placement label, older namespaces by plan', async () => {
    k8s.list.mockImplementation(async (kind: string) =>
      kind === 'Node'
        ? [node({ 'jeffi.io/pool': 'basic', 'jeffi.io/pool-capacity': '1' })]
        : [{ metadata: { name: 'tenant-s', labels: { 'jeffi.io/plan': 'starter', 'jeffi.io/placement': 'dedicated' } } }]
    )
    expect(await ensureTenantNodes('acme', POOL, 0, {}, vi.fn())).toEqual({ ready: true })
  })
})

describe('ensureTenantNodes – own servers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.K8S_SERVER_URL = 'https://k:6443'
    process.env.K8S_NODE_AMI_ID = 'ami-1'
    process.env.K8S_NODE_SECURITY_GROUP = 'sg-1'
    k8s.get.mockResolvedValue(null)
    ec2.runInstance.mockImplementation(async (a: any) => ({ instanceId: `i-${a.name}` }))
  })

  it('launches each server of the generation once, tagged and labelled to the store', async () => {
    const onLaunched = vi.fn()
    const spec = { placement: 'dedicated' as const, type: 't4g.small', count: 2 }
    const r = await ensureTenantNodes('acme', spec, 0, {}, onLaunched)
    expect(r).toEqual({ ready: false, instances: { 't-acme': 'i-jeffi-k8s-t-acme', 't-acme.0-1': 'i-jeffi-k8s-t-acme.0-1' } })
    expect(ec2.runInstance.mock.calls[1][0]).toMatchObject({ instanceType: 't4g.small', tags: { 'jeffi-tenant': 'acme' } })
    expect(ec2.runInstance.mock.calls[1][0].userData).toContain('jeffi.io/gen=0')
    ec2.runInstance.mockClear()
    await ensureTenantNodes('acme', { ...spec, count: 1 }, 2, { instances: { 't-acme.2-0': 'i-x' } }, vi.fn())
    expect(ec2.runInstance).not.toHaveBeenCalled()
  })
})

describe('terminateTenantInstance', () => {
  beforeEach(() => vi.clearAllMocks())

  it.each([
    ['jeffi-k8s-t-acme', 'terminated'],
    ['jeffi-tenant-acme', 'terminated'],
    ['jeffi-k8s-t-acme.2-1', 'terminated'],
    ['jeffi-k8s-t-acme-shop.1-0', 'refused'],
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

describe('legacy store Deployment retirement', () => {
  beforeEach(() => vi.clearAllMocks())

  it('waits for all three services, then removes the earlier store objects', async () => {
    const { tenantWorkloadReady } = await import('@/lib/k8s/tenant-compute')
    const up = { status: { readyReplicas: 1 } }
    const state: Record<string, any> = {
      'Deployment/acme-controller-service': up,
      'Deployment/acme-messaging-service': up,
      'Deployment/acme-document-service': { status: { readyReplicas: 0 } },
      'Deployment/acme': up,
    }
    k8s.get.mockImplementation(async (kind: string, name: string) => state[`${kind}/${name}`] ?? null)
    // The store's own Deployments carry jeffi.io/service; the earlier `acme` one does not.
    k8s.list.mockImplementation(async (kind: string) =>
      kind === 'Deployment' ? ['acme-controller-service', 'acme-messaging-service', 'acme-document-service'].map(n => ({ metadata: { name: n }, ...state[`Deployment/${n}`] })) : []
    )
    expect(await tenantWorkloadReady('acme')).toBe(false)
    expect(k8s.remove).not.toHaveBeenCalled()

    state['Deployment/acme-document-service'] = up
    expect(await tenantWorkloadReady('acme')).toBe(true)
    expect(k8s.remove.mock.calls.map(c => `${c[0]}/${c[1]}`)).toEqual([
      'HorizontalPodAutoscaler/acme',
      'PodDisruptionBudget/acme',
      'Deployment/acme',
      'IngressRoute/storefront',
      'Service/storefront',
    ])
  })
})

describe('applyTenantWorkload – the old all-in-one app', () => {
  const OLD = 'ecr/jeffi-stores-controller-service:old'
  const deployments = () => k8s.apply.mock.calls.map(c => c[0]).filter((o: any) => o.kind === 'Deployment')
  const removed = () => k8s.remove.mock.calls.map(c => `${c[0]}/${c[1]}`)
  let running: any

  beforeEach(() => {
    vi.clearAllMocks()
    running = { spec: { template: { spec: { containers: [{ name: 'app', image: OLD }] } } } }
    k8s.get.mockImplementation(async (kind: string, name: string) =>
      kind === 'ConfigMap' && name === 'release'
        ? { data: { controller: 'ecr/jeffi-stores-controller-service:new', storefront: 'ecr/jeffi-stores-storefront-service:new' } }
        : kind === 'Deployment' && name === 'acme-controller-service'
          ? running
          : kind === 'Secret' && name === 'redis'
            ? {}
            : null
    )
  })

  it('keeps the image it runs, not the control-plane-only release image', async () => {
    const { applyTenantWorkload } = await import('@/lib/k8s/tenant-compute')
    await applyTenantWorkload({ slug: 'acme', plan: 'basic', hosts: ['acme.jeffistores.in'] })
    const app = deployments().find((d: any) => d.metadata.name === 'acme-controller-service')
    expect(app.spec.template.spec.containers[0].image).toBe(OLD)
  })

  it('refuses to start it anew', async () => {
    running = null
    const { applyTenantWorkload } = await import('@/lib/k8s/tenant-compute')
    await expect(applyTenantWorkload({ slug: 'acme', plan: 'basic', hosts: ['acme.jeffistores.in'] })).rejects.toThrow(/only run its own services/)
    expect(k8s.apply).not.toHaveBeenCalled()
  })

  it('stays up to drain while the routes move to the services, then goes', async () => {
    const { applyTenantWorkload } = await import('@/lib/k8s/tenant-compute')
    const input = { slug: 'acme', plan: 'basic', hosts: ['acme.jeffistores.in'], layout: 'services' as const }
    await applyTenantWorkload(input, { keepApps: true })
    expect(removed()).not.toContain('Deployment/acme-controller-service')
    expect(removed()).toContain('IngressRoute/controller')
    k8s.remove.mockClear()
    await applyTenantWorkload(input)
    expect(removed()).toContain('Deployment/acme-controller-service')
  })
})

describe('platform on Azure, stores on AWS', () => {
  const KEYS = ['SECRETS_BACKEND', 'TENANT_PLATFORM_DB_IAM_AUTH', 'TENANT_PLATFORM_DB_SSL', 'TENANT_NODE_CIDRS', 'K8S_NODES_OVER_TAILSCALE', 'K8S_JOIN_SECRET_ID']
  const applied = () => k8s.apply.mock.calls.map(c => c[0])
  beforeEach(() => {
    vi.clearAllMocks()
    for (const k of KEYS) delete process.env[k]
    k8s.get.mockImplementation(async (kind: string, name: string) => (kind === 'Secret' && name === 'redis' ? {} : null))
  })
  afterEach(() => {
    for (const k of KEYS) delete process.env[k]
  })

  it('reads its link from config; unset is today', async () => {
    const { tenantPlatformLink } = await import('@/lib/k8s/tenant-compute')
    expect(tenantPlatformLink({} as NodeJS.ProcessEnv)).toEqual({ secrets: 'secretsmanager', dbIamAuth: true })
    expect(
      tenantPlatformLink({ SECRETS_BACKEND: 'keyvault', TENANT_PLATFORM_DB_IAM_AUTH: 'false', TENANT_PLATFORM_DB_SSL: 'require', TENANT_NODE_CIDRS: '100.64.0.0/10, 10.60.0.0/16' } as unknown as NodeJS.ProcessEnv)
    ).toEqual({ secrets: 'kubernetes', dbIamAuth: false, dbSsl: 'require', nodeCidrs: ['100.64.0.0/10', '10.60.0.0/16'] })
  })

  it('on AWS it copies nothing and lists no secrets', async () => {
    const { applyTenantWorkload } = await import('@/lib/k8s/tenant-compute')
    await applyTenantWorkload({ slug: 'acme', plan: 'basic', hosts: ['acme.jeffistores.in'], layout: 'services' })
    expect(sec.loadSecretEnv).not.toHaveBeenCalled()
    expect(applied().some((o: any) => o.metadata.name.startsWith('env-'))).toBe(false)
    expect(k8s.list).not.toHaveBeenCalledWith('Secret', expect.anything(), expect.anything())
  })

  it('copies each secret the pods take into the namespace before them, and drops the ones no pod takes', async () => {
    process.env.SECRETS_BACKEND = 'keyvault'
    sec.loadSecretEnv.mockImplementation(async (id: string) => ({ id: id === 'jeffi/store' ? 'jeffi/production' : id, backend: 'keyvault', values: { JWT_SECRET: `j-${id}`, 'bad key': 'x' }, size: 2 }))
    k8s.list.mockImplementation(async (kind: string) => (kind === 'Secret' ? [{ metadata: { name: 'env-jeffi-production' } }, { metadata: { name: 'env-jeffi-store' } }] : []))
    const { applyTenantWorkload } = await import('@/lib/k8s/tenant-compute')
    await applyTenantWorkload({ slug: 'acme', plan: 'basic', hosts: ['acme.jeffistores.in'], layout: 'services' })
    expect(sec.loadSecretEnv.mock.calls).toEqual([
      ['jeffi/store', { fallbackId: 'jeffi/production' }],
      ['jeffi/messaging/production', {}],
      ['jeffi/documents/production', {}],
    ])
    const store = applied().find((o: any) => o.kind === 'Secret' && o.metadata.name === 'env-jeffi-store')
    expect(store).toMatchObject({
      metadata: { namespace: 'tenant-acme', labels: { 'jeffi.io/env-secret': 'true' }, annotations: { 'jeffi.io/secret-id': 'jeffi/production' } },
      data: { JWT_SECRET: Buffer.from('j-jeffi/store').toString('base64') },
    })
    expect(store.data).not.toHaveProperty('bad key')
    const names = applied().map((o: any) => `${o.kind}/${o.metadata.name}`)
    expect(names.indexOf('Secret/env-jeffi-store')).toBeLessThan(names.indexOf('Deployment/acme-storefront-service'))
    expect(k8s.list).toHaveBeenCalledWith('Secret', 'tenant-acme', 'jeffi.io/env-secret=true')
    expect(k8s.remove.mock.calls.filter(c => c[0] === 'Secret').map(c => c[1])).toEqual(['env-jeffi-production'])
  })

  it('a slice copies only its own secret, and keeps the rest', async () => {
    process.env.SECRETS_BACKEND = 'keyvault'
    sec.loadSecretEnv.mockResolvedValue({ id: 'jeffi/messaging/production', backend: 'keyvault', values: { A: 'a' }, size: 1 })
    const { applyTenantWorkload } = await import('@/lib/k8s/tenant-compute')
    await applyTenantWorkload({ slug: 'acme', plan: 'basic', hosts: ['acme.jeffistores.in'], layout: 'services' }, { part: 'messaging' })
    expect(sec.loadSecretEnv.mock.calls.map(c => c[0])).toEqual(['jeffi/messaging/production'])
    expect(k8s.remove.mock.calls.some(c => c[0] === 'Secret')).toBe(false)
  })

  it('launches a node over Tailscale with the join secrets written in from Key Vault', async () => {
    process.env.SECRETS_BACKEND = 'keyvault'
    process.env.K8S_NODES_OVER_TAILSCALE = 'true'
    process.env.K8S_SERVER_URL = 'https://100.70.1.2:6443'
    process.env.K8S_NODE_AMI_ID = 'ami-1'
    process.env.K8S_NODE_SECURITY_GROUP = 'sg-1'
    sec.getSecretJson.mockResolvedValue({ K3S_TOKEN: 'k3s-tok', TS_AUTHKEY: 'ts-key' })
    ec2.runInstance.mockResolvedValue({ instanceId: 'i-new' })
    await ensureTenantNodes('acme', { placement: 'dedicated', type: 't4g.small', count: 1 }, 0, {}, vi.fn())
    expect(sec.getSecretJson).toHaveBeenCalledWith('jeffi/production/k3s')
    const ud = ec2.runInstance.mock.calls[0][0].userData as string
    expect(ud).toContain("K3S_TOKEN='k3s-tok'")
    expect(ud).toContain('--accept-routes')
    expect(ud).toContain('tailscale0')
    expect(ud).not.toContain('secretsmanager')
  })

  it('refuses a join secret without both values, naming neither', async () => {
    process.env.SECRETS_BACKEND = 'keyvault'
    process.env.K8S_SERVER_URL = 'https://100.70.1.2:6443'
    process.env.K8S_NODE_AMI_ID = 'ami-1'
    process.env.K8S_NODE_SECURITY_GROUP = 'sg-1'
    sec.getSecretJson.mockResolvedValue({ K3S_TOKEN: 'k3s-tok' })
    await expect(ensureTenantNodes('acme', { placement: 'dedicated', type: 't4g.small', count: 1 }, 0, {}, vi.fn())).rejects.toThrow(/^jeffi\/production\/k3s has no K3S_TOKEN or TS_AUTHKEY$/)
    expect(ec2.runInstance).not.toHaveBeenCalled()
  })
})
