import 'server-only'
import type { K8sObject } from '@/lib/k8s/client'

// Showcase custom domains reach showcase-service, the platform's one Deployment for every site, so their routes and
// certificates live in its namespace (jeffi), never a store's. One reconcile renders every routed Showcase host: a
// cert-manager Certificate (HTTP-01, like a store's own domain) and an IngressRoute to the service. The label lets
// the reconcile prune hosts that left.

export const SHOWCASE_NS = 'jeffi'
const LABEL_KEY = 'jeffi.io/showcase-domain'
const SERVICE = { name: 'jeffi-stores-showcase-service', port: 3000 }
const MIDDLEWARES = [
  { name: 'strip-client-cert', namespace: 'jeffi-edge' },
  { name: 'compress', namespace: 'jeffi-edge' },
]

export const showcaseDomainName = (domain: string) => `showcase-${domain}`
const secretName = (domain: string) => `showcase-${domain}-tls`

export function renderShowcaseDomains(domains: string[]): K8sObject[] {
  const labels = { [LABEL_KEY]: 'true' }
  return [...new Set(domains)].flatMap((domain): K8sObject[] => [
    {
      apiVersion: 'cert-manager.io/v1',
      kind: 'Certificate',
      metadata: { name: showcaseDomainName(domain), namespace: SHOWCASE_NS, labels, annotations: { 'jeffi.io/domain': domain } },
      spec: { secretName: secretName(domain), dnsNames: [domain], issuerRef: { kind: 'ClusterIssuer', name: 'letsencrypt-http' } },
    },
    {
      apiVersion: 'traefik.io/v1alpha1',
      kind: 'IngressRoute',
      metadata: { name: showcaseDomainName(domain), namespace: SHOWCASE_NS, labels },
      spec: {
        entryPoints: ['websecure'],
        routes: [{ match: `Host(\`${domain}\`)`, kind: 'Rule', middlewares: MIDDLEWARES, services: [SERVICE] }],
        tls: { secretName: secretName(domain) },
      },
    },
  ])
}

/** Apply every routed Showcase host and prune the rest. In-cluster only; elsewhere nothing to do. */
export async function applyShowcaseRoutes(): Promise<void> {
  const { apply, inCluster, list, remove } = await import('@/lib/k8s/client')
  if (!inCluster()) return
  const { routedShowcaseDomains } = await import('@/lib/showcase/domain')
  const objs = renderShowcaseDomains(await routedShowcaseDomains())
  for (const o of objs) await apply(o)
  const keep = new Set(objs.map(o => `${o.kind}/${o.metadata.name}`))
  for (const kind of ['IngressRoute', 'Certificate']) {
    for (const o of await list<any>(kind, SHOWCASE_NS, `${LABEL_KEY}=true`)) {
      if (keep.has(`${kind}/${o.metadata.name}`)) continue
      await remove(kind, o.metadata.name, SHOWCASE_NS)
      if (kind === 'Certificate' && o.spec?.secretName) await remove('Secret', o.spec.secretName, SHOWCASE_NS)
    }
  }
}

/** Whether cert-manager issued the host's certificate. */
export async function showcaseCertReady(domain: string): Promise<boolean> {
  const { get } = await import('@/lib/k8s/client')
  const cert = await get<any>('Certificate', showcaseDomainName(domain), SHOWCASE_NS).catch(() => null)
  return (cert?.status?.conditions ?? []).some((c: any) => c.type === 'Ready' && c.status === 'True')
}
