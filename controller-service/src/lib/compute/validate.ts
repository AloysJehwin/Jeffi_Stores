import { DB_POOL_CAP, DB_POOL_MIN, DB_RESERVED_CONNECTIONS, POD_RESOURCES, REDIS_RESOURCES, dbMaxConnections, presetOf } from './presets'
import { POD_SIZES, SERVICE_NAMES, ec2Code, priceOf, rdsCode, type Catalog, type ComputeSpec, type PlanCompute } from './spec'

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

// The two busiest moments: every service scaled out, or a release rolling one extra copy of each.
const states = (spec: ComputeSpec) => [
  (k: (typeof SERVICE_NAMES)[number]) => spec.services[k].maxReplicas,
  (k: (typeof SERVICE_NAMES)[number]) => spec.services[k].replicas + 1,
]

/** Most pods the store runs at once. */
export const peakPods = (spec: ComputeSpec) => Math.max(...states(spec).map(count => SERVICE_NAMES.reduce((n, k) => n + count(k), 0)))

/** Requests at the busiest moment, Redis included. */
function requested(spec: ComputeSpec) {
  let cpu = 0
  let mem = 0
  for (const count of states(spec)) {
    let c = milli(REDIS_RESOURCES.requests.cpu)
    let m = mib(REDIS_RESOURCES.requests.memory)
    for (const k of SERVICE_NAMES) {
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
export function dbBudget(spec: ComputeSpec, catalog: Catalog) {
  const s = catalog.settings
  const maxConnections =
    spec.db.mode === 'shared'
      ? Math.floor((s.sharedDbMaxConnections - DB_RESERVED_CONNECTIONS) / s.sharedDbCapacity)
      : dbMaxConnections(spec.db.class ?? '', priceOf(catalog, rdsCode(spec.db.class ?? ''))?.memoryMib ?? null) - DB_RESERVED_CONNECTIONS
  const pods = peakPods(spec)
  return { pods, maxConnections, poolPerPod: Math.min(DB_POOL_CAP, Math.floor(maxConnections / pods)) }
}

export function fitOf(spec: ComputeSpec, catalog: Catalog): Fit {
  const req = requested(spec)
  const node = spec.node.placement === 'dedicated' ? priceOf(catalog, ec2Code(spec.node.type ?? '')) : undefined
  const count = spec.node.placement === 'dedicated' ? spec.node.count : 1
  return {
    cpu: { requestedMilli: req.cpu, allocatableMilli: node ? ((node.vcpu ?? 0) * 1000 - NODE_RESERVED_MILLI) * count : 0 },
    memory: { requestedMib: req.mem, allocatableMib: node ? ((node.memoryMib ?? 0) - NODE_RESERVED_MIB) * count : 0 },
    db: dbBudget(spec, catalog),
    vcpus: node ? (node.vcpu ?? 0) * count : 0,
  }
}

const int = (n: unknown) => typeof n === 'number' && Number.isInteger(n)

/** Why a spec can't be chosen on this plan at all (wrong kind of server, or custom on a presets-only plan). */
export function planCompatibilityError(spec: ComputeSpec, plan: PlanCompute): string | null {
  const preset = presetOf(spec)
  if (plan.minPlacement === 'pool') return preset === 'shared' ? null : 'This plan runs on shared servers. Choose a higher plan for your own server.'
  if (spec.node.placement !== 'dedicated' || spec.db.mode !== 'dedicated') return 'This plan includes your own server and database.'
  if (!plan.advanced && preset === 'custom') return 'Choose one of the sizes; custom settings need a higher plan.'
  return null
}

/**
 * Whether a spec can be chosen on this plan and actually runs: the pods fit the server, the database has
 * connections for every pod, and storage only grows. Messages are shown to the store owner.
 */
export function validateSpec(spec: ComputeSpec, catalog: Catalog, plan: PlanCompute, opts: { current?: ComputeSpec | null } = {}): Validation {
  const errors: string[] = []
  if (!spec?.node || !spec?.db || !spec?.services || SERVICE_NAMES.some(k => !spec.services[k])) {
    return { ok: false, errors: ['Incomplete compute choice.'], fit: null }
  }
  const planError = planCompatibilityError(spec, plan)
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
  } else if (spec.db.multiAz) {
    errors.push('A standby database needs your own database.')
  }

  for (const k of SERVICE_NAMES) {
    const s = spec.services[k]
    if (!int(s.replicas) || !int(s.maxReplicas) || s.replicas < 1 || s.maxReplicas < s.replicas || s.maxReplicas > LIMITS.maxReplicas) {
      errors.push(`${k}: copies must be 1–${LIMITS.maxReplicas}, and the autoscale limit at least that.`)
    }
    if (!POD_SIZES.includes(s.size)) errors.push(`${k}: unknown size ${s.size}.`)
  }
  if (errors.length) return { ok: false, errors, fit: null }

  const fit = fitOf(spec, catalog)
  if (spec.node.placement === 'dedicated') {
    if (fit.memory.requestedMib > fit.memory.allocatableMib) {
      errors.push(`The services need ${fit.memory.requestedMib} MB of memory; the server has ${fit.memory.allocatableMib} MB. Choose a bigger server or fewer copies.`)
    }
    if (fit.cpu.requestedMilli > fit.cpu.allocatableMilli) {
      errors.push(`The services need ${fit.cpu.requestedMilli / 1000} vCPU; the server has ${fit.cpu.allocatableMilli / 1000}. Choose a bigger server or fewer copies.`)
    }
  }
  if (fit.db.poolPerPod < DB_POOL_MIN) {
    errors.push(`The database allows ${fit.db.maxConnections} connections, too few for ${fit.db.pods} service copies. Choose a bigger database or fewer copies.`)
  }
  return { ok: errors.length === 0, errors, fit }
}

/** The smallest sellable server the spec fits on, for "choose a bigger server". */
export function smallestFittingNode(spec: ComputeSpec, catalog: Catalog): string | null {
  const types = catalog.prices.filter(p => p.kind === 'ec2' && p.sellable).sort((a, b) => (a.memoryMib ?? 0) - (b.memoryMib ?? 0) || a.sort - b.sort)
  for (const t of types) {
    const f = fitOf({ ...spec, node: { ...spec.node, type: t.code.slice(4) } }, catalog)
    if (f.memory.requestedMib <= f.memory.allocatableMib && f.cpu.requestedMilli <= f.cpu.allocatableMilli) return t.code.slice(4)
  }
  return null
}
