import { dedicatedNodeName, tenantNamespace } from '@/lib/provisioning/tiers'
import { legacySpecFor } from '@/lib/compute/legacy'
import { POD_RESOURCES, REDIS_RESOURCES } from '@/lib/compute/presets'
import { SERVICE_NAMES, type ComputeSpec, type ServiceSpec } from '@/lib/compute/spec'
import type { K8sObject } from './client'

// Renders one tenant's namespace: its controller, messaging and document services (Deployment +
// Service each, wired to one another), Redis, PDB/HPA, NetworkPolicy and IngressRoutes (+ cert-manager
// Certificate per verified custom domain). Pure, so it is unit tested; tenant-compute.ts applies it.

const ECR = '708835965056.dkr.ecr.us-east-1.amazonaws.com'
export type TenantService = 'controller' | 'messaging' | 'documents'
export const DEFAULT_IMAGES: Record<TenantService, string> = {
  controller: `${ECR}/jeffi-stores-controller-service:latest`,
  messaging: `${ECR}/jeffi-stores-messaging-service:latest`,
  documents: `${ECR}/jeffi-stores-document-service:latest`,
}
const EDGE_NS = 'jeffi-edge'
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
}

const SERVICES = {
  messaging: { app: 'messaging-service', suffix: 'messaging-service', port: 3101, secret: 'jeffi/messaging/production' },
  documents: { app: 'document-service', suffix: 'document-service', port: 3102, secret: 'jeffi/documents/production' },
} as const
type BackingService = keyof typeof SERVICES

/** The store's controller Deployment/Service/HPA/PDB name. */
export const tenantAppName = (slug: string) => `${slug}-controller-service`
export const tenantServiceName = (slug: string, service: BackingService) => `${slug}-${SERVICES[service].suffix}`
/** Every Deployment a store runs. */
export const tenantWorkloadNames = (slug: string) => [
  tenantAppName(slug),
  tenantServiceName(slug, 'messaging'),
  tenantServiceName(slug, 'documents'),
]
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

const hostRule = (hosts: string[]) => hosts.map(h => `Host(\`${h}\`)`).join(' || ')

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
      strategy: { type: 'RollingUpdate', rollingUpdate: { maxUnavailable: 0, maxSurge: 1 } },
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

