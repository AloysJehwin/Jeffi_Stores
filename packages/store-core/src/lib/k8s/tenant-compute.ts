import 'server-only'
import crypto from 'node:crypto'
import { apply, get, list, listAll, patchMerge, remove, type K8sObject } from './client'
import {
  renderTenantWorkload,
  tenantAppName,
  tenantRoleName,
  tenantWorkloadNames,
  tenantPartName,
  TENANT_ROUTE_NAMES,
  STORE_PARTS,
  legacyAppNames,
  type StorePart,
  type TenantService,
  type TenantWorkloadInput,
} from './tenant-workload'
import { agentNodeUserData, DB_READY_LABEL } from './node-user-data'
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
    // Store and pool servers get the tenant-node profile (no access to other stores' database secrets);
    // the core's profile only until K8S_TENANT_NODE_IAM_PROFILE is set (service-secrets-iam.sh).
    iamProfile: process.env.K8S_TENANT_NODE_IAM_PROFILE || process.env.K8S_NODE_IAM_PROFILE || 'jeffi-stores-ec2-profile',
  }
}

export const POOL_LABEL = { 'jeffi.io/pool': 'basic' }
const POOL_SELECTOR = 'jeffi.io/pool=basic'

export function poolCapacity(node: any): number {
  const n = Number(node?.metadata?.labels?.['jeffi.io/pool-capacity'])
  // A label from when stores ran one app can only lower the count, never overbook the server.
  return Number.isInteger(n) && n >= 0 ? Math.min(n, POOL_NODE_CAPACITY) : POOL_NODE_CAPACITY
}

export const isReady = (node: any) =>
  !!node?.status?.conditions?.some((c: any) => c.type === 'Ready' && c.status === 'True') && !node?.spec?.unschedulable

// A store's on-node Postgres lives on its tagged, encrypted gp3 data volume (ec2-client DB_VOLUME_TAGS),
// which outlives its servers. It is created in the AZ of the store's first server once that runs, attached
// at /dev/sdf, and mounted by the server's db agent (node-user-data.ts), which then labels the node
// jeffi.io/db-ready=true: the Postgres pod's nodeSelector, so it only ever starts on the mounted disk.
// A later server of the store is launched in the volume's AZ; handOffNodeDb moves the volume to it.
export { DB_READY_LABEL }
export const DB_AGENT_LABEL = 'jeffi.io/db-agent'
const DB_DEVICE_NAME = '/dev/sdf'

async function launchNode(
  nodeName: string,
  instanceType: string,
  labels: Record<string, string>,
  taints: string[] = [],
  tags?: Record<string, string>,
  opts: { dbAgent?: boolean; availabilityZone?: string } = {}
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
    userData: agentNodeUserData({ nodeName, labels, taints, server: cfg.server, dbAgent: opts.dbAgent }),
    ...(opts.availabilityZone ? { availabilityZone: opts.availabilityZone } : {}),
  })
}

/** A store server's instance: by the id a launch recorded, else by its Name tag. */
async function serverInstance(nodeName: string, instanceId?: string) {
  const ec2 = await import('@/lib/shared/ec2-client')
  if (!instanceId) return ec2.findInstanceByName(`jeffi-k8s-${nodeName}`)
  try {
    const d = await ec2.describeInstance(instanceId)
    return d.state ? { instanceId, state: d.state, availabilityZone: d.availabilityZone ?? '' } : null
  } catch (e) {
    if (ec2.isInstanceNotFound(e)) return null
    throw e
  }
}

/**
 * The store's database volume on its server `nodeName`: created in that server's AZ when the store has
 * none, attached when it is free. A volume still on another server is left to handOffNodeDb.
 */
