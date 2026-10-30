import 'server-only'
import crypto from 'node:crypto'
import { apply, get, list, listAll, patchMerge, remove, type K8sObject } from './client'
import {
  renderTenantWorkload,
  tenantAppName,
  tenantWorkloadNames,
  legacyAppNames,
  type TenantService,
  type TenantWorkloadInput,
} from './tenant-workload'
import { agentNodeUserData } from './node-user-data'
import {
  dedicatedNodeName,
  isTenantNodeName,
  POOL_NODE_CAPACITY,
  POOL_NODE_TYPE,
  tenantNamespace,
  tenantNodeName,
} from '@/lib/provisioning/tiers'
import type { ComputeSpec } from '@/lib/compute/spec'

// k3s compute for a tenant (PROVISIONING_COMPUTE=k8s). Every call is idempotent so the
// provisioning worker can retry it; node launches report 'pending' until the node is Ready.

const PLATFORM_NS = 'jeffi'

export function k8sComputeEnabled(): boolean {
  return process.env.PROVISIONING_COMPUTE === 'k8s'
}

/** The public IP every tenant host resolves to (wildcard DNS → core node / Traefik). */
export function clusterIngressIp(): string {
  const ip = (process.env.CLUSTER_INGRESS_IP || '').trim()
  if (!ip) throw new Error('CLUSTER_INGRESS_IP is not set')
  return ip
}

function nodeLaunchConfig() {
  const server = process.env.K8S_SERVER_URL
  const imageId = process.env.K8S_NODE_AMI_ID
  const securityGroupId = process.env.K8S_NODE_SECURITY_GROUP
  if (!server || !imageId || !securityGroupId) {
    throw new Error('k8s node launch needs K8S_SERVER_URL, K8S_NODE_AMI_ID and K8S_NODE_SECURITY_GROUP')
  }
  return {
    server,
    imageId,
    securityGroupId,
    iamProfile: process.env.K8S_NODE_IAM_PROFILE || 'jeffi-stores-ec2-profile',
  }
}

export const POOL_LABEL = { 'jeffi.io/pool': 'basic' }
const POOL_SELECTOR = 'jeffi.io/pool=basic'

export function poolCapacity(node: any): number {
  const n = Number(node?.metadata?.labels?.['jeffi.io/pool-capacity'])
  return Number.isInteger(n) && n >= 0 ? n : POOL_NODE_CAPACITY
}

const isReady = (node: any) =>
  !!node?.status?.conditions?.some((c: any) => c.type === 'Ready' && c.status === 'True') && !node?.spec?.unschedulable

async function launchNode(
  nodeName: string,
  instanceType: string,
  labels: Record<string, string>,
  taints: string[] = [],
  tags?: Record<string, string>
) {
  const { runInstance } = await import('@/lib/shared/ec2-client')
  const cfg = nodeLaunchConfig()
  return runInstance({
    name: `jeffi-k8s-${nodeName}`,
    instanceType,
    imageId: cfg.imageId,
    securityGroupId: cfg.securityGroupId,
    iamProfile: cfg.iamProfile,
    appTag: 'jeffi-k8s',
    metadataHopLimit: 2,
    tags,
    userData: agentNodeUserData({ nodeName, labels, taints, server: cfg.server }),
  })
}

// instances are the tenant's OWN EC2s by node name (dedicated only). Pool launches report poolInstanceId
// instead — a shared node must never be terminated by a tenant teardown.
export interface PlacementResult {
  ready: boolean
  instances?: Record<string, string>
  poolInstanceId?: string
}

/** The AWS instance behind a node (spec.providerID aws:///<az>/i-…). */
export const nodeInstanceId = (node: any): string | null => node?.spec?.providerID?.match(/(i-[0-9a-f]+)$/)?.[1] ?? null

/** True for a namespace whose store runs on the shared pool (older namespaces only carry the plan). */
const onPool = (ns: any) => {
  const l = ns?.metadata?.labels ?? {}
  return l['jeffi.io/placement'] ? l['jeffi.io/placement'] === 'pool' : l['jeffi.io/plan'] === 'basic'
}

