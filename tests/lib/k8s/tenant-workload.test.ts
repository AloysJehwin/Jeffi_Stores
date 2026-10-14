import { describe, it, expect } from 'vitest'
import { renderTenantWorkload } from '@/lib/k8s/tenant-workload'
import { agentNodeUserData } from '@/lib/k8s/node-user-data'
import { resourcePath } from '@/lib/k8s/client'

const hosts = (slug: string) => [
  `${slug}.jeffistores.in`,
  `admin-${slug}.jeffistores.in`,
  `vault-${slug}.jeffistores.in`,
]
const appDep = (objs: any[]): any => objs.find(o => o.kind === 'Deployment' && o.metadata.name.endsWith('-controller-service'))
const envOf = (d: any) => Object.fromEntries(d.spec.template.spec.containers[0].env.map((e: any) => [e.name, e.value]))
const byKind = (objs: any[], kind: string, name?: string) =>
  objs.filter(o => o.kind === kind && (!name || o.metadata.name === name))

describe('renderTenantWorkload', () => {
  it('basic: one pod on the shared pool, no HPA/PDB, isolated namespace', () => {
    const objs = renderTenantWorkload({ slug: 'acme', plan: 'basic', hosts: hosts('acme') })
    expect(objs[0]).toMatchObject({ kind: 'Namespace', metadata: { name: 'tenant-acme' } })
    expect(objs.every(o => o.kind === 'Namespace' || o.metadata.namespace === 'tenant-acme')).toBe(true)
    const app = appDep(objs) as any
    expect(app.metadata.name).toBe('acme-controller-service')
    expect(app.spec.replicas).toBe(1)
    expect(app.spec.template.spec.nodeSelector).toEqual({ 'jeffi.io/pool': 'basic' })
    expect(app.spec.template.spec.automountServiceAccountToken).toBe(false)
    expect(envOf(app)).toMatchObject({
      WEB_CONCURRENCY: '1',
      IN_PROCESS_CRON: 'false',
      CLIENT_CERT_PROXY: 'traefik',
      MESSAGING_URL: 'http://acme-messaging-service:3101',
      DOCUMENTS_URL: 'http://acme-document-service:3102',
    })
    // The store's own messaging + document services, pinned to it.
    for (const name of ['acme-messaging-service', 'acme-document-service']) {
      expect(envOf(byKind(objs, 'Deployment', name)[0])).toMatchObject({ SERVICE_TENANT_SLUG: 'acme', DB_IAM_AUTH: 'true' })
      expect(byKind(objs, 'Service', name)).toHaveLength(1)
    }
    expect(byKind(objs, 'HorizontalPodAutoscaler')).toHaveLength(0)
    expect(byKind(objs, 'PodDisruptionBudget')).toHaveLength(0)
    expect(byKind(objs, 'NetworkPolicy')).toHaveLength(1)
    // Tenant pods never mount the platform CA key.
    expect(JSON.stringify(app)).not.toContain('platform-ca')
  })

  it('quota leaves room for the rolling-update surge pod + redis', () => {
    for (const plan of ['basic', 'growth', 'pro', 'enterprise']) {
      const objs = renderTenantWorkload({ slug: 'acme', plan, hosts: hosts('acme') }) as any[]
      const quota = parseInt(byKind(objs, 'ResourceQuota')[0].spec.hard['limits.memory'])
      const hpa = byKind(objs, 'HorizontalPodAutoscaler')[0]
      const app = appDep(objs)
      const redis = byKind(objs, 'Deployment', 'redis')[0]
      const podMem = parseInt(app.spec.template.spec.containers[0].resources.limits.memory)
      const max = hpa?.spec.maxReplicas ?? app.spec.replicas
      const redisMem = parseInt(redis.spec.template.spec.containers[0].resources.limits.memory)
      expect(quota).toBeGreaterThanOrEqual(podMem * (max + 1) + redisMem)
    }
  })

  it('pro: dedicated node with toleration, HPA and PDB', () => {
    const objs = renderTenantWorkload({ slug: 'big', plan: 'pro', hosts: hosts('big') })
    const spec = (appDep(objs) as any).spec.template.spec
    expect(spec.nodeSelector).toEqual({ 'jeffi.io/tenant': 'big' })
    expect(spec.tolerations[0]).toMatchObject({ key: 'jeffi.io/tenant', value: 'big', effect: 'NoSchedule' })
    expect((byKind(objs, 'HorizontalPodAutoscaler')[0] as any).spec).toMatchObject({ minReplicas: 2, maxReplicas: 3 })
    expect(byKind(objs, 'PodDisruptionBudget')).toHaveLength(3)
  })

  it('routes admin-{slug} through tenant mTLS and everything else through the default TLS option', () => {
    const objs = renderTenantWorkload({
      slug: 'acme',
      plan: 'basic',
      hosts: [...hosts('acme'), 'invoice-acme.jeffistores.in'],
    }) as any[]
    const store = byKind(objs, 'IngressRoute', 'controller')[0] as any
    const docs = byKind(objs, 'IngressRoute', 'documents')[0] as any
    expect(docs.spec.routes[0].match).toBe('Host(`invoice-acme.jeffistores.in`)')
    expect(docs.spec.routes[0].services).toEqual([{ name: 'acme-document-service', port: 3102 }])
    const admin = byKind(objs, 'IngressRoute', 'admin')[0] as any
    expect(store.spec.routes[0].match).toBe('Host(`acme.jeffistores.in`) || Host(`vault-acme.jeffistores.in`)')
    expect(admin.spec.routes[0].match).toBe('Host(`admin-acme.jeffistores.in`)')
    expect(admin.spec.tls.options.name).toBe('tenant-mtls')
    expect(admin.spec.routes[0].middlewares.map((m: any) => m.name)).toEqual(['strip-client-cert', 'pass-client-cert'])
    expect(store.spec.routes[0].middlewares.map((m: any) => m.name)).toEqual(['strip-client-cert'])
  })

  it('issues an HTTP-01 certificate per verified custom domain', () => {
    const objs = renderTenantWorkload({
      slug: 'acme',
      plan: 'pro',
      hosts: hosts('acme'),
      customDomains: ['shop.acme.com'],
    }) as any[]
    const cert = byKind(objs, 'Certificate')[0]
    expect(cert.spec).toMatchObject({ dnsNames: ['shop.acme.com'], issuerRef: { name: 'letsencrypt-http' } })
    const route = byKind(objs, 'IngressRoute', 'custom-0')[0]
    expect(route.spec.tls.secretName).toBe(cert.spec.secretName)
  })

  it('uses the release image when given', () => {
    const objs = renderTenantWorkload({
      slug: 'a',
      plan: 'basic',
      hosts: hosts('a'),
      images: { controller: '708835965056.dkr.ecr.us-east-1.amazonaws.com/jeffi-stores:main-abc' },
    }) as any[]
    expect(appDep(objs).spec.template.spec.containers[0].image).toBe(
      '708835965056.dkr.ecr.us-east-1.amazonaws.com/jeffi-stores:main-abc'
    )
  })
})

