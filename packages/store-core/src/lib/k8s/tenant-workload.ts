import { dedicatedNodeName, tenantNamespace } from '@/lib/provisioning/tiers'
import { legacySpecFor } from '@/lib/compute/legacy'
import { POD_RESOURCES, REDIS_RESOURCES } from '@/lib/compute/presets'
import { activeServices, type ComputeSpec, type ServiceName, type ServiceSpec, type StoreLayout } from '@/lib/compute/spec'
import { surges } from '@/lib/compute/validate'
import { STORE_ROLES, type ServiceRole } from '@/lib/service-routing'
import type { K8sObject } from './client'
import { EDGE_NS, hostMatch, PRIORITY_BAND, trafficRoutes, type HostGroup } from './traefik-routes'

// Renders one tenant's namespace: its storefront, admin and business services (or, in the old layout, one
// all-in-one controller), messaging and documents (Deployment + Service each, wired to one another),
// Redis, PDB/HPA, NetworkPolicy and IngressRoutes (+ cert-manager Certificate per verified custom domain).
// Pure, so it is unit tested; tenant-compute.ts applies it.

const ECR = '708835965056.dkr.ecr.us-east-1.amazonaws.com'
export type TenantService = 'controller' | ServiceRole | 'messaging' | 'documents'
export const DEFAULT_IMAGES: Record<TenantService, string> = {
  controller: `${ECR}/jeffi-stores-controller-service:latest`,
  storefront: `${ECR}/jeffi-stores-storefront-service:latest`,
  admin: `${ECR}/jeffi-stores-admin-service:latest`,
  business: `${ECR}/jeffi-stores-business-service:latest`,
  messaging: `${ECR}/jeffi-stores-messaging-service:latest`,
  documents: `${ECR}/jeffi-stores-document-service:latest`,
}
// Provider callbacks and API links resolve through the shared public gateway.
const PUBLIC_BASE_URL = 'https://public.jeffistores.in'
const DOC_APPS = ['invoice', 'quotation', 'purchaseorder']

// Traces → Coroot in-cluster, every request (see controller-service/src/lib/shared/otel.ts).
const OTEL_ENV = [
  { name: 'OTEL_EXPORTER_OTLP_TRACES_ENDPOINT', value: 'http://coroot-coroot.observability:8080/v1/traces' },
  { name: 'OTEL_EXPORTER_OTLP_PROTOCOL', value: 'http/protobuf' },
  { name: 'OTEL_TRACES_SAMPLER', value: 'parentbased_traceidratio' },
  { name: 'OTEL_TRACES_SAMPLER_ARG', value: '1.0' },
]

export interface TenantWorkloadInput {
  slug: string
  plan: string | null
  hosts: string[] // platform subdomains from tenantHostnames()
  customDomains?: string[] // verified, customer-owned
  images?: Partial<Record<TenantService, string>>
  compute?: ComputeSpec // defaults to the plan's pre-configurable tier
  dbPoolMax?: number // per-pod database pool (DB_POOL_MAX)
  nodeGen?: number // generation of the store's own servers; pods follow it during a resize
  layout?: StoreLayout // what runs; defaults to the spec's (old stores: controller)
  routeTo?: StoreLayout // while switching layouts: traffic stays on this one, which runs a single copy
  storeSecret?: string // Secrets Manager id for the store's app pods (default: the platform's)
}

const SERVICES = {
  messaging: { app: 'messaging-service', suffix: 'messaging-service', port: 3101, secret: 'jeffi/messaging/production' },
  documents: { app: 'document-service', suffix: 'document-service', port: 3102, secret: 'jeffi/documents/production' },
} as const
type BackingService = keyof typeof SERVICES