/**
 * Make sure the servers for this store exist. Own servers: `count` nodes of generation `gen`, named
 * t-{slug}[.{gen}-{i}], labelled + tainted to the store. Pool: any Ready pool-basic node with spare
 * capacity, else launch the next pool-basic-N. `known` holds instances a previous attempt launched
 * (persisted by the caller from onLaunched).
 */
export async function ensureTenantNodes(
  slug: string,
  node: ComputeSpec['node'],
  gen: number,
  known: { instances?: Record<string, string>; poolInstanceId?: string },
  onLaunched: (instanceId: string, kind: 'dedicated' | 'pool', nodeName: string) => Promise<void>
): Promise<PlacementResult> {
  if (node.placement === 'dedicated') {
    if (!node.type) throw new Error(`no server type for "${slug}"`)
    const instances = { ...known.instances }
    let ready = true
    for (let i = 0; i < node.count; i++) {
      const name = tenantNodeName(slug, gen, i)
      const n = await get('Node', name)
      if (isReady(n)) continue
      ready = false
      if (n || instances[name]) continue
      const { instanceId } = await launchNode(
        name,
        node.type,
        { 'jeffi.io/role': 'dedicated', 'jeffi.io/tenant': slug, 'jeffi.io/gen': String(gen) },
        [`jeffi.io/tenant=${slug}:NoSchedule`],
        { 'jeffi-tenant': slug }
      )
      instances[name] = instanceId
      await onLaunched(instanceId, 'dedicated', name)
    }
    return { ready, instances }
  }

  // Any node labelled jeffi.io/pool=basic hosts pool stores (incl. core while EC2 quota is tight);
  // jeffi.io/pool-capacity caps how many.
  const knownPoolInstanceId = known.poolInstanceId
  const nodes = await list('Node', undefined, POOL_SELECTOR)
  const poolTenants = (await list('Namespace', undefined, 'jeffi.io/tier=tenant')).filter(
    (n: any) => n.metadata?.name !== tenantNamespace(slug) && onPool(n)
  ).length
  const ready = nodes.filter(isReady)
  if (ready.reduce((sum, n) => sum + poolCapacity(n), 0) > poolTenants) return { ready: true }
  // A pool node is already joining — wait for it rather than launching another.
  if (nodes.length > ready.length || knownPoolInstanceId) return { ready: false, poolInstanceId: knownPoolInstanceId }
  const poolNodes = nodes.filter((n: any) => n.metadata?.labels?.['jeffi.io/role'] === 'pool-basic').length
  const name = `pool-basic-${poolNodes + 1}`
  const { instanceId } = await launchNode(name, POOL_NODE_TYPE, { 'jeffi.io/role': 'pool-basic', ...POOL_LABEL })
  await onLaunched(instanceId, 'pool', name)
  return { ready: false, poolInstanceId: instanceId }
}

/** The store's own server nodes, any generation. */
export async function tenantNodes(slug: string): Promise<any[]> {
  return (await list<any>('Node', undefined, `jeffi.io/tenant=${slug}`)).filter(n => isTenantNodeName(slug, n.metadata?.name ?? ''))
}

/** Remove the store's server nodes not in `keep` (an older generation after a resize); returns their instances. */
export async function removeTenantNodes(slug: string, keep: string[] = []): Promise<string[]> {
  const gone = (await tenantNodes(slug)).filter(n => !keep.includes(n.metadata.name))
  for (const n of gone) await remove('Node', n.metadata.name)
  if (!keep.includes(dedicatedNodeName(slug))) await remove('Node', dedicatedNodeName(slug))
  return gone.map(nodeInstanceId).filter((id): id is string => !!id)
}

const EMPTY_SINCE = 'jeffi.io/empty-since'
const POOL_RECLAIM_AFTER_MS = 60 * 60 * 1000

/**
 * Terminate pool-basic servers that have run no store for an hour, keeping at least one pool server.
 * Run from the provisioning worker tick. Returns the instances terminated.
 */