describe('k8s helpers', () => {
  it('builds API paths for core, grouped and cluster-scoped kinds', () => {
    expect(resourcePath('Deployment', 'storefront', 'tenant-a')).toBe(
      '/apis/apps/v1/namespaces/tenant-a/deployments/storefront'
    )
    expect(resourcePath('Namespace', 'tenant-a')).toBe('/api/v1/namespaces/tenant-a')
    expect(resourcePath('IngressRoute', undefined, 'x')).toBe('/apis/traefik.io/v1alpha1/namespaces/x/ingressroutes')
    expect(() => resourcePath('Bogus')).toThrow()
  })

  it('renders agent user-data with quoted labels and taints', () => {
    const ud = agentNodeUserData({
      nodeName: 't-acme',
      labels: { 'jeffi.io/role': 'dedicated', 'jeffi.io/tenant': 'acme' },
      taints: ['jeffi.io/tenant=acme:NoSchedule'],
      server: 'https://172.31.1.1:6443',
    })
    expect(ud).toContain("'--node-label' 'jeffi.io/tenant=acme'")
    expect(ud).toContain("'--node-taint' 'jeffi.io/tenant=acme:NoSchedule'")
    expect(ud).toContain("K3S_URL='https://172.31.1.1:6443'")
    expect(ud).toContain('jeffi/production/k3s')
  })
})

describe('probes', () => {
  it('probe localhost: a tenant host 404s until activation', () => {
    const objs = renderTenantWorkload({ slug: 'acme', plan: 'basic', hosts: hosts('acme') }) as any[]
    const c = appDep(objs).spec.template.spec.containers[0]
    for (const p of [c.startupProbe, c.readinessProbe, c.livenessProbe])
      expect(p.httpGet.httpHeaders).toEqual([{ name: 'Host', value: 'localhost' }])
  })
})

describe('tracing env', () => {
  it('sends each tenant as its own service to in-cluster Coroot', () => {
    const objs = renderTenantWorkload({ slug: 'acme', plan: 'basic', hosts: hosts('acme') }) as any[]
    const env = Object.fromEntries(
      appDep(objs).spec.template.spec.containers[0].env.map((e: any) => [
        e.name,
        e.value,
      ])
    )
    expect(env.OTEL_SERVICE_NAME).toBe('acme-controller-service')
    expect(env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT).toBe('http://coroot-coroot.observability:8080/v1/traces')
  })
})
