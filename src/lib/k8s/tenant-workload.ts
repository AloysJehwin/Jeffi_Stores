import { computeTierFor, dedicatedNodeName, tenantNamespace, type ComputeTier } from '@/lib/provisioning/tiers'
import type { K8sObject } from './client'

// Renders one tenant's namespace: app Deployment + Service + Redis + PDB/HPA + NetworkPolicy +
// IngressRoutes (+ cert-manager Certificate per verified custom domain). Pure, so it is unit
// tested; tenant-compute.ts applies it.

export const DEFAULT_IMAGE = '708835965056.dkr.ecr.us-east-1.amazonaws.com/jeffi-stores:latest'
const EDGE_NS = 'jeffi-edge'

// Traces → Coroot in-cluster, every request (see src/lib/shared/otel.ts).
const OTEL_ENV = [
  { name: 'OTEL_SERVICE_NAME', value: '' },
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
  image?: string
}

const labels = (slug: string) => ({ app: 'storefront', 'jeffi.io/tenant': slug })

export function placement(slug: string, tier: ComputeTier) {
  if (tier.placement === 'dedicated') {
    return {
      nodeSelector: { 'jeffi.io/tenant': slug },
      tolerations: [{ key: 'jeffi.io/tenant', operator: 'Equal', value: slug, effect: 'NoSchedule' }],
    }
  }
  return { nodeSelector: { 'jeffi.io/role': 'pool-basic' }, tolerations: [] as unknown[] }
}

const hostRule = (hosts: string[]) => hosts.map(h => `Host(\`${h}\`)`).join(' || ')

export function renderTenantWorkload(input: TenantWorkloadInput): K8sObject[] {
  const { slug } = input
  const ns = tenantNamespace(slug)
  const tier = computeTierFor(input.plan)
  const place = placement(slug, tier)
  const image = input.image || DEFAULT_IMAGE
  const lbl = labels(slug)
  const adminHosts = input.hosts.filter(h => h.startsWith(`admin-${slug}.`))
  const publicHosts = input.hosts.filter(h => !adminHosts.includes(h))
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
        labels: { 'jeffi.io/tier': 'tenant', 'jeffi.io/tenant': slug, 'jeffi.io/plan': input.plan || 'basic' },
      },
    },
    {
      apiVersion: 'v1',
      kind: 'ResourceQuota',
      metadata: { name: 'tenant', namespace: ns },
      spec: {
        hard: {
          pods: String(tier.maxReplicas + 4),
          'limits.memory': `${Math.ceil((parseInt(tier.limits.memory) * tier.maxReplicas + 512) / 256) * 256}Mi`,
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
                resources: { requests: { cpu: '10m', memory: '24Mi' }, limits: { memory: '96Mi' } },
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
      metadata: { name: 'storefront', namespace: ns, labels: lbl },
      spec: {
        replicas: tier.replicas,
        revisionHistoryLimit: 3,
        strategy: { type: 'RollingUpdate', rollingUpdate: { maxUnavailable: tier.replicas > 1 ? 1 : 0, maxSurge: 1 } },
        selector: { matchLabels: lbl },
        template: {
          metadata: { labels: lbl },
          spec: {
            ...place,
            automountServiceAccountToken: false,
            imagePullSecrets: [{ name: 'regcred' }],
            terminationGracePeriodSeconds: 60,
            securityContext: { runAsUser: 1001, runAsGroup: 1001, fsGroup: 1001 },
            containers: [
              {
                name: 'app',
                image,
                ports: [{ name: 'http', containerPort: 3000 }],
                env: [
                  { name: 'SM_SECRET_ID', value: 'jeffi/production' },
                  { name: 'WEB_CONCURRENCY', value: '1' },
                  { name: 'IN_PROCESS_CRON', value: 'false' },
                  { name: 'CLIENT_CERT_PROXY', value: 'traefik' },
                  ...OTEL_ENV.map(e => (e.name === 'OTEL_SERVICE_NAME' ? { ...e, value: `tenant-${slug}` } : e)),
                  {
                    name: 'NODE_OPTIONS',
                    value: `--max-old-space-size=${Math.floor(parseInt(tier.limits.memory) * 0.7)}`,
                  },
                  { name: 'REDIS_PASSWORD', valueFrom: { secretKeyRef: { name: 'redis', key: 'password' } } },
                  { name: 'REDIS_URL', value: 'redis://:$(REDIS_PASSWORD)@redis:6379' },
                ],
                resources: { requests: tier.requests, limits: tier.limits },
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
                volumeMounts: [
                  { name: 'certs', mountPath: '/app/certs', readOnly: true },
                  { name: 'tmp', mountPath: '/tmp' },
                ],
              },
            ],
            // Tenant pods get only the RDS CA — never the platform CA key.
            volumes: [
              { name: 'certs', configMap: { name: 'rds-ca' } },
              { name: 'tmp', emptyDir: { sizeLimit: '256Mi' } },
            ],
          },
        },
      },
    },
    {
      apiVersion: 'v1',
      kind: 'Service',
      metadata: { name: 'storefront', namespace: ns },
      spec: { selector: lbl, ports: [{ name: 'http', port: 3000, targetPort: 'http' }] },
    },
    {
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
    },
  ]

  if (tier.replicas > 1) {
    objs.push({
      apiVersion: 'policy/v1',
      kind: 'PodDisruptionBudget',
      metadata: { name: 'storefront', namespace: ns },
      spec: { minAvailable: 1, selector: { matchLabels: lbl } },
    })
  }
  if (tier.maxReplicas > tier.replicas) {
    objs.push({
      apiVersion: 'autoscaling/v2',
      kind: 'HorizontalPodAutoscaler',
      metadata: { name: 'storefront', namespace: ns },
      spec: {
        scaleTargetRef: { apiVersion: 'apps/v1', kind: 'Deployment', name: 'storefront' },
        minReplicas: tier.replicas,
        maxReplicas: tier.maxReplicas,
        metrics: [
          { type: 'Resource', resource: { name: 'cpu', target: { type: 'Utilization', averageUtilization: 70 } } },
        ],
      },
    })
  }

  const strip = { name: 'strip-client-cert', namespace: EDGE_NS }
  const svc = [{ name: 'storefront', port: 3000 }]
  objs.push({
    apiVersion: 'traefik.io/v1alpha1',
    kind: 'IngressRoute',
    metadata: { name: 'storefront', namespace: ns },
    spec: {
      entryPoints: ['websecure'],
      routes: [{ match: hostRule(publicHosts), kind: 'Rule', middlewares: [strip], services: svc }],
      // The TLSOption named `default` applies implicitly; referencing it by name fails in Traefik.
      tls: {},
    },
  })
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
