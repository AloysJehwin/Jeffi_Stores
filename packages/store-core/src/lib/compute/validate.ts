import { BASIC_DB_CLASSES, DB_POOL_CAP, DB_POOL_MIN, DB_RESERVED_CONNECTIONS, NODE_DB_RESOURCES, POD_RESOURCES, PRESETS, REDIS_RESOURCES, dbMaxConnections, nodeDbMaxConnections, presetOf, presetSpec, specKey, withHighAvailability } from './presets'
import { POD_SIZES, SERVICE_NAMES, activeServices, ec2Code, priceOf, rdsCode, type Catalog, type ComputeSpec, type PlanCompute, type PresetKey, type ServiceName, type ServiceSpec } from './spec'

// Numeric floor rank — Basic is 0, each dedicated tier is one step up. Shared is intentionally
// outside this scale (it is gated by minPlacement, not minPreset).
export const PRESET_RANK: Record<Exclude<PresetKey, 'shared'>, number> = {
  basic: 0,
  small: 1,
  medium: 2,
  large: 3,
  xlarge: 4,
}

// Servers and databases rank by memory: small..xlarge need at least these MiB; the last tier is the bigger types above xlarge.
const NODE_TIER_MIB = [2048, 4096, 8192, 16384, 32768]
const DB_TIER_MIB = [1024, 2048, 4096, 8192, 16384]
// Memory of the sellable types, for callers without a catalog.
const KNOWN_MIB: Record<string, number> = {
  't4g.small': 2048, 't4g.medium': 4096, 't4g.large': 8192, 't4g.xlarge': 16384, 't4g.2xlarge': 32768,
  'm7g.large': 8192, 'm7g.xlarge': 16384, 'm7g.2xlarge': 32768, 'r7g.large': 16384, 'r7g.xlarge': 32768,
  'c7g.large': 4096, 'c7g.xlarge': 8192,
  'db.t4g.micro': 1024, 'db.t4g.small': 2048, 'db.t4g.medium': 4096, 'db.t4g.large': 8192, 'db.t4g.xlarge': 16384,
  'db.m7g.large': 8192, 'db.r7g.large': 16384, 'db.r7g.xlarge': 32768,
}
const memOf = (catalog: Catalog | null | undefined, code: string, name: string) => (catalog ? priceOf(catalog, code)?.memoryMib : null) ?? KNOWN_MIB[name] ?? 0
const tierOf = (mib: number, tiers: number[]) => tiers.filter(t => mib >= t).length

/** 1 (small) to 4 (xlarge), 5 above it, for a server type; 0 when it is smaller than small or unknown. */
export const nodeTier = (type: string | null, catalog?: Catalog | null) => tierOf(memOf(catalog, ec2Code(type ?? ''), type ?? ''), NODE_TIER_MIB)

/** The preset-rank the spec is at least as big as. A node-DB spec ranks by its server tier (the DB
 * rides on the node, so the node size sets the floor); a dedicated-RDS spec takes the smaller of its
 * node and db tiers (both must clear a floor to count). */
export function rankOfSpec(spec: ComputeSpec, catalog?: Catalog | null): number {
  const nodeRank = nodeTier(spec.node.type, catalog)
  if (spec.db.mode === 'node') return nodeRank
  const dbRank = tierOf(memOf(catalog, rdsCode(spec.db.class ?? ''), spec.db.class ?? ''), DB_TIER_MIB)
  return Math.min(nodeRank, dbRank)
}

export const LIMITS = { maxNodes: 3, maxReplicas: 10, minStorageGb: 20, maxStorageGb: 1000 }

// Kept on every node for the k3s agent and the system.
const NODE_RESERVED_MIB = 450
const NODE_RESERVED_MILLI = 100

export interface Fit {
  cpu: { requestedMilli: number; allocatableMilli: number }
  memory: { requestedMib: number; allocatableMib: number }
  db: { pods: number; maxConnections: number; poolPerPod: number }
  vcpus: number
}

export interface Validation {
  ok: boolean
  errors: string[]
  fit: Fit | null
}

export const milli = (cpu: string) => (cpu.endsWith('m') ? Number(cpu.slice(0, -1)) : Number(cpu) * 1000)
export const mib = (mem: string) => (mem.endsWith('Gi') ? Number(mem.slice(0, -2)) * 1024 : Number(mem.replace(/Mi$/, '')))

/** On a rollout the storefront, and any service with spare copies, adds one pod; a single-copy back-office
 * service restarts in place instead (tenant-workload.ts), so small servers need no room for it. */
