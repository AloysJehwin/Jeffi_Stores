import { dedicatedNodeName, tenantNamespace } from '@/lib/provisioning/tiers'
import { legacySpecFor } from '@/lib/compute/legacy'
import { NODE_DB_MAX_CONNECTIONS, POD_RESOURCES, REDIS_RESOURCES, redisSize } from '@/lib/compute/presets'
import { activeServices, type ComputeSpec, type ServiceName, type ServiceSpec, type StoreLayout } from '@/lib/compute/spec'
import { nodeTier, surges } from '@/lib/compute/validate'
import { STORE_ROLES, type ServiceRole } from '@/lib/service-routing'
import type { K8sObject } from './client'
import { DB_READY_LABEL } from './node-user-data'
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
  customDomains?: string[] // customer-owned, cert-pending or verified
  images?: Partial<Record<TenantService, string>>
  compute?: ComputeSpec // defaults to the plan's pre-configurable tier
  dbPoolMax?: number // per-pod database pool (DB_POOL_MAX)
  nodeGen?: number // generation of the store's own servers; pods follow it during a resize
  layout?: StoreLayout // what runs; defaults to the spec's (old stores: controller)
  routeTo?: StoreLayout // while switching layouts: traffic stays on this one, which runs a single copy
  storeSecret?: string // Secrets Manager id for the store's app pods (default: the platform's)
  dbPassword?: string // node-mode Postgres password (tenant-db-secret.ts); without it the Secret is rendered with none
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
/** IngressRoutes the renderer owns (custom-{domain} ones are pruned by label). */
export const TENANT_ROUTE_NAMES = ['controller', 'store', 'admin', 'business', 'documents', 'razorpay-webhook']
/** Earlier store Deployment names (Service and IngressRoute were `storefront`); retired once the controller serves. */
export const legacyAppNames = (slug: string) => ['storefront', slug]

const selector = (slug: string, app: string) => ({ app, 'jeffi.io/tenant': slug })
const labels = (slug: string, app: string, service: TenantService) => ({ ...selector(slug, app), 'jeffi.io/service': service })
const mem = (m: string) => parseInt(m)
type EnvVar = { name: string; value?: string; valueFrom?: unknown }

// A node-mode store's pods read its database password from the Postgres Secret: their servers' role
// can't read jeffi/tenant-db/*. TENANT_DB_SLUG names the store it belongs to (db.ts / tenancy pools).
const nodeDbEnv = (slug: string): EnvVar[] => [
  { name: 'TENANT_DB_SLUG', value: slug },
  { name: 'TENANT_DB_PASSWORD', valueFrom: { secretKeyRef: { name: postgresName(slug), key: 'password', optional: true } } },
]
const postgresName = (slug: string) => `${slug}-postgres`
const redisPing = { exec: { command: ['sh', '-c', 'REDISCLI_AUTH="$REDIS_PASSWORD" redis-cli ping | grep -q PONG'] }, timeoutSeconds: 3 }
// Postgres memory limit; counted in the namespace quota (its init container's limit is below it).
const PG_MEM_LIMIT = '768Mi'
const TLS_INIT_RESOURCES = { requests: { cpu: '50m', memory: '64Mi' }, limits: { memory: '64Mi' } }

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