/** The old all-in-one store app's Deployment/Service/HPA/PDB name. */
export const tenantAppName = (slug: string) => `${slug}-controller-service`
/** A store service's Deployment/Service/HPA/PDB name. */
export const tenantRoleName = (slug: string, role: ServiceRole) => `${slug}-${role}-service`
export const tenantServiceName = (slug: string, service: BackingService) => `${slug}-${SERVICES[service].suffix}`
/** Every Deployment a store may run, in either layout. */
export const tenantWorkloadNames = (slug: string) => [
  tenantAppName(slug),
  ...STORE_ROLES.map(r => tenantRoleName(slug, r)),
  tenantServiceName(slug, 'messaging'),
  tenantServiceName(slug, 'documents'),
]
/** IngressRoutes the renderer owns (custom-{i} besides). */
export const TENANT_ROUTE_NAMES = ['controller', 'store', 'admin', 'business', 'documents', 'razorpay-webhook']
/** Earlier store Deployment names (Service and IngressRoute were `storefront`); retired once the controller serves. */
export const legacyAppNames = (slug: string) => ['storefront', slug]

const selector = (slug: string, app: string) => ({ app, 'jeffi.io/tenant': slug })
const labels = (slug: string, app: string, service: TenantService) => ({ ...selector(slug, app), 'jeffi.io/service': service })
const mem = (m: string) => parseInt(m)

export function placement(slug: string, node: ComputeSpec['node'], gen = 0) {
  if (node.placement === 'dedicated') {
    return {
      // Generation 0 servers predate the label (the legacy t-{slug}), so it is only selected from 1 up.
      nodeSelector: { 'jeffi.io/tenant': slug, ...(gen > 0 ? { 'jeffi.io/gen': String(gen) } : {}) },
      tolerations: [{ key: 'jeffi.io/tenant', operator: 'Equal', value: slug, effect: 'NoSchedule' }],
    }
  }
  return { nodeSelector: { 'jeffi.io/pool': 'basic' }, tolerations: [] as unknown[] }
}

// Spreads a service's copies across the store's servers when it has more than one.
const spread = (slug: string, app: string, nodes: number) =>
  nodes > 1
    ? {
        topologySpreadConstraints: [
          { maxSkew: 1, topologyKey: 'kubernetes.io/hostname', whenUnsatisfiable: 'ScheduleAnyway', labelSelector: { matchLabels: selector(slug, app) } },
        ],
      }
    : {}


const podBase = (place: ReturnType<typeof placement>, grace: number) => ({
  ...place,
  automountServiceAccountToken: false,
  imagePullSecrets: [{ name: 'regcred' }],
  terminationGracePeriodSeconds: grace,
  securityContext: { runAsUser: 1001, runAsGroup: 1001, fsGroup: 1001 },
})
const volumeMounts = [
  { name: 'certs', mountPath: '/app/certs', readOnly: true },
  { name: 'tmp', mountPath: '/tmp' },
]
// Tenant pods get only the RDS CA — never the platform CA key.
const volumes = [
  { name: 'certs', configMap: { name: 'rds-ca' } },
  { name: 'tmp', emptyDir: { sizeLimit: '256Mi' } },
]

function serviceDeployment(slug: string, ns: string, service: BackingService, spec: ServiceSpec, image: string, place: ReturnType<typeof placement>, nodes: number, poolEnv: { name: string; value: string }[]): K8sObject {
  const s = SERVICES[service]
  const res = POD_RESOURCES[service][spec.size]
  const lbl = labels(slug, s.app, service)
  const env = [
    { name: 'SM_SECRET_ID', value: s.secret },
    ...poolEnv,
    { name: 'SERVICE_TENANT_SLUG', value: slug },
    { name: 'DB_IAM_AUTH', value: 'true' },
    { name: 'PUBLIC_BASE_URL', value: PUBLIC_BASE_URL },
    { name: 'NODE_OPTIONS', value: `--max-old-space-size=${Math.floor(mem(res.limits.memory) * 0.7)}` },
    ...(service === 'documents'
      ? [{ name: 'MESSAGING_URL', value: `http://${tenantServiceName(slug, 'messaging')}:${SERVICES.messaging.port}` }]
      : []),
  ]
  const probe = { httpGet: { path: '/healthz', port: 'http' } }
  return {
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    metadata: { name: tenantServiceName(slug, service), namespace: ns, labels: lbl },
    spec: {
      replicas: spec.replicas,
      revisionHistoryLimit: 3,
      strategy: rollout(service, spec),
      selector: { matchLabels: selector(slug, s.app) },
      template: {
        metadata: { labels: lbl },
        spec: {
          ...podBase(place, 30),
          ...spread(slug, s.app, nodes),
          containers: [
            {
              name: 'app',
              image,
              ports: [{ name: 'http', containerPort: s.port }],
              env,
              resources: res,
              startupProbe: { ...probe, periodSeconds: 5, failureThreshold: 24 },
              readinessProbe: { ...probe, periodSeconds: 10, timeoutSeconds: 5 },
              livenessProbe: { ...probe, periodSeconds: 20, timeoutSeconds: 5 },
              lifecycle: { preStop: { exec: { command: ['sleep', '5'] } } },
              volumeMounts,
            },
          ],
          volumes,
        },
      },
    },
  }
}