export const surges = (k: ServiceName, s: ServiceSpec) => k === 'storefront' || s.replicas > 1

// The services a plan runs; no plan: all of them (the cautious count).
const namesFor = (plan?: string | null): ServiceName[] => (plan === undefined ? [...SERVICE_NAMES] : activeServices(plan))

// The two busiest moments: every service scaled out, or a release rolling the services.
const states = (spec: ComputeSpec) => [
  (k: ServiceName) => spec.services[k].maxReplicas,
  (k: ServiceName) => spec.services[k].replicas + (surges(k, spec.services[k]) ? 1 : 0),
]

/** Most pods the store runs at once. */
export const peakPods = (spec: ComputeSpec, plan?: string | null) =>
  Math.max(...states(spec).map(count => namesFor(plan).reduce((n, k) => n + count(k), 0)))

const NODE_DB_MIB = mib(NODE_DB_RESOURCES.requests.memory)
const NODE_DB_MILLI = milli(NODE_DB_RESOURCES.requests.cpu)

/** Requests at the busiest moment, Redis and (node mode) Postgres included. */
function requested(spec: ComputeSpec, plan?: string | null) {
  const nodeDb = spec.db.mode === 'node'
  let cpu = 0
  let mem = 0
  for (const count of states(spec)) {
    let c = milli(REDIS_RESOURCES.requests.cpu) + (nodeDb ? NODE_DB_MILLI : 0)
    let m = mib(REDIS_RESOURCES.requests.memory) + (nodeDb ? NODE_DB_MIB : 0)
    for (const k of namesFor(plan)) {
      const res = POD_RESOURCES[k][spec.services[k].size].requests
      c += milli(res.cpu) * count(k)
      m += mib(res.memory) * count(k)
    }
    cpu = Math.max(cpu, c)
    mem = Math.max(mem, m)
  }
  return { cpu, mem }
}

/** Connections the store's database allows it, and the pool each pod gets. */
export function dbBudget(spec: ComputeSpec, catalog: Catalog, plan?: string | null) {
  const s = catalog.settings
  const maxConnections =
    spec.db.mode === 'shared'
      ? Math.floor((s.sharedDbMaxConnections - DB_RESERVED_CONNECTIONS) / s.sharedDbCapacity)
      : spec.db.mode === 'node'
        ? nodeDbMaxConnections(priceOf(catalog, ec2Code(spec.node.type ?? ''))?.memoryMib ?? KNOWN_MIB[spec.node.type ?? ''] ?? null) - DB_RESERVED_CONNECTIONS
        : dbMaxConnections(spec.db.class ?? '', priceOf(catalog, rdsCode(spec.db.class ?? ''))?.memoryMib ?? null) - DB_RESERVED_CONNECTIONS
  const pods = peakPods(spec, plan)
  return { pods, maxConnections, poolPerPod: Math.min(DB_POOL_CAP, Math.floor(maxConnections / pods)) }
}

export function fitOf(spec: ComputeSpec, catalog: Catalog, plan?: string | null): Fit {
  const req = requested(spec, plan)
  const node = spec.node.placement === 'dedicated' ? priceOf(catalog, ec2Code(spec.node.type ?? '')) : undefined
  const count = spec.node.placement === 'dedicated' ? spec.node.count : 1
  return {
    cpu: { requestedMilli: req.cpu, allocatableMilli: node ? ((node.vcpu ?? 0) * 1000 - NODE_RESERVED_MILLI) * count : 0 },
    memory: { requestedMib: req.mem, allocatableMib: node ? ((node.memoryMib ?? 0) - NODE_RESERVED_MIB) * count : 0 },
    db: dbBudget(spec, catalog, plan),
    vcpus: node ? (node.vcpu ?? 0) * count : 0,
  }
}

const int = (n: unknown) => typeof n === 'number' && Number.isInteger(n)

// A preset's servers and services (or Basic's), whatever its database and storage.
const isPlatformSize = (spec: ComputeSpec) =>
  Object.values(PRESETS).some(p => {
    if (p.spec.node.placement !== 'dedicated') return false
    const k = specKey({ ...spec, db: p.spec.db, storage: p.spec.storage })
    return k === specKey(p.spec) || k === specKey(withHighAvailability(p.spec))
  })

/**
 * Why the services don't fit the server(s). A preset or Basic is let through when only the on-server
 * Postgres tips it over: memory on t4g.small at a release (1720 of 1598 MiB), CPU on Large (1.96 of 1.9 vCPU).
 */
