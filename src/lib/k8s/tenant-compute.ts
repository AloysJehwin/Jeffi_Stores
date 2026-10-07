import 'server-only'
import crypto from 'node:crypto'
import { apply, get, list, remove, type K8sObject } from './client'
import { renderTenantWorkload, type TenantWorkloadInput } from './tenant-workload'
import { agentNodeUserData } from './node-user-data'
import {
  computeTierFor,
  dedicatedNodeName,
  POOL_NODE_CAPACITY,
  POOL_NODE_TYPE,
  tenantNamespace,
} from '@/lib/provisioning/tiers'

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

const isReady = (node: any) =>
  !!node?.status?.conditions?.some((c: any) => c.type === 'Ready' && c.status === 'True') && !node?.spec?.unschedulable

async function launchNode(
  nodeName: string,
  instanceType: string,
  labels: Record<string, string>,
  taints: string[] = []
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
    userData: agentNodeUserData({ nodeName, labels, taints, server: cfg.server }),
  })
}

// instanceId is the tenant's OWN EC2 (dedicated only). Pool launches report poolInstanceId instead —
// a shared node must never be terminated by a tenant teardown.
export interface PlacementResult {
  ready: boolean
  instanceId?: string
  poolInstanceId?: string
}

/**
 * Make sure a node exists for this tenant's tier. Dedicated: its own node t-{slug}. Pool: any
 * Ready pool-basic node with spare capacity, else launch the next pool-basic-N.
 * `known` holds instances a previous attempt launched (persisted by the caller).
 */
export async function ensureTenantNode(
  slug: string,
  plan: string | null,
  known: { instanceId?: string; poolInstanceId?: string },
  onLaunched: (instanceId: string, kind: 'dedicated' | 'pool') => Promise<void>
): Promise<PlacementResult> {
  const knownInstanceId = known.instanceId
  const knownPoolInstanceId = known.poolInstanceId
  const tier = computeTierFor(plan)
  if (tier.placement === 'dedicated') {
    const name = dedicatedNodeName(slug)
    const node = await get('Node', name)
    if (isReady(node)) return { ready: true, instanceId: knownInstanceId }
    if (!node && !knownInstanceId) {
      const { instanceId } = await launchNode(
        name,
        tier.nodeType,
        { 'jeffi.io/role': 'dedicated', 'jeffi.io/tenant': slug },
        [`jeffi.io/tenant=${slug}:NoSchedule`]
      )
      await onLaunched(instanceId, 'dedicated')
      return { ready: false, instanceId }
    }
    return { ready: false, instanceId: knownInstanceId }
  }

  const nodes = await list('Node', undefined, 'jeffi.io/role=pool-basic')
  const basicTenants = (await list('Namespace', undefined, 'jeffi.io/tier=tenant,jeffi.io/plan=basic')).filter(
    (n: any) => n.metadata?.name !== tenantNamespace(slug)
  ).length
  const readyNodes = nodes.filter(isReady).length
  if (readyNodes * POOL_NODE_CAPACITY > basicTenants) return { ready: true }
  // A pool node is already joining — wait for it rather than launching another.
  if (nodes.length > readyNodes || knownPoolInstanceId) return { ready: false, poolInstanceId: knownPoolInstanceId }
  const name = `pool-basic-${nodes.length + 1}`
  const { instanceId } = await launchNode(name, POOL_NODE_TYPE, { 'jeffi.io/role': 'pool-basic' })
  await onLaunched(instanceId, 'pool')
  return { ready: false, poolInstanceId: instanceId }
}

/** Copy platform-provided Secrets/ConfigMaps a tenant namespace needs (pull secret, RDS CA). */
async function seedNamespace(ns: string) {
  const ghcr = await get<any>('Secret', 'ghcr', PLATFORM_NS)
  if (ghcr) {
    await apply({
      apiVersion: 'v1',
      kind: 'Secret',
      metadata: { name: 'ghcr', namespace: ns },
      type: ghcr.type,
      data: ghcr.data,
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

/** The image every tenant should run: platform/release ConfigMap (set by CI), else :latest. */
export async function releaseImage(): Promise<string | undefined> {
  const cm = await get<any>('ConfigMap', 'release', PLATFORM_NS).catch(() => null)
  return cm?.data?.image || undefined
}

/** Apply (create or reconcile) the tenant's whole namespace. Safe to call on plan change. */
export async function applyTenantWorkload(input: TenantWorkloadInput): Promise<void> {
  const objs = renderTenantWorkload({ ...input, image: input.image || (await releaseImage()) })
  const [nsObj, ...rest] = objs
  await apply(nsObj)
  await seedNamespace(tenantNamespace(input.slug))
  for (const o of rest) await apply(o)
  // Downgrades drop the HPA/PDB the new tier no longer renders.
  const kinds = new Set(rest.map(o => o.kind))
  const ns = tenantNamespace(input.slug)
  if (!kinds.has('HorizontalPodAutoscaler')) await remove('HorizontalPodAutoscaler', 'storefront', ns)
  if (!kinds.has('PodDisruptionBudget')) await remove('PodDisruptionBudget', 'storefront', ns)
}

/** True once the storefront Deployment has at least one ready replica. */
export async function tenantWorkloadReady(slug: string): Promise<boolean> {
  const d = await get<any>('Deployment', 'storefront', tenantNamespace(slug))
  return (d?.status?.readyReplicas ?? 0) > 0
}

/** Delete the namespace (everything in it). The caller terminates a dedicated EC2 separately. */
export async function deleteTenantWorkload(slug: string): Promise<void> {
  await remove('Namespace', tenantNamespace(slug))
  await remove('Node', dedicatedNodeName(slug))
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
  const d = await get<any>('Deployment', 'storefront', ns)
  if (!d) return null
  const pods = await list<any>('Pod', ns, `app=storefront,jeffi.io/tenant=${slug}`)
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