// The storefront, and services with spare copies, surge a pod on a rollout; a single-copy back-office
// service restarts in place (validate.ts counts the same), so small servers need no room for it.
const rollout = (k: ServiceName, s: ServiceSpec) =>
  surges(k, s)
    ? { type: 'RollingUpdate', rollingUpdate: { maxUnavailable: s.replicas > 1 ? 1 : 0, maxSurge: 1 } }
    : { type: 'RollingUpdate', rollingUpdate: { maxUnavailable: 1, maxSurge: 0 } }

// A PDB once a service runs two copies, and an HPA (on CPU) when it may grow past its copies.
function scaling(ns: string, name: string, match: Record<string, string>, svc: ServiceSpec): K8sObject[] {
  const out: K8sObject[] = []
  if (svc.replicas > 1) {
    out.push({
      apiVersion: 'policy/v1',
      kind: 'PodDisruptionBudget',
      metadata: { name, namespace: ns },
      spec: { minAvailable: 1, selector: { matchLabels: match } },
    })
  }
  if (svc.maxReplicas > svc.replicas) {
    out.push({
      apiVersion: 'autoscaling/v2',
      kind: 'HorizontalPodAutoscaler',
      metadata: { name, namespace: ns },
      spec: {
        scaleTargetRef: { apiVersion: 'apps/v1', kind: 'Deployment', name },
        minReplicas: svc.replicas,
        maxReplicas: svc.maxReplicas,
        metrics: [{ type: 'Resource', resource: { name: 'cpu', target: { type: 'Utilization', averageUtilization: 70 } } }],
      },
    })
  }
  return out
}

const ROOT_DOMAIN = process.env.PLATFORM_ROOT_DOMAIN || 'jeffistores.in'

// A Next app pod: the old all-in-one controller (role null) or one store service.
function appDeployment(a: {
  slug: string
  ns: string
  name: string
  role: ServiceRole | null
  svc: ServiceSpec
  sizeOf: ServiceName
  image: string
  place: ReturnType<typeof placement>
  nodes: number
  poolEnv: { name: string; value: string }[]
  secret: string
}): K8sObject {
  const res = POD_RESOURCES[a.sizeOf][a.svc.size]
  const app = appLabel(a.role)
  const lbl = labels(a.slug, app, a.role ?? 'controller')
  // Probes use localhost: the app 404s a tenant host until the tenant is active, which happens only
  // after these pods are Ready. verify_serving checks readiness separately.
  const probe = (path: string) => ({ httpGet: { path, port: 'http', httpHeaders: [{ name: 'Host', value: 'localhost' }] } })
  return {
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    metadata: { name: a.name, namespace: a.ns, labels: lbl },
    spec: {
      replicas: a.svc.replicas,
      revisionHistoryLimit: 3,
      strategy: rollout(a.role ?? 'storefront', a.svc),
      selector: { matchLabels: selector(a.slug, app) },
      template: {
        metadata: { labels: lbl },
        spec: {
          ...podBase(a.place, 60),
          ...spread(a.slug, app, a.nodes),
          containers: [
            {
              name: 'app',
              image: a.image,
              ports: [{ name: 'http', containerPort: 3000 }],
              env: [
                { name: 'SM_SECRET_ID', value: a.secret },
                // The image is the role; this pins the pod to its store.
                ...(a.role ? [{ name: 'SERVICE_TENANT_SLUG', value: a.slug }] : []),
                ...(a.role === 'admin' ? [{ name: 'STOREFRONT_URL', value: `http://${tenantRoleName(a.slug, 'storefront')}:3000` }] : []),
                { name: 'WEB_CONCURRENCY', value: '1' },
                ...a.poolEnv,
                { name: 'IN_PROCESS_CRON', value: 'false' },
                { name: 'CLIENT_CERT_PROXY', value: 'traefik' },
                { name: 'MESSAGING_URL', value: `http://${tenantServiceName(a.slug, 'messaging')}:${SERVICES.messaging.port}` },
                { name: 'DOCUMENTS_URL', value: `http://${tenantServiceName(a.slug, 'documents')}:${SERVICES.documents.port}` },
                { name: 'OTEL_SERVICE_NAME', value: a.name },
                ...OTEL_ENV,
                { name: 'NODE_OPTIONS', value: `--max-old-space-size=${Math.floor(mem(res.limits.memory) * 0.7)}` },
                { name: 'REDIS_PASSWORD', valueFrom: { secretKeyRef: { name: 'redis', key: 'password' } } },
                { name: 'REDIS_URL', value: 'redis://:$(REDIS_PASSWORD)@redis:6379' },
              ],
              resources: res,
              startupProbe: { ...probe('/api/health'), periodSeconds: 5, failureThreshold: 36 },
              readinessProbe: { ...probe('/api/ready'), periodSeconds: 10, timeoutSeconds: 5 },
              livenessProbe: { ...probe('/api/health'), periodSeconds: 20, timeoutSeconds: 5 },
              lifecycle: { preStop: { exec: { command: ['sleep', '10'] } } },
              volumeMounts,
            },
          ],
          volumes,
        },
      },
    },
  }
}