export function serverFitErrors(spec: ComputeSpec, catalog: Catalog, plan?: string | null, fit: Fit = fitOf(spec, catalog, plan)): string[] {
  if (spec.node.placement !== 'dedicated') return []
  const errors: string[] = []
  const mem = fit.memory
  const cpu = fit.cpu
  const platform = spec.db.mode === 'node' && isPlatformSize(spec)
  if (mem.requestedMib > mem.allocatableMib && !(platform && mem.requestedMib - NODE_DB_MIB <= mem.allocatableMib)) {
    errors.push(`The services need ${mem.requestedMib} MB of memory; the server has ${mem.allocatableMib} MB. Choose a bigger server or fewer copies.`)
  }
  if (cpu.requestedMilli > cpu.allocatableMilli && !(platform && cpu.requestedMilli - NODE_DB_MILLI <= cpu.allocatableMilli)) {
    errors.push(`The services need ${fit.cpu.requestedMilli / 1000} vCPU; the server has ${fit.cpu.allocatableMilli / 1000}. Choose a bigger server or fewer copies.`)
  }
  return errors
}

/** Why a spec can't be chosen on this plan at all (wrong kind of server, or custom on a presets-only plan). */
export function planCompatibilityError(spec: ComputeSpec, plan: PlanCompute, catalog?: Catalog | null): string | null {
  const preset = presetOf(spec)
  if (plan.minPlacement === 'pool') return preset === 'shared' ? null : 'This plan runs on shared servers. Choose a higher plan for your own server.'
  // db.mode 'node' is the Basic shape (Postgres on the EC2 node); 'dedicated' is RDS. Both count as the
  // plan's own database.
  if (spec.node.placement !== 'dedicated' || (spec.db.mode !== 'dedicated' && spec.db.mode !== 'node')) {
    return 'This plan includes your own server and database.'
  }
  if (!plan.advanced && preset === 'custom') return 'Choose one of the sizes; custom settings need a higher plan.'
  if (plan.minPreset) {
    if (plan.minPreset === 'basic') {
      // Basic is fixed — a dedicated single Basic node, one copy of each of its services — with Postgres on
      // the node or a small RDS. Checked structurally, not whole-spec equality: storageGb (a disk never
      // shrinks), s3 and inactive services may drift without changing what Basic runs.
      const b = presetSpec('basic')
      const sameServices = activeServices(plan.slug).every(k => {
        const x = spec.services[k]
        const y = b.services[k]
        return x?.replicas === y.replicas && x?.maxReplicas === y.maxReplicas && x?.size === y.size
      })
      if (!(spec.node.placement === 'dedicated' && spec.node.type === b.node.type && spec.node.count === 1 && sameServices)) {
        return 'Basic requires the fixed Basic configuration.'
      }
      if (spec.db.mode === 'dedicated') {
        if (!BASIC_DB_CLASSES.includes(spec.db.class ?? '')) return `Basic offers a ${BASIC_DB_CLASSES.join(' or ')} database.`
        if (spec.db.multiAz) return 'Basic has no standby database; choose a higher plan.'
        if (spec.db.storageGb < LIMITS.minStorageGb) return `A Basic database needs at least ${LIMITS.minStorageGb} GB.`
      }
    } else {
      const floor = PRESET_RANK[plan.minPreset as Exclude<PresetKey, 'shared'>] ?? 0
      if (rankOfSpec(spec, catalog) < floor) return `This server is below your plan's minimum (${plan.minPreset}).`
    }
  }
  return null
}

/**
 * Whether a spec can be chosen on this plan and actually runs: the pods fit the server, the database has
 * connections for every pod, and storage only grows. Messages are shown to the store owner.
 */
