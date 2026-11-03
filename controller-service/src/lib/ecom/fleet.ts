import 'server-only'
import type { TenantServer } from '@/lib/shared/ec2-client'

// What each store actually runs: its servers (EC2), pods and Deployments (k8s). One cluster-wide read of
// each, cached 30 s. Only in-cluster: the k8s client uses the pod's ServiceAccount and has no kubeconfig
// fallback, and outside the cluster (a developer Mac, whose default context is another cluster) getFleet
// returns null before touching k8s or EC2.

export type { TenantServer }

export interface TenantFleet {
  /** 'pool' | 'dedicated' from the namespace; null when it has none. */
  placement: 'pool' | 'dedicated' | null
  servers: TenantServer[]
  /** Store pods (label jeffi.io/tenant), terminating and finished ones aside. */
  pods: { ready: number; total: number }
  /** Every Deployment in tenant-<slug> (redis included). */
  deployments: { name: string; ready: number; desired: number }[]
  /** Its on-node Postgres pods are Ready; null when it runs none. */
  postgresReady: boolean | null
}

export interface Fleet {
  at: string
  tenants: Record<string, TenantFleet>
  pool: {
    /** k8s instances without a jeffi-tenant tag: core and pool-basic-N. */
    servers: TenantServer[]
    nodes: number
    readyNodes: number
    /** Stores the Ready pool nodes can hold, and stores placed on the pool. */
    capacity: number
    stores: number
  }
}

const TTL_MS = 30_000
const TIMEOUT_MS = 10_000
let cache: { at: number; fleet: Fleet | null } | null = null
let inflight: Promise<Fleet | null> | null = null
let warned = false

const podReady = (p: any) =>
  p.status?.phase === 'Running' && !!p.status?.conditions?.some((c: any) => c.type === 'Ready' && c.status === 'True')

async function load(): Promise<Fleet> {
  const k8s = await import('@/lib/k8s/client')
  const { isPostgres, isReady, onPool, poolCapacity } = await import('@/lib/k8s/tenant-compute')
  const { describeTenantServers } = await import('@/lib/shared/ec2-client')
  const [pods, deployments, namespaces, nodes, ec2] = await Promise.all([
    k8s.listAll<any>('Pod', 'jeffi.io/tenant'),
    k8s.listAll<any>('Deployment'),
    k8s.list<any>('Namespace', undefined, 'jeffi.io/tier=tenant'),
    k8s.list<any>('Node'),
    describeTenantServers(),
  ])

  const tenants: Record<string, TenantFleet> = {}
  const at = (slug: string) =>
    (tenants[slug] ??= { placement: null, servers: [], pods: { ready: 0, total: 0 }, deployments: [], postgresReady: null })

  for (const ns of namespaces) {
    const slug = ns.metadata?.labels?.['jeffi.io/tenant'] ?? ns.metadata?.name?.replace(/^tenant-/, '')
    if (slug) at(slug).placement = onPool(ns) ? 'pool' : 'dedicated'
  }
  for (const [slug, servers] of Object.entries(ec2.byTenant)) at(slug).servers = servers
  const pg: Record<string, boolean> = {}
  for (const p of pods) {
    const slug = p.metadata?.labels?.['jeffi.io/tenant']
    if (!slug || p.metadata?.deletionTimestamp || ['Succeeded', 'Failed'].includes(p.status?.phase)) continue
    const t = at(slug)
    t.pods.total++
    if (podReady(p)) t.pods.ready++
    if (isPostgres(p)) pg[slug] = (pg[slug] ?? true) && podReady(p)
  }
  for (const d of deployments) {
    const ns: string = d.metadata?.namespace ?? ''
    if (!ns.startsWith('tenant-')) continue
    const t = at(ns.slice('tenant-'.length))
    t.deployments.push({ name: d.metadata.name, ready: d.status?.readyReplicas ?? 0, desired: d.spec?.replicas ?? 0 })
    if (isPostgres(d)) t.postgresReady = pg[ns.slice('tenant-'.length)] ?? false
  }

  const poolNodes = nodes.filter(n => n.metadata?.labels?.['jeffi.io/pool'] === 'basic')
  const readyPool = poolNodes.filter(isReady)
  return {
    at: new Date().toISOString(),
    tenants,
    pool: {
      servers: ec2.shared,
      nodes: poolNodes.length,
      readyNodes: readyPool.length,
      capacity: readyPool.reduce((n, node) => n + poolCapacity(node), 0),
      stores: namespaces.filter(onPool).length,
    },
  }
}

/** The live fleet; null outside the cluster, or (logged once) when k8s or EC2 can't be read. Never throws. */
export async function getFleet(): Promise<Fleet | null> {
  const { inCluster } = await import('@/lib/k8s/client')
  if (!inCluster()) return null
  if (cache && Date.now() - cache.at < TTL_MS) return cache.fleet
  let timer: ReturnType<typeof setTimeout> | undefined
  inflight ??= Promise.race([
    load(),
    new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error(`timed out after ${TIMEOUT_MS} ms`)), TIMEOUT_MS))),
  ])
    .finally(() => clearTimeout(timer))
    .then(
      fleet => {
        warned = false
        return fleet
      },
      e => {
        if (!warned) console.error('[fleet] cluster or EC2 unreadable:', (e as Error)?.message)
        warned = true
        return null
      }
    )
    .then(fleet => {
      cache = { at: Date.now(), fleet }
      inflight = null
      return fleet
    })
  return inflight
}