// Pod `app` label; a Deployment's selector can't change, so the controller keeps its original one.
const appLabel = (role: ServiceRole | null) => (role ? `${role}-service` : 'controller-service')

const appService = (ns: string, slug: string, name: string, role: ServiceRole | null): K8sObject => ({
  apiVersion: 'v1',
  kind: 'Service',
  metadata: { name, namespace: ns },
  spec: { selector: selector(slug, appLabel(role)), ports: [{ name: 'http', port: 3000, targetPort: 'http' }] },
})

export function renderTenantWorkload(input: TenantWorkloadInput): K8sObject[] {
  const { slug } = input
  const ns = tenantNamespace(slug)
  const spec = input.compute ?? legacySpecFor(input.plan)
  const layout = input.layout ?? spec.layout ?? 'controller'
  const routeTo = input.routeTo ?? layout
  const nodes = spec.node.placement === 'dedicated' ? spec.node.count : 1
  const place = placement(slug, spec.node, input.nodeGen ?? 0)
  const poolEnv = input.dbPoolMax ? [{ name: 'DB_POOL_MAX', value: String(input.dbPoolMax) }] : []
  const image = (s: TenantService) => input.images?.[s] || DEFAULT_IMAGES[s]
  const secret = input.storeSecret || 'jeffi/production'
  const roles = activeServices(input.plan).filter((k): k is ServiceRole => (STORE_ROLES as readonly string[]).includes(k))
  const adminHosts = input.hosts.filter(h => h.startsWith(`admin-${slug}.`))
  const docHosts = input.hosts.filter(h => DOC_APPS.some(a => h.startsWith(`${a}-${slug}.`)))
  const businessHosts = input.hosts.filter(h => h.startsWith(`${slug}.business.`))
  const publicHosts = input.hosts.filter(h => !adminHosts.includes(h) && !docHosts.includes(h))
  const customDomains = input.customDomains ?? []

  // The store's app pods per layout; the one being left (while switching) runs a single copy, no autoscale.
  const apps: { name: string; role: ServiceRole | null; svc: ServiceSpec; sizeOf: ServiceName; image: string }[] = []
  for (const l of routeTo === layout ? [layout] : [routeTo, layout]) {
    const leaving = l !== layout
    const one = (svc: ServiceSpec) => (leaving ? { ...svc, replicas: 1, maxReplicas: 1 } : svc)
    if (l === 'controller') {
      apps.push({ name: tenantAppName(slug), role: null, svc: one(spec.services.storefront), sizeOf: 'storefront', image: image('controller') })
    } else {
      for (const r of roles) apps.push({ name: tenantRoleName(slug, r), role: r, svc: one(spec.services[r]), sizeOf: r, image: image(r) })
    }
  }
  const backing = (['messaging', 'documents'] as const).map(k => ({ k, svc: spec.services[k] }))
  const quotaPods = [...apps.map(a => a.svc), ...backing.map(b => b.svc)]
  const quotaMem = [
    ...apps.map(a => mem(POD_RESOURCES[a.sizeOf][a.svc.size].limits.memory) * (a.svc.maxReplicas + 1)),
    ...backing.map(b => mem(POD_RESOURCES[b.k][b.svc.size].limits.memory) * (b.svc.maxReplicas + 1)),
  ]

  const objs: K8sObject[] = [
    {
      apiVersion: 'v1',
      kind: 'Namespace',
      metadata: {
        name: ns,
        labels: {
          'jeffi.io/tier': 'tenant',
          'jeffi.io/tenant': slug,
          'jeffi.io/plan': input.plan || 'basic',
          'jeffi.io/placement': spec.node.placement,
        },
      },
    },
    {
      apiVersion: 'v1',
      kind: 'ResourceQuota',
      metadata: { name: 'tenant', namespace: ns },
      spec: {
        hard: {
          pods: String(quotaPods.reduce((n, s) => n + s.maxReplicas + 1, 0) + 3),
          // Room for each Deployment at its autoscale limit plus a rolling pod; +512Mi covers redis + an
          // HTTP-01 solver pod.
          'limits.memory': `${Math.ceil((quotaMem.reduce((n, m) => n + m, 0) + 512) / 256) * 256}Mi`,
        },
      },
    },
    {
      apiVersion: 'apps/v1',
      kind: 'Deployment',
      metadata: { name: 'redis', namespace: ns, labels: { app: 'redis' } },
      spec: {
        replicas: 1,
        strategy: { type: 'Recreate' },
        selector: { matchLabels: { app: 'redis' } },
        template: {
          metadata: { labels: { app: 'redis' } },
          spec: {
            ...place,
            containers: [
              {
                name: 'redis',
                image: 'redis:7-alpine',
                args: [
                  '--requirepass',
                  '$(REDIS_PASSWORD)',
                  '--save',
                  '',
                  '--maxmemory',
                  '48mb',
                  '--maxmemory-policy',
                  'volatile-lru',
                ],
                env: [{ name: 'REDIS_PASSWORD', valueFrom: { secretKeyRef: { name: 'redis', key: 'password' } } }],
                ports: [{ containerPort: 6379 }],
                resources: { requests: REDIS_RESOURCES.requests, limits: { memory: REDIS_RESOURCES.limits.memory } },
              },
            ],
          },
        },
      },
    },
    {
      apiVersion: 'v1',
      kind: 'Service',
      metadata: { name: 'redis', namespace: ns },
      spec: { selector: { app: 'redis' }, ports: [{ port: 6379 }] },
    },
  ]

  for (const a of apps) {
    objs.push(appDeployment({ slug, ns, ...a, place, nodes, poolEnv, secret }), appService(ns, slug, a.name, a.role))
    objs.push(...scaling(ns, a.name, selector(slug, appLabel(a.role)), a.svc))
  }

  for (const { k: service, svc: s } of backing) {
    const b = SERVICES[service]
    objs.push(serviceDeployment(slug, ns, service, s, image(service), place, nodes, poolEnv), {
      apiVersion: 'v1',
      kind: 'Service',
      metadata: { name: tenantServiceName(slug, service), namespace: ns },
      spec: { selector: selector(slug, b.app), ports: [{ name: 'http', port: b.port, targetPort: 'http' }] },
    })
    objs.push(...scaling(ns, tenantServiceName(slug, service), selector(slug, b.app), s))
  }

  objs.push({
    apiVersion: 'networking.k8s.io/v1',
    kind: 'NetworkPolicy',
    metadata: { name: 'isolate', namespace: ns },
    spec: {
      podSelector: {},
      policyTypes: ['Ingress'],
      ingress: [
        {
          from: [
            { podSelector: {} },
            { namespaceSelector: { matchLabels: { 'kubernetes.io/metadata.name': 'kube-system' } } },
            { namespaceSelector: { matchLabels: { 'kubernetes.io/metadata.name': 'observability' } } },
            // The platform's cron fan-out calls the store's admin service.
            { namespaceSelector: { matchLabels: { 'kubernetes.io/metadata.name': 'jeffi' } } },
            { ipBlock: { cidr: '172.31.0.0/16' } },
          ],
        },
      ],
    },
  })

  const strip = { name: 'strip-client-cert', namespace: EDGE_NS }
  const ingress = (name: string, routes: unknown[], tls: Record<string, unknown> = {}): K8sObject => ({
    apiVersion: 'traefik.io/v1alpha1',
    kind: 'IngressRoute',
    metadata: { name, namespace: ns },
    // The TLSOption named `default` applies implicitly; referencing it by name fails in Traefik.
    spec: { entryPoints: ['websecure'], routes, tls },
  })
  const adminTls = { options: { name: 'tenant-mtls', namespace: EDGE_NS } }
  const adminMiddlewares = [strip, { name: 'pass-client-cert', namespace: EDGE_NS }]

  if (routeTo === 'controller') {
    // The all-in-one app takes every host whole.
    const app = [{ name: tenantAppName(slug), port: 3000 }]
    const whole = (hosts: string[], middlewares = [strip]) => [{ match: hostMatch(hosts), kind: 'Rule', middlewares, services: app }]
    objs.push(ingress('controller', whole(publicHosts)))
    if (adminHosts.length) objs.push(ingress('admin', whole(adminHosts, adminMiddlewares), adminTls))
    customDomains.forEach((domain, i) => objs.push(customDomainCert(ns, i, domain), ingress(`custom-${i}`, whole([domain]), { secretName: `custom-${i}-tls` })))
  } else {
    // Each path goes to the service service-routing.ts names for it. A store without the B2B portal
    // sends its business paths to its storefront, which answers them 404.
    const backend = (role: ServiceRole) => ({ name: tenantRoleName(slug, role), port: 3000 })
    const backends = { storefront: backend('storefront'), admin: backend('admin'), business: backend(roles.includes('business') ? 'business' : 'storefront') }
    const routes = (groups: HostGroup[], middlewares = [strip]) => trafficRoutes({ groups, backends, middlewares, band: PRIORITY_BAND.named })
    const storeHosts = publicHosts.filter(h => !businessHosts.includes(h))
    objs.push(
      ingress(
        'store',
        routes([
          { classes: ['store'], match: hostMatch(storeHosts) },
          ...(businessHosts.length ? [{ classes: ['business' as const], match: hostMatch(businessHosts) }] : []),
        ])
      ),
      // The store's own-key Razorpay webhook arrives on the platform host; its storefront takes it.
      ingress('razorpay-webhook', [
        {
          match: `Host(\`${ROOT_DOMAIN}\`) && Path(\`/api/webhooks/razorpay/${slug}\`)`,
          kind: 'Rule',
          priority: PRIORITY_BAND.override,
          middlewares: [strip],
          services: [backends.storefront],
        },
      ])
    )
    if (adminHosts.length) objs.push(ingress('admin', routes([{ classes: ['admin'], match: hostMatch(adminHosts) }], adminMiddlewares), adminTls))
    customDomains.forEach((domain, i) =>
      objs.push(customDomainCert(ns, i, domain), ingress(`custom-${i}`, routes([{ classes: ['store'], match: hostMatch([domain]) }]), { secretName: `custom-${i}-tls` }))
    )
  }
  if (docHosts.length) {
    objs.push(ingress('documents', [{ match: hostMatch(docHosts), kind: 'Rule', middlewares: [strip], services: [{ name: tenantServiceName(slug, 'documents'), port: SERVICES.documents.port }] }]))
  }
  return objs
}

/** A cert-manager certificate for a verified customer domain (HTTP-01). */
function customDomainCert(ns: string, i: number, domain: string): K8sObject {
  return {
    apiVersion: 'cert-manager.io/v1',
    kind: 'Certificate',
    metadata: { name: `custom-${i}`, namespace: ns, annotations: { 'jeffi.io/domain': domain } },
    spec: { secretName: `custom-${i}-tls`, dnsNames: [domain], issuerRef: { kind: 'ClusterIssuer', name: 'letsencrypt-http' } },
  }
}

export { tenantNamespace, dedicatedNodeName }