export function validateSpec(
  spec: ComputeSpec,
  catalog: Catalog,
  plan: PlanCompute,
  opts: { current?: ComputeSpec | null; anyPlan?: boolean } = {}
): Validation {
  const errors: string[] = []
  if (!spec?.node || !spec?.db || !spec?.services || SERVICE_NAMES.some(k => !spec.services[k])) {
    return { ok: false, errors: ['Incomplete compute choice.'], fit: null }
  }
  const planError = opts.anyPlan ? null : planCompatibilityError(spec, plan, catalog)
  if (planError) errors.push(planError)

  if (spec.node.placement === 'dedicated') {
    const node = priceOf(catalog, ec2Code(spec.node.type ?? ''))
    if (!node || node.kind !== 'ec2' || !node.sellable) errors.push(`Server type ${spec.node.type} is not available.`)
    if (!int(spec.node.count) || spec.node.count < 1 || spec.node.count > LIMITS.maxNodes) errors.push(`Choose 1 to ${LIMITS.maxNodes} servers.`)
  }
  if (spec.db.mode === 'dedicated') {
    const db = priceOf(catalog, rdsCode(spec.db.class ?? ''))
    if (!db || db.kind !== 'rds' || !db.sellable) errors.push(`Database size ${spec.db.class} is not available.`)
    if (!int(spec.db.storageGb) || spec.db.storageGb < LIMITS.minStorageGb || spec.db.storageGb > LIMITS.maxStorageGb) {
      errors.push(`Database storage must be ${LIMITS.minStorageGb}–${LIMITS.maxStorageGb} GB.`)
    }
    const cur = opts.current
    if (cur?.db.mode === 'dedicated' && spec.db.storageGb < cur.db.storageGb) {
      errors.push(`Database storage can only grow (it is ${cur.db.storageGb} GB now).`)
    }
  } else if (spec.db.mode === 'node') {
    // The disk under the server's Postgres: Basic's 10 GB, every other size at least 20 GB.
    const min = plan.minPreset === 'basic' ? PRESETS.basic.spec.db.storageGb : LIMITS.minStorageGb
    if (!int(spec.db.storageGb) || spec.db.storageGb < min || spec.db.storageGb > LIMITS.maxStorageGb) {
      errors.push(`Database disk must be ${min}–${LIMITS.maxStorageGb} GB.`)
    }
    const cur = opts.current
    if (cur?.db.mode === 'node' && spec.db.storageGb < cur.db.storageGb) {
      errors.push(`Database disk can only grow (it is ${cur.db.storageGb} GB now).`)
    }
  }
  if (spec.db.mode !== 'dedicated' && spec.db.multiAz) errors.push('A standby database needs your own database.')

  for (const k of namesFor(plan.slug)) {
    const s = spec.services[k]
    if (!int(s.replicas) || !int(s.maxReplicas) || s.replicas < 1 || s.maxReplicas < s.replicas || s.maxReplicas > LIMITS.maxReplicas) {
      errors.push(`${k}: copies must be 1–${LIMITS.maxReplicas}, and the autoscale limit at least that.`)
    }
    if (!POD_SIZES.includes(s.size)) errors.push(`${k}: unknown size ${s.size}.`)
  }
  if (errors.length) return { ok: false, errors, fit: null }

  const fit = fitOf(spec, catalog, plan.slug)
  errors.push(...serverFitErrors(spec, catalog, plan.slug, fit))
  if (fit.db.poolPerPod < DB_POOL_MIN) {
    errors.push(
      spec.db.mode === 'node'
        ? `The database on your server allows ${fit.db.maxConnections} connections, too few for ${fit.db.pods} service copies. Choose fewer copies or a dedicated database.`
        : `The database allows ${fit.db.maxConnections} connections, too few for ${fit.db.pods} service copies. Choose a bigger database or fewer copies.`
    )
  }
  return { ok: errors.length === 0, errors, fit }
}

/** The smallest sellable server the spec fits on, for "choose a bigger server". */
export function smallestFittingNode(spec: ComputeSpec, catalog: Catalog, plan?: string | null): string | null {
  // Cheapest that fits, then the smaller one: an r7g.large beats a t4g.xlarge for a memory-bound store.
  const types = catalog.prices
    .filter(p => p.kind === 'ec2' && p.sellable)
    .sort((a, b) => (a.usdHourly ?? Infinity) - (b.usdHourly ?? Infinity) || (a.memoryMib ?? 0) - (b.memoryMib ?? 0) || a.sort - b.sort)
  for (const t of types) {
    const f = fitOf({ ...spec, node: { ...spec.node, type: t.code.slice(4) } }, catalog, plan)
    if (f.memory.requestedMib <= f.memory.allocatableMib && f.cpu.requestedMilli <= f.cpu.allocatableMilli) return t.code.slice(4)
  }
  return null
}

/** The smallest server type the spec fits on, adding servers (up to LIMITS.maxNodes) when no single type does; null when nothing fits. */
export function fittingServers(spec: ComputeSpec, catalog: Catalog, plan?: string | null): { type: string; count: number } | null {
  for (let count = Math.max(1, spec.node.count); count <= LIMITS.maxNodes; count++) {
    const type = smallestFittingNode({ ...spec, node: { ...spec.node, count } }, catalog, plan)
    if (type) return { type, count }
  }
  return null
}