export async function reclaimEmptyPoolNodes(terminate: (id: string) => Promise<void>): Promise<string[]> {
  const nodes = (await list<any>('Node', undefined, POOL_SELECTOR)).filter(isReady)
  if (nodes.length <= 1) return []
  const busy = new Set((await listAll<any>('Pod', 'jeffi.io/tenant')).map(p => p.spec?.nodeName).filter(Boolean))
  const { describeInstanceName } = await import('@/lib/shared/ec2-client')
  const out: string[] = []
  let left = nodes.length
  for (const n of nodes) {
    const name: string = n.metadata?.name ?? ''
    if (n.metadata?.labels?.['jeffi.io/role'] !== 'pool-basic' || !/^pool-basic-\d+$/.test(name)) continue
    const since = n.metadata?.annotations?.[EMPTY_SINCE]
    if (busy.has(name)) {
      if (since) await patchMerge('Node', name, undefined, { metadata: { annotations: { [EMPTY_SINCE]: null } } })
      continue
    }
    if (!since) {
      await patchMerge('Node', name, undefined, { metadata: { annotations: { [EMPTY_SINCE]: new Date().toISOString() } } })
      continue
    }
    if (left <= 1 || Date.now() - Date.parse(since) < POOL_RECLAIM_AFTER_MS) continue
    const id = nodeInstanceId(n)
    // Only an instance launched as this pool node: never core or a store's server.
    if (!id || (await describeInstanceName(id)) !== `jeffi-k8s-${name}`) continue
    await remove('Node', name)
    await terminate(id)
    out.push(id)
    left--
  }
  return out
}

/** Copy platform-provided Secrets/ConfigMaps a tenant namespace needs (pull secret, RDS CA). */
async function seedNamespace(ns: string) {
  const regcred = await get<any>('Secret', 'regcred', PLATFORM_NS)
  if (regcred) {
    await apply({
      apiVersion: 'v1',
      kind: 'Secret',
      metadata: { name: 'regcred', namespace: ns },
      type: regcred.type,
      data: regcred.data,
    } as K8sObject)
  }
  const rdsCa = await get<any>('ConfigMap', 'rds-ca', PLATFORM_NS)
  if (rdsCa)
    await apply({ apiVersion: 'v1', kind: 'ConfigMap', metadata: { name: 'rds-ca', namespace: ns }, data: rdsCa.data })
  if (!(await get('Secret', 'redis', ns))) {
    await apply({
      apiVersion: 'v1',
      kind: 'Secret',
      metadata: { name: 'redis', namespace: ns },
      stringData: { password: crypto.randomBytes(24).toString('hex') },
    } as K8sObject)
  }
}

/** The images tenants run, per service: platform/release ConfigMap (set by rollout.sh). */
export async function releaseImages(): Promise<Partial<Record<TenantService, string>>> {
  const cm = await get<any>('ConfigMap', 'release', PLATFORM_NS).catch(() => null)
  const d = cm?.data ?? {}
  const pick = (v?: string) => (v && !v.endsWith(':set-by-rollout') ? v : undefined)
  return { controller: pick(d.controller), messaging: pick(d.messaging), documents: pick(d.documents) }
}

/** Apply (create or reconcile) the tenant's whole namespace. Safe to call on plan change. */
export async function applyTenantWorkload(input: TenantWorkloadInput): Promise<void> {
  const objs = renderTenantWorkload({ ...input, images: { ...(await releaseImages()), ...input.images } })
  const [nsObj, ...rest] = objs
  await apply(nsObj)
  await seedNamespace(tenantNamespace(input.slug))
  for (const o of rest) await apply(o)
  // Downgrades drop the HPA/PDBs the new tier no longer renders.
  const ns = tenantNamespace(input.slug)
  const rendered = new Set(rest.map(o => `${o.kind}/${o.metadata.name}`))
  for (const kind of ['HorizontalPodAutoscaler', 'PodDisruptionBudget']) {
    for (const name of tenantWorkloadNames(input.slug)) {
      if (!rendered.has(`${kind}/${name}`)) await remove(kind, name, ns)
    }
  }
  await retireLegacyApp(input.slug)
}