function serviceDeployment(slug: string, ns: string, service: BackingService, spec: ServiceSpec, image: string, place: ReturnType<typeof placement>, nodes: number, poolEnv: { name: string; value: string }[], dbEnv: EnvVar[]): K8sObject {
  const s = SERVICES[service]
  const res = POD_RESOURCES[service][spec.size]
  const lbl = labels(slug, s.app, service)
  const env = [
    { name: 'SM_SECRET_ID', value: s.secret },
    ...poolEnv,
    ...dbEnv,
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
  dbEnv: EnvVar[]
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
                ...(a.secret !== 'jeffi/production' ? [{ name: 'SM_SECRET_FALLBACK_ID', value: 'jeffi/production' }] : []),
                // The image is the role; this pins the pod to its store.
                ...(a.role ? [{ name: 'SERVICE_TENANT_SLUG', value: a.slug }] : []),
                ...(a.role === 'admin' ? [{ name: 'STOREFRONT_URL', value: `http://${tenantRoleName(a.slug, 'storefront')}:3000` }] : []),
                { name: 'WEB_CONCURRENCY', value: '1' },
                ...a.poolEnv,
                ...a.dbEnv,
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
  const redis = redisSize(spec.node.placement === 'dedicated' ? nodeTier(spec.node.type) : 0)
  const place = placement(slug, spec.node, input.nodeGen ?? 0)
  const poolEnv = input.dbPoolMax ? [{ name: 'DB_POOL_MAX', value: String(input.dbPoolMax) }] : []
  const nodeDb = spec.db.mode === 'node'
  const dbEnv = nodeDb ? nodeDbEnv(slug) : []
  const image = (s: TenantService) => input.images?.[s] || DEFAULT_IMAGES[s]
  // The store apps' narrower secret; the old all-in-one app keeps the platform's.
  const secret = input.storeSecret || 'jeffi/store'
  const roles = activeServices(input.plan).filter((k): k is ServiceRole => (STORE_ROLES as readonly string[]).includes(k))
  const adminHosts = input.hosts.filter(h => h.startsWith(`admin-${slug}.`))
  const docHosts = input.hosts.filter(h => DOC_APPS.some(a => h.startsWith(`${a}-${slug}.`)))
  const businessHosts = input.hosts.filter(h => h.startsWith(`${slug}.business.`))
  // public-{slug} is the shared public API gateway's (platform IngressRoute), never the store's.
  const publicHosts = input.hosts.filter(h => !adminHosts.includes(h) && !docHosts.includes(h) && !h.startsWith(`public-${slug}.`))
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
    ...(nodeDb ? [mem(PG_MEM_LIMIT)] : []),
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
          pods: String(quotaPods.reduce((n, s) => n + s.maxReplicas + 1, 0) + 3 + (nodeDb ? 1 : 0)),
          // Room for each Deployment at its autoscale limit plus a rolling pod, redis, and an HTTP-01 solver pod.
          'limits.memory': `${Math.ceil((quotaMem.reduce((n, m) => n + m, 0) + redis.limitMib + 416) / 256) * 256}Mi`,
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
          // jeffi.io/tenant lists it with the store's pods (getTenantWorkloadStatus).
          metadata: { labels: { app: 'redis', 'jeffi.io/tenant': slug } },
          spec: {
            ...place,
            containers: [
              {
                name: 'redis',
                image: 'redis:7-alpine',
                // Only short-lived keys (codes, counters, locks), so no disk; when full it drops the least used.
                args: [
                  '--requirepass',
                  '$(REDIS_PASSWORD)',
                  '--save',
                  '',
                  '--maxmemory',
                  `${redis.maxmemoryMb}mb`,
                  '--maxmemory-policy',
                  'allkeys-lru',
                ],
                env: [{ name: 'REDIS_PASSWORD', valueFrom: { secretKeyRef: { name: 'redis', key: 'password' } } }],
                ports: [{ containerPort: 6379 }],
                resources: { requests: REDIS_RESOURCES.requests, limits: { memory: `${redis.limitMib}Mi` } },
                readinessProbe: { ...redisPing, periodSeconds: 10 },
                livenessProbe: { ...redisPing, periodSeconds: 20, failureThreshold: 3 },
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
    objs.push(appDeployment({ slug, ns, ...a, place, nodes, poolEnv, dbEnv, secret: a.role ? secret : 'jeffi/production' }), appService(ns, slug, a.name, a.role))
    objs.push(...scaling(ns, a.name, selector(slug, appLabel(a.role)), a.svc))
  }

  for (const { k: service, svc: s } of backing) {
    const b = SERVICES[service]
    objs.push(serviceDeployment(slug, ns, service, s, image(service), place, nodes, poolEnv, dbEnv), {
      apiVersion: 'v1',
      kind: 'Service',
      metadata: { name: tenantServiceName(slug, service), namespace: ns },
      spec: { selector: selector(slug, b.app), ports: [{ name: 'http', port: b.port, targetPort: 'http' }] },
    })
    objs.push(...scaling(ns, tenantServiceName(slug, service), selector(slug, b.app), s))
  }

  // Node mode: the store's Postgres on its own server, on the database disk.
  if (nodeDb) objs.push(...postgresWorkload(slug, ns, place, input.dbPassword))

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
  const ingress = (name: string, routes: unknown[], tls: Record<string, unknown> = {}, labels?: Record<string, string>): K8sObject => ({
    apiVersion: 'traefik.io/v1alpha1',
    kind: 'IngressRoute',
    metadata: { name, namespace: ns, ...(labels && { labels }) },
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
    for (const domain of customDomains) objs.push(customDomainCert(ns, domain), ingress(customDomainName(domain), whole([domain]), { secretName: customDomainSecret(domain) }, CUSTOM_DOMAIN_LABEL))
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
      // The store's own-key Razorpay and PhonePe webhooks arrive on the platform host; its storefront takes them.
      ingress('razorpay-webhook', [
        {
          match: `Host(\`${ROOT_DOMAIN}\`) && (Path(\`/api/webhooks/razorpay/${slug}\`) || Path(\`/api/webhooks/upi/${slug}\`))`,
          kind: 'Rule',
          priority: PRIORITY_BAND.override,
          middlewares: [strip],
          services: [backends.storefront],
        },
      ])
    )
    if (adminHosts.length) objs.push(ingress('admin', routes([{ classes: ['admin'], match: hostMatch(adminHosts) }], adminMiddlewares), adminTls))
    for (const domain of customDomains)
      objs.push(customDomainCert(ns, domain), ingress(customDomainName(domain), routes([{ classes: ['store'], match: hostMatch([domain]) }]), { secretName: customDomainSecret(domain) }, CUSTOM_DOMAIN_LABEL))
  }
  if (docHosts.length) {
    objs.push(ingress('documents', [{ match: hostMatch(docHosts), kind: 'Rule', middlewares: [strip], services: [{ name: tenantServiceName(slug, 'documents'), port: SERVICES.documents.port }] }]))
  }
  return objs
}

// The store's Postgres (pgvector image, uid 999): one pod on the server holding its database disk
// (jeffi.io/db-ready, set by the server's db agent once the disk is mounted at /var/lib/jeffi/db), so
// it never starts on the server's own disk. TLS is self-signed, made on the disk at first start. The
// Secret carries `password` only when the caller passes it (provisioning, from Secrets Manager);
// Postgres reads it once, when it initialises an empty data directory.
const PG_UID = 999

function postgresWorkload(slug: string, ns: string, place: ReturnType<typeof placement>, dbPassword?: string): K8sObject[] {
  const name = postgresName(slug)
  const lbl = { app: name, 'jeffi.io/tenant': slug, 'jeffi.io/service': 'postgres' }
  const dataMount = { name: 'data', mountPath: '/var/lib/postgresql/data' }
  // Not the server generation: the database stays on its disk's server while the apps move (handOffNodeDb).
  const nodeSelector = Object.fromEntries(Object.entries(place.nodeSelector).filter(([k]) => k !== 'jeffi.io/gen'))
  const tlsInit = [
    'set -e; D=/var/lib/postgresql/data',
    // An ext4 disk has lost+found; the server's own disk under it does not.
    '[ -d "$D/lost+found" ] || { echo "database disk not mounted"; exit 1; }',
    'if [ ! -s "$D/server.crt" ] || [ ! -s "$D/server.key" ]; then apk add --no-cache openssl >/dev/null && ' +
      'openssl req -x509 -nodes -newkey rsa:2048 -days 3650 -subj "/CN=postgres" -keyout "$D/server.key" -out "$D/server.crt"; fi',
    `chown ${PG_UID}:${PG_UID} "$D/server.key" "$D/server.crt"; chmod 600 "$D/server.key" "$D/server.crt"`,
  ].join('; ')
  const ready = { exec: { command: ['pg_isready', '-h', '127.0.0.1', '-U', 'jeffi'] } }
  return [
    {
      apiVersion: 'v1',
      kind: 'Secret',
      metadata: { name, namespace: ns, labels: lbl },
      type: 'Opaque',
      stringData: { username: 'jeffi', database: 'jeffi_stores', ...(dbPassword ? { password: dbPassword } : {}) },
    },
    {
      apiVersion: 'apps/v1',
      kind: 'Deployment',
      metadata: { name, namespace: ns, labels: lbl },
      // No `replicas`: handOffNodeDb scales it to 0 while the disk moves, and a re-apply must not undo that.
      spec: {
        revisionHistoryLimit: 3,
        strategy: { type: 'Recreate' },
        selector: { matchLabels: { app: name } },
        template: {
          metadata: { labels: lbl },
          spec: {
            nodeSelector: { ...nodeSelector, [DB_READY_LABEL]: 'true' },
            tolerations: place.tolerations,
            automountServiceAccountToken: false,
            terminationGracePeriodSeconds: 60,
            initContainers: [
              {
                name: 'tls-init',
                image: 'alpine:3.20',
                command: ['sh', '-c', tlsInit],
                securityContext: { runAsUser: 0 },
                resources: TLS_INIT_RESOURCES,
                volumeMounts: [dataMount],
              },
            ],
            containers: [
              {
                name: 'postgres',
                image: 'pgvector/pgvector:pg16',
                args: [
                  '-c', 'ssl=on',
                  '-c', 'ssl_cert_file=/var/lib/postgresql/data/server.crt',
                  '-c', 'ssl_key_file=/var/lib/postgresql/data/server.key',
                  // Pool sizes are planned against this (validate.ts nodeDbMaxConnections).
                  '-c', `max_connections=${NODE_DB_MAX_CONNECTIONS}`,
                ],
                env: [
                  { name: 'POSTGRES_PASSWORD', valueFrom: { secretKeyRef: { name, key: 'password' } } },
                  { name: 'POSTGRES_USER', valueFrom: { secretKeyRef: { name, key: 'username' } } },
                  { name: 'POSTGRES_DB', valueFrom: { secretKeyRef: { name, key: 'database' } } },
                  { name: 'PGDATA', value: '/var/lib/postgresql/data/pgdata' },
                ],
                ports: [{ name: 'pg', containerPort: 5432 }],
                resources: { requests: { cpu: '100m', memory: '256Mi' }, limits: { memory: PG_MEM_LIMIT } },
                volumeMounts: [dataMount, { name: 'shm', mountPath: '/dev/shm' }],
                // Over TCP: the first-start init server listens on the socket only.
                startupProbe: { ...ready, periodSeconds: 5, failureThreshold: 120 },
                readinessProbe: { ...ready, periodSeconds: 10, timeoutSeconds: 5 },
                livenessProbe: { ...ready, periodSeconds: 20, timeoutSeconds: 5, failureThreshold: 6 },
              },
            ],
            volumes: [
              { name: 'data', hostPath: { path: '/var/lib/jeffi/db', type: 'Directory' } },
              { name: 'shm', emptyDir: { medium: 'Memory', sizeLimit: '128Mi' } },
            ],
          },
        },
      },
    },
    {
      apiVersion: 'v1',
      kind: 'Service',
      metadata: { name, namespace: ns, labels: lbl },
      spec: { selector: { app: name }, ports: [{ name: 'pg', port: 5432, targetPort: 'pg' }] },
    },
  ]
}

// Custom-domain objects are named by the domain (a valid DNS-1123 subdomain), not list position, so
// deleting one never shifts another onto its certificate; the label lets applyTenantWorkload prune them.
export const CUSTOM_DOMAIN_LABEL = { 'jeffi.io/custom-domain': 'true' }
export const customDomainName = (domain: string) => `custom-${domain}`
export const customDomainSecret = (domain: string) => `custom-${domain}-tls`

/** A cert-manager certificate for a customer domain (HTTP-01). */
function customDomainCert(ns: string, domain: string): K8sObject {
  return {
    apiVersion: 'cert-manager.io/v1',
    kind: 'Certificate',
    metadata: { name: customDomainName(domain), namespace: ns, labels: CUSTOM_DOMAIN_LABEL, annotations: { 'jeffi.io/domain': domain } },
    spec: { secretName: customDomainSecret(domain), dnsNames: [domain], issuerRef: { kind: 'ClusterIssuer', name: 'letsencrypt-http' } },
  }
}

export { tenantNamespace, dedicatedNodeName }