export function renderTenantWorkload(input: TenantWorkloadInput): K8sObject[] {
  const { slug } = input
  const ns = tenantNamespace(slug)
  const spec = input.compute ?? legacySpecFor(input.plan)
  const nodes = spec.node.placement === 'dedicated' ? spec.node.count : 1
  const place = placement(slug, spec.node, input.nodeGen ?? 0)
  const ctrl = spec.services.controller
  const ctrlRes = POD_RESOURCES.controller[ctrl.size]
  const poolEnv = input.dbPoolMax ? [{ name: 'DB_POOL_MAX', value: String(input.dbPoolMax) }] : []
  const image = (s: TenantService) => input.images?.[s] || DEFAULT_IMAGES[s]
  const app = tenantAppName(slug)
  const ctrlSelector = selector(slug, 'controller-service')
  const adminHosts = input.hosts.filter(h => h.startsWith(`admin-${slug}.`))
  const docHosts = input.hosts.filter(h => DOC_APPS.some(a => h.startsWith(`${a}-${slug}.`)))
  const publicHosts = input.hosts.filter(h => !adminHosts.includes(h) && !docHosts.includes(h))
  const customDomains = input.customDomains ?? []
  // Probes use localhost: the app 404s a tenant host until the tenant is active, which happens only
  // after these pods are Ready. verify_serving checks readiness separately.
  const probeHost = [{ name: 'Host', value: 'localhost' }]

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
          pods: String(SERVICE_NAMES.reduce((n, k) => n + spec.services[k].maxReplicas + 1, 0) + 3),
          // Every Deployment surges one pod on a rollout (maxUnavailable 0 would otherwise stall it).
          // +512Mi covers redis + an HTTP-01 solver pod.
          'limits.memory': `${
            Math.ceil(
              (SERVICE_NAMES.reduce((n, k) => n + mem(POD_RESOURCES[k][spec.services[k].size].limits.memory) * (spec.services[k].maxReplicas + 1), 0) + 512) / 256
            ) * 256
          }Mi`,
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
    {
      apiVersion: 'apps/v1',
      kind: 'Deployment',
      metadata: { name: app, namespace: ns, labels: labels(slug, 'controller-service', 'controller') },
      spec: {
        replicas: ctrl.replicas,
        revisionHistoryLimit: 3,
        strategy: { type: 'RollingUpdate', rollingUpdate: { maxUnavailable: ctrl.replicas > 1 ? 1 : 0, maxSurge: 1 } },
        selector: { matchLabels: ctrlSelector },
        template: {
          metadata: { labels: labels(slug, 'controller-service', 'controller') },
          spec: {
            ...podBase(place, 60),
            ...spread(slug, 'controller-service', nodes),
            containers: [
              {
                name: 'app',
                image: image('controller'),
                ports: [{ name: 'http', containerPort: 3000 }],
                env: [
                  { name: 'SM_SECRET_ID', value: 'jeffi/production' },
                  { name: 'WEB_CONCURRENCY', value: '1' },
                  ...poolEnv,
                  { name: 'IN_PROCESS_CRON', value: 'false' },
                  { name: 'CLIENT_CERT_PROXY', value: 'traefik' },
                  { name: 'MESSAGING_URL', value: `http://${tenantServiceName(slug, 'messaging')}:${SERVICES.messaging.port}` },
                  { name: 'DOCUMENTS_URL', value: `http://${tenantServiceName(slug, 'documents')}:${SERVICES.documents.port}` },
                  { name: 'OTEL_SERVICE_NAME', value: app },
                  ...OTEL_ENV,
                  { name: 'NODE_OPTIONS', value: `--max-old-space-size=${Math.floor(mem(ctrlRes.limits.memory) * 0.7)}` },
                  { name: 'REDIS_PASSWORD', valueFrom: { secretKeyRef: { name: 'redis', key: 'password' } } },
                  { name: 'REDIS_URL', value: 'redis://:$(REDIS_PASSWORD)@redis:6379' },
                ],
                resources: ctrlRes,
                startupProbe: {
                  httpGet: { path: '/api/health', port: 'http', httpHeaders: probeHost },
                  periodSeconds: 5,
                  failureThreshold: 36,
                },
                readinessProbe: {
                  httpGet: { path: '/api/ready', port: 'http', httpHeaders: probeHost },
                  periodSeconds: 10,
                  timeoutSeconds: 5,
                },
                livenessProbe: {
                  httpGet: { path: '/api/health', port: 'http', httpHeaders: probeHost },
                  periodSeconds: 20,
                  timeoutSeconds: 5,
                },
                lifecycle: { preStop: { exec: { command: ['sleep', '10'] } } },
                volumeMounts,
              },
            ],
            volumes,
          },
        },
      },
    },
    {
      apiVersion: 'v1',
      kind: 'Service',
      metadata: { name: app, namespace: ns },
      spec: { selector: ctrlSelector, ports: [{ name: 'http', port: 3000, targetPort: 'http' }] },
    },
  ]

  for (const service of ['messaging', 'documents'] as const) {
    const s = SERVICES[service]
    objs.push(serviceDeployment(slug, ns, service, spec.services[service], image(service), place, nodes, poolEnv), {
      apiVersion: 'v1',
      kind: 'Service',
      metadata: { name: tenantServiceName(slug, service), namespace: ns },
      spec: { selector: selector(slug, s.app), ports: [{ name: 'http', port: s.port, targetPort: 'http' }] },
    })
    objs.push(...scaling(ns, tenantServiceName(slug, service), selector(slug, s.app), spec.services[service]))
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
            { ipBlock: { cidr: '172.31.0.0/16' } },
          ],
        },
      ],
    },
  })

  objs.push(...scaling(ns, app, ctrlSelector, ctrl))

  const strip = { name: 'strip-client-cert', namespace: EDGE_NS }
  const svc = [{ name: app, port: 3000 }]
  objs.push({
    apiVersion: 'traefik.io/v1alpha1',
    kind: 'IngressRoute',
    metadata: { name: 'controller', namespace: ns },
    spec: {
      entryPoints: ['websecure'],
      routes: [{ match: hostRule(publicHosts), kind: 'Rule', middlewares: [strip], services: svc }],
      // The TLSOption named `default` applies implicitly; referencing it by name fails in Traefik.
      tls: {},
    },
  })
  if (docHosts.length) {
    objs.push({
      apiVersion: 'traefik.io/v1alpha1',
      kind: 'IngressRoute',
      metadata: { name: 'documents', namespace: ns },
      spec: {
        entryPoints: ['websecure'],
        routes: [
          {
            match: hostRule(docHosts),
            kind: 'Rule',
            middlewares: [strip],
            services: [{ name: tenantServiceName(slug, 'documents'), port: SERVICES.documents.port }],
          },
        ],
        tls: {},
      },
    })
  }
  if (adminHosts.length) {
    objs.push({
      apiVersion: 'traefik.io/v1alpha1',
      kind: 'IngressRoute',
      metadata: { name: 'admin', namespace: ns },
      spec: {
        entryPoints: ['websecure'],
        routes: [
          {
            match: hostRule(adminHosts),
            kind: 'Rule',
            middlewares: [strip, { name: 'pass-client-cert', namespace: EDGE_NS }],
            services: svc,
          },
        ],
        tls: { options: { name: 'tenant-mtls', namespace: EDGE_NS } },
      },
    })
  }
  customDomains.forEach((domain, i) => {
    const secretName = `custom-${i}-tls`
    objs.push(
      {
        apiVersion: 'cert-manager.io/v1',
        kind: 'Certificate',
        metadata: { name: `custom-${i}`, namespace: ns, annotations: { 'jeffi.io/domain': domain } },
        spec: { secretName, dnsNames: [domain], issuerRef: { kind: 'ClusterIssuer', name: 'letsencrypt-http' } },
      },
      {
        apiVersion: 'traefik.io/v1alpha1',
        kind: 'IngressRoute',
        metadata: { name: `custom-${i}`, namespace: ns },
        spec: {
          entryPoints: ['websecure'],
          routes: [{ match: hostRule([domain]), kind: 'Rule', middlewares: [strip], services: svc }],
          tls: { secretName },
        },
      }
    )
  })
  return objs
}

export { tenantNamespace, dedicatedNodeName }