export async function ensureNodeDbVolume(
  slug: string,
  nodeName: string,
  sizeGb: number,
  instanceId?: string
): Promise<{ attached: boolean; detail: string }> {
  const ec2 = await import('@/lib/shared/ec2-client')
  const inst = await serverInstance(nodeName, instanceId)
  if (!inst || inst.state !== 'running') return { attached: false, detail: `waiting for ${nodeName} to run` }
  const vol = await ec2.describeTenantDbVolume(slug)
  if (!vol) {
    const id = await ec2.createTenantDbVolume({ slug, availabilityZone: inst.availabilityZone, sizeGb })
    return { attached: false, detail: `created the database volume ${id}` }
  }
  if (vol.attachedInstanceId === inst.instanceId) return { attached: vol.attachmentState === 'attached', detail: 'attaching the database volume' }
  if (vol.attachedInstanceId) return { attached: false, detail: `the database volume is on ${vol.attachedInstanceId}` }
  if (vol.availabilityZone !== inst.availabilityZone) {
    throw new Error(`database volume ${vol.volumeId} is in ${vol.availabilityZone}, server ${nodeName} in ${inst.availabilityZone}`)
  }
  if (vol.state !== 'available') return { attached: false, detail: `the database volume is ${vol.state}` }
  await ec2.attachVolume(vol.volumeId, inst.instanceId, DB_DEVICE_NAME)
  return { attached: false, detail: 'attaching the database volume' }
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
export const onPool = (ns: any) => {
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
  onLaunched: (instanceId: string, kind: 'dedicated' | 'pool', nodeName: string) => Promise<void>,
  opts?: { dbVolume?: { sizeGb: number } }
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
      // The first server takes the database volume, so it goes where the volume is.
      const vol = i === 0 ? await (await import('@/lib/shared/ec2-client')).describeTenantDbVolume(slug) : null
      const { instanceId } = await launchNode(
        name,
        node.type,
        { 'jeffi.io/role': 'dedicated', 'jeffi.io/tenant': slug, 'jeffi.io/gen': String(gen), [DB_AGENT_LABEL]: 'true' },
        [`jeffi.io/tenant=${slug}:NoSchedule`],
        { 'jeffi-tenant': slug },
        { dbAgent: true, availabilityZone: vol?.availabilityZone }
      )
      instances[name] = instanceId
      await onLaunched(instanceId, 'dedicated', name)
    }
    // An on-node database: its volume on the first server (created, or re-attached once free) before the
    // servers count as ready. Callers pass dbVolume only while the store runs its database on-node.
    if (opts?.dbVolume) {
      const first = tenantNodeName(slug, gen, 0)
      const vol = await ensureNodeDbVolume(slug, first, opts.dbVolume.sizeGb, instances[first])
      if (!vol.attached) ready = false
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

/** The instances of the store's own server nodes, and whether every one is Ready. */
export async function tenantNodeInstances(slug: string): Promise<{ instances: string[]; ready: boolean }> {
  const nodes = await tenantNodes(slug)
  return { instances: nodes.map(nodeInstanceId).filter((id): id is string => !!id), ready: nodes.every(isReady) }
}

/** Scale every Deployment in the store's namespace to 0 (a paused store); applyTenantWorkload brings them back. */
export async function scaleTenantWorkloadToZero(slug: string): Promise<void> {
  const ns = tenantNamespace(slug)
  for (const d of await list<any>('Deployment', ns)) await patchMerge('Deployment', d.metadata.name, ns, { spec: { replicas: 0 } })
}

/** Remove the store's server nodes not in `keep` (an older generation after a resize); returns their instances. */
export async function removeTenantNodes(slug: string, keep: string[] = []): Promise<string[]> {
  const gone = (await tenantNodes(slug)).filter(n => !keep.includes(n.metadata.name))
  const ids: string[] = []
  for (const n of gone) {
    // k3s registers nodes as k3s://<name>, so most carry no instance id: find it by the Name tag.
    const id =
      nodeInstanceId(n) ??
      (await serverInstance(n.metadata.name).then(
        i => i?.instanceId ?? null,
        e => (console.error(`[tenant-compute] instance of ${n.metadata.name}: ${e?.message}`), null)
      ))
    if (id) ids.push(id)
    await remove('Node', n.metadata.name)
  }
  if (!keep.includes(dedicatedNodeName(slug))) await remove('Node', dedicatedNodeName(slug))
  return ids
}

/** The store's newest-generation first server runs the db agent (servers launched before it don't). */
export async function nodeCanHostDb(slug: string, gen: number): Promise<boolean> {
  const n = await get<any>('Node', tenantNodeName(slug, gen, 0))
  return n?.metadata?.labels?.[DB_AGENT_LABEL] === 'true'
}

async function scalePostgres(slug: string, replicas: number): Promise<void> {
  const ns = tenantNamespace(slug)
  const d = await get<any>('Deployment', postgresName(slug), ns)
  if (d && (d.spec?.replicas ?? 1) !== replicas) await patchMerge('Deployment', postgresName(slug), ns, { spec: { replicas } })
}

/** Take jeffi.io/db-ready off the store's servers other than `except`, so Postgres cannot start there. */
async function unlabelDbNodes(slug: string, except?: string): Promise<void> {
  for (const n of await tenantNodes(slug)) {
    if (n.metadata.name === except || !n.metadata?.labels?.[DB_READY_LABEL]) continue
    await patchMerge('Node', n.metadata.name, undefined, { metadata: { labels: { [DB_READY_LABEL]: null } } })
  }
}

/**
 * Move the store's database volume onto its server `nodeName` (the first of a new generation), one step per
 * call: Postgres stops; the old server holding the volume is terminated (its shutdown unmounts the disk
 * cleanly; it is about to go anyway) or, when it is not one of the store's servers, the volume is detached;
 * the volume attaches to the new server, whose db agent mounts it and labels the node; Postgres starts.
 * Returns 'done', or what it is waiting for. The store's database is down from the stop to the start.
 */
export async function handOffNodeDb(slug: string, nodeName: string, terminate: (id: string) => Promise<void>): Promise<string> {
  const ec2 = await import('@/lib/shared/ec2-client')
  const vol = await ec2.describeTenantDbVolume(slug)
  if (!vol) throw new Error(`${slug} has no database volume to move`)
  const inst = await serverInstance(nodeName)
  if (!inst || inst.state !== 'running') return `waiting for ${nodeName} to run`
  if (vol.attachedInstanceId !== inst.instanceId) {
    await unlabelDbNodes(slug, nodeName)
    await scalePostgres(slug, 0)
    if ((await postgresPods(slug)).length) return 'stopping the database'
    if (vol.attachedInstanceId) {
      const r = await terminateTenantInstance(slug, vol.attachedInstanceId, terminate)
      if (r === 'refused') await ec2.detachVolume(vol.volumeId)
      return 'releasing the database volume'
    }
    if (vol.state !== 'available') return `the database volume is ${vol.state}`
    if (vol.availabilityZone !== inst.availabilityZone) {
      throw new Error(`database volume ${vol.volumeId} is in ${vol.availabilityZone}, server ${nodeName} in ${inst.availabilityZone}`)
    }
    await ec2.attachVolume(vol.volumeId, inst.instanceId, DB_DEVICE_NAME)
    return 'attaching the database volume'
  }
  if (vol.attachmentState !== 'attached') return 'attaching the database volume'
  if ((await get<any>('Node', nodeName))?.metadata?.labels?.[DB_READY_LABEL] !== 'true') return `waiting for ${nodeName} to mount the database volume`
  await scalePostgres(slug, 1)
  return (await postgresPodReady(slug)) ? 'done' : 'starting the database'
}

/** Grow the store's database volume to `sizeGb` (never shrinks); its server's db agent grows the filesystem. */
export async function growNodeDbVolume(slug: string, sizeGb: number): Promise<void> {
  const ec2 = await import('@/lib/shared/ec2-client')
  const vol = await ec2.describeTenantDbVolume(slug)
  if (!vol) throw new Error(`${slug} has no database volume to grow`)
  if (vol.sizeGb < sizeGb) await ec2.modifyVolumeSize(vol.volumeId, sizeGb)
}

/**
 * Retire an on-node database the store has moved off, one step per call: its Postgres objects go, the
 * volume is snapshotted (kept) and, once the snapshot completes, detached and deleted. `st` carries the
 * snapshot id between calls. Returns true when nothing is left.
 */
export async function retireNodeDb(slug: string, st: { snapshotId?: string }): Promise<boolean> {
  const ns = tenantNamespace(slug)
  for (const kind of ['Deployment', 'Service', 'Secret']) await remove(kind, postgresName(slug), ns)
  await unlabelDbNodes(slug)
  const ec2 = await import('@/lib/shared/ec2-client')
  const vol = await ec2.describeTenantDbVolume(slug)
  if (!vol) return true
  if ((await postgresPods(slug)).length) return false
  st.snapshotId ??= await ec2.snapshotVolume(vol.volumeId, slug, `retired database of ${slug}`)
  const snap = await ec2.describeSnapshotState(st.snapshotId)
  if (snap === 'error') throw new Error(`snapshot ${st.snapshotId} of ${vol.volumeId} failed`)
  if (snap !== 'completed') return false
  if (vol.attachedInstanceId) {
    await ec2.detachVolume(vol.volumeId, { force: true })
    return false
  }
  if (vol.state !== 'available') return false
  await ec2.deleteVolume(vol.volumeId, { waitMs: 0 })
  return true
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
  const keys = ['controller', 'storefront', 'admin', 'business', 'messaging', 'documents'] as const
  return Object.fromEntries(keys.map(k => [k, pick(d[k])])) as Partial<Record<TenantService, string>>
}

const PART_KINDS = new Set(['Deployment', 'Service', 'HorizontalPodAutoscaler', 'PodDisruptionBudget'])

/**
 * Apply (create or reconcile) the tenant's whole namespace. Safe to call on plan change.
 * `keepApps` leaves the app pods this render no longer has running (a layout switch drains them first).
 * `part` applies one slice, as a release rolls each service on its own: 'shared' is everything but the store
 * services' own objects; a service is just its Deployment, Service, HPA and PDB. Returns whether the render
 * has any Deployment in that slice (a store whose plan has no business pods has none for 'business').
 */
export async function applyTenantWorkload(
  input: TenantWorkloadInput,
  opts: { keepApps?: boolean; part?: 'shared' | StorePart } = {}
): Promise<boolean> {
  const ns = tenantNamespace(input.slug)
  const app = tenantAppName(input.slug)
  // The release's controller is control plane only: the old all-in-one app keeps the image it runs until
  // its store switches to its own services, and can't be started anew.
  const running = (await get<any>('Deployment', app, ns))?.spec?.template?.spec?.containers?.[0]?.image as string | undefined
  const objs = renderTenantWorkload({
    ...input,
    images: { ...(await releaseImages()), ...(running && { controller: running }), ...input.images },
    storeSecret: input.storeSecret ?? process.env.STORE_SECRET_ID,
  })
  if (!running && !input.images?.controller && objs.some(o => o.kind === 'Deployment' && o.metadata.name === app))
    throw new Error(`${input.slug} runs no all-in-one app to keep; it can only run its own services`)
  const [nsObj, ...rest] = objs
  const { part } = opts
  const partOf = (o: K8sObject) => (PART_KINDS.has(o.kind) ? STORE_PARTS.find(p => o.metadata.name === tenantPartName(input.slug, p)) : undefined)
  const mine = part ? rest.filter(o => (part === 'shared' ? !partOf(o) : partOf(o) === part)) : rest
  if (!part || part === 'shared') {
    await apply(nsObj)
    await seedNamespace(ns)
  }
  for (const o of mine) await apply(o)
  // Drop what this render no longer has: HPA/PDBs a smaller size doesn't need, and the app pods and
  // routes of the layout the store has just left (only once traffic is on the new one, see reconcileLayout).
  const rendered = new Set(rest.map(o => `${o.kind}/${o.metadata.name}`))
  const names = !part ? tenantWorkloadNames(input.slug) : part === 'shared' ? [app] : [tenantPartName(input.slug, part)]
  for (const kind of opts.keepApps ? ['HorizontalPodAutoscaler', 'PodDisruptionBudget'] : ['HorizontalPodAutoscaler', 'PodDisruptionBudget', 'Deployment', 'Service']) {
    for (const name of names) {
      if (!rendered.has(`${kind}/${name}`)) await remove(kind, name, ns)
    }
  }
  if (!part || part === 'shared') {
    for (const name of TENANT_ROUTE_NAMES) if (!rendered.has(`IngressRoute/${name}`)) await remove('IngressRoute', name, ns)
    await pruneCustomDomains(ns, rendered)
    await retireLegacyApp(input.slug)
  }
  return mine.some(o => o.kind === 'Deployment')
}

/** Drop the route, certificate and TLS secret of every custom domain the store no longer has. */
async function pruneCustomDomains(ns: string, rendered: Set<string>): Promise<void> {
  const owned = (o: any) => o?.metadata?.name?.startsWith('custom-')
  for (const kind of ['IngressRoute', 'Certificate']) {
    for (const o of (await list<any>(kind, ns).catch(() => [])) ?? []) {
      const name = o.metadata.name as string
      if (!owned(o) || rendered.has(`${kind}/${name}`)) continue
      await remove(kind, name, ns)
      if (kind === 'Certificate' && o.spec?.secretName) await remove('Secret', o.spec.secretName, ns)
    }
  }
}

/** Restart every store pod (they keep a database pool open, e.g. to a database that has just moved). */
export async function restartTenantWorkload(slug: string): Promise<void> {
  const at = new Date().toISOString()
  for (const d of (await workloads(slug)).filter(d => !isPostgres(d))) {
    await patchMerge('Deployment', d.metadata.name, tenantNamespace(slug), {
      spec: { template: { metadata: { annotations: { 'kubectl.kubernetes.io/restartedAt': at } } } },
    })
  }
}

/** Drop the earlier store Deployments and the `storefront` Service/route once the controller serves. Idempotent. */
async function retireLegacyApp(slug: string): Promise<void> {
  const ns = tenantNamespace(slug)
  const d = (await get<any>('Deployment', tenantAppName(slug), ns)) ?? (await get<any>('Deployment', tenantRoleName(slug, 'storefront'), ns))
  if ((d?.status?.readyReplicas ?? 0) < 1) return
  for (const name of legacyAppNames(slug)) {
    if (!(await get('Deployment', name, ns))) continue
    for (const kind of ['HorizontalPodAutoscaler', 'PodDisruptionBudget', 'Deployment']) await remove(kind, name, ns)
  }
  await remove('IngressRoute', 'storefront', ns)
  await remove('Service', 'storefront', ns)
}

/** The store's main app Deployment: its storefront, the old all-in-one app, or an earlier name. */
async function appDeployment(slug: string): Promise<any> {
  const ns = tenantNamespace(slug)
  for (const name of [tenantRoleName(slug, 'storefront'), tenantAppName(slug), ...legacyAppNames(slug)]) {
    const d = await get<any>('Deployment', name, ns)
    if (d) return d
  }
  return null
}

/** The store's own Deployments (redis aside), in whichever layout it runs. */
const workloads = (slug: string) => list<any>('Deployment', tenantNamespace(slug), 'jeffi.io/service')
export const isPostgres = (d: any) => d?.metadata?.labels?.['jeffi.io/service'] === 'postgres'

/** True once the store's app, messaging and document Deployments each have a ready replica. */
export async function tenantWorkloadReady(slug: string): Promise<boolean> {
  const ds = await workloads(slug)
  const ready = ds.length >= 3 && ds.every(d => (d?.status?.readyReplicas ?? 0) > 0)
  if (ready) await retireLegacyApp(slug).catch(() => {})
  return ready
}

const postgresName = (slug: string) => `${slug}-postgres`
const postgresPods = (slug: string) => list<any>('Pod', tenantNamespace(slug), `app=${postgresName(slug)}`)

/** The store's on-node Postgres pod (labelled app={slug}-postgres) is running and Ready. */
export async function postgresPodReady(slug: string): Promise<boolean> {
  const pods = (await postgresPods(slug)).filter(p => !p.metadata?.deletionTimestamp)
  if (!pods.length) return false
  return pods.every(p => p.status?.phase === 'Running' && (p.status?.containerStatuses ?? []).length > 0 && p.status.containerStatuses.every((c: any) => c.ready))
}

/**
 * Rolled out: every replica of every store Deployment is on the current template and ready. The on-node
 * Postgres is not counted: it stays on the server with its disk while the app pods move (handOffNodeDb).
 */
export async function tenantRolloutComplete(slug: string): Promise<boolean> {
  const ds = (await workloads(slug)).filter(d => !isPostgres(d))
  return ds.length >= 3 && ds.every(d => {
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