/** Drop the earlier store Deployments and the `storefront` Service/route once the controller serves. Idempotent. */
async function retireLegacyApp(slug: string): Promise<void> {
  const ns = tenantNamespace(slug)
  const d = await get<any>('Deployment', tenantAppName(slug), ns)
  if ((d?.status?.readyReplicas ?? 0) < 1) return
  for (const name of legacyAppNames(slug)) {
    if (!(await get('Deployment', name, ns))) continue
    for (const kind of ['HorizontalPodAutoscaler', 'PodDisruptionBudget', 'Deployment']) await remove(kind, name, ns)
  }
  await remove('IngressRoute', 'storefront', ns)
  await remove('Service', 'storefront', ns)
}

/** The store's controller Deployment (or an earlier name until migrated). */
async function appDeployment(slug: string): Promise<any> {
  const ns = tenantNamespace(slug)
  for (const name of [tenantAppName(slug), ...legacyAppNames(slug)]) {
    const d = await get<any>('Deployment', name, ns)
    if (d) return d
  }
  return null
}

const workloads = (slug: string) =>
  Promise.all(tenantWorkloadNames(slug).map(n => get<any>('Deployment', n, tenantNamespace(slug))))

/** True once the store's controller, messaging and document Deployments each have a ready replica. */
export async function tenantWorkloadReady(slug: string): Promise<boolean> {
  const ready = (await workloads(slug)).every(d => (d?.status?.readyReplicas ?? 0) > 0)
  if (ready) await retireLegacyApp(slug).catch(() => {})
  return ready
}

/** Rolled out: every replica of every store Deployment is on the current template and ready. */
export async function tenantRolloutComplete(slug: string): Promise<boolean> {
  return (await workloads(slug)).every(d => {
    if (!d) return false
    const want = d.spec?.replicas ?? 1
    const s = d.status ?? {}
    return (
      (s.observedGeneration ?? 0) >= (d.metadata?.generation ?? 0) &&
      (s.updatedReplicas ?? 0) >= want &&
      (s.readyReplicas ?? 0) >= want &&
      (s.replicas ?? 0) === (s.updatedReplicas ?? 0)
    )
  })
}

/**
 * Terminate a tenant's OWN node instance (t-{slug}[.{gen}-{i}], or a legacy dedicated box). Anything else — the
 * core node, a shared pool node — is refused, so a tenant teardown can never take the cluster down.
 */
export async function terminateTenantInstance(
  slug: string,
  instanceId: string,
  terminate: (id: string) => Promise<void>
): Promise<'terminated' | 'gone' | 'refused'> {
  const { describeInstanceName } = await import('@/lib/shared/ec2-client')
  const name = await describeInstanceName(instanceId)
  if (name === null) return 'gone'
  const own = name.startsWith('jeffi-k8s-') && isTenantNodeName(slug, name.slice('jeffi-k8s-'.length))
  if (!own && name !== `jeffi-tenant-${slug}`) return 'refused'
  await terminate(instanceId)
  return 'terminated'
}

/** Delete the namespace (everything in it) and the store's server nodes. Returns those nodes' instances, which the caller terminates. */
export async function deleteTenantWorkload(slug: string): Promise<string[]> {
  await remove('Namespace', tenantNamespace(slug))
  return removeTenantNodes(slug)
}

export interface TenantWorkloadStatus {
  namespace: string
  image: string | null
  desired: number
  ready: number
  pods: {
    name: string
    phase: string
    ready: boolean
    restarts: number
    node: string | null
    startedAt: string | null
  }[]
}

/** Live namespace status for the admin infrastructure tab; null when the namespace is absent. */
export async function getTenantWorkloadStatus(slug: string): Promise<TenantWorkloadStatus | null> {
  const ns = tenantNamespace(slug)
  const d = await appDeployment(slug)
  if (!d) return null
  const pods = await list<any>('Pod', ns, `jeffi.io/tenant=${slug}`)
  return {
    namespace: ns,
    image: d.spec?.template?.spec?.containers?.[0]?.image ?? null,
    desired: d.spec?.replicas ?? 0,
    ready: d.status?.readyReplicas ?? 0,
    pods: pods.map(p => {
      const cs = p.status?.containerStatuses?.[0]
      return {
        name: p.metadata.name,
        phase: p.status?.phase ?? 'Unknown',
        ready: !!cs?.ready,
        restarts: cs?.restartCount ?? 0,
        node: p.spec?.nodeName ?? null,
        startedAt: p.status?.startTime ?? null,
      }
    }),
  }
}
