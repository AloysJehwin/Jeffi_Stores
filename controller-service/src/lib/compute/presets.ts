import { SERVICE_NAMES, cloneSpec, type ComputeSpec, type PodSize, type PresetKey, type ServiceName, type ServiceSpec } from './spec'

// Pod sizes per service. Limits are the per-plan tiers' from before compute was configurable; requests are
// baseline use, since t4g servers burst above their share (they decide how many copies fit on a server).
type Resources = { requests: { cpu: string; memory: string }; limits: { cpu: string; memory: string } }
const r = (cpu: string, mem: string, limCpu: string, limMem: string): Resources => ({
  requests: { cpu, memory: mem },
  limits: { cpu: limCpu, memory: limMem },
})

export const POD_RESOURCES: Record<ServiceName, Record<PodSize, Resources>> = {
  controller: { S: r('150m', '384Mi', '1', '640Mi'), M: r('200m', '512Mi', '1500m', '900Mi'), L: r('300m', '768Mi', '2', '1200Mi') },
  messaging: { S: r('25m', '128Mi', '300m', '256Mi'), M: r('50m', '160Mi', '500m', '384Mi'), L: r('75m', '192Mi', '1', '448Mi') },
  documents: { S: r('25m', '160Mi', '500m', '384Mi'), M: r('50m', '224Mi', '1', '512Mi'), L: r('100m', '256Mi', '1500m', '640Mi') },
}

// Every store also runs a small Redis.
export const REDIS_RESOURCES = r('10m', '24Mi', '100m', '96Mi')

const svc = (replicas: number, maxReplicas: number, size: PodSize): ServiceSpec => ({ replicas, maxReplicas, size })
const all = (s: ServiceSpec) => Object.fromEntries(SERVICE_NAMES.map(n => [n, { ...s }])) as Record<ServiceName, ServiceSpec>

export interface Preset {
  key: PresetKey
  label: string
  blurb: string
  spec: ComputeSpec
}

export const PRESETS: Record<PresetKey, Preset> = {
  shared: {
    key: 'shared',
    label: 'Shared',
    blurb: 'A share of a server and database with other new stores.',
    spec: {
      node: { placement: 'pool', type: null, count: 1 },
      db: { mode: 'shared', class: null, storageGb: 10, multiAz: false },
      services: all(svc(1, 1, 'S')),
    },
  },
  small: {
    key: 'small',
    label: 'Small',
    blurb: 'Your own server and database, for a store getting started.',
    spec: {
      node: { placement: 'dedicated', type: 't4g.small', count: 1 },
      db: { mode: 'dedicated', class: 'db.t4g.micro', storageGb: 20, multiAz: false },
      services: all(svc(1, 1, 'S')),
    },
  },
  medium: {
    key: 'medium',
    label: 'Medium',
    blurb: 'Two copies of every service, so a restart never takes the store down.',
    spec: {
      node: { placement: 'dedicated', type: 't4g.medium', count: 1 },
      db: { mode: 'dedicated', class: 'db.t4g.small', storageGb: 20, multiAz: false },
      services: { controller: svc(2, 3, 'M'), messaging: svc(2, 2, 'M'), documents: svc(2, 2, 'M') },
    },
  },
  large: {
    key: 'large',
    label: 'Large',
    blurb: 'For busy stores: scales the storefront up to five copies under load.',
    spec: {
      node: { placement: 'dedicated', type: 't4g.large', count: 1 },
      db: { mode: 'dedicated', class: 'db.t4g.medium', storageGb: 50, multiAz: false },
      services: { controller: svc(2, 5, 'L'), messaging: svc(2, 2, 'L'), documents: svc(2, 2, 'L') },
    },
  },
  xlarge: {
    key: 'xlarge',
    label: 'X-Large',
    blurb: 'High traffic and large catalogues.',
    spec: {
      node: { placement: 'dedicated', type: 't4g.xlarge', count: 1 },
      db: { mode: 'dedicated', class: 'db.t4g.large', storageGb: 100, multiAz: false },
      services: { controller: svc(3, 8, 'L'), messaging: svc(3, 3, 'L'), documents: svc(3, 3, 'L') },
    },
  },
}

export const DEDICATED_PRESETS: PresetKey[] = ['small', 'medium', 'large', 'xlarge']

export const presetSpec = (key: PresetKey): ComputeSpec => cloneSpec(PRESETS[key].spec)

/** A second node and a standby database in another zone. */
export function withHighAvailability(spec: ComputeSpec): ComputeSpec {
  const s = cloneSpec(spec)
  if (s.node.placement === 'dedicated') s.node.count = Math.max(2, s.node.count)
  if (s.db.mode === 'dedicated') s.db.multiAz = true
  return s
}

// Field order fixed, so a spec read back from jsonb (which reorders keys) compares equal.
export function specKey(s: ComputeSpec): string {
  const n = s.node
  const d = s.db
  const svcs = SERVICE_NAMES.map(k => `${k}:${s.services[k]?.replicas}/${s.services[k]?.maxReplicas}/${s.services[k]?.size}`)
  return [n.placement, n.type ?? '', n.count, d.mode, d.class ?? '', d.storageGb, d.multiAz ? 1 : 0, ...svcs].join('|')
}

/** The preset a spec is, or 'custom'. High availability on a preset still counts as that preset. */
export function presetOf(spec: ComputeSpec): PresetKey | 'custom' {
  const k = specKey(spec)
  for (const p of Object.values(PRESETS)) {
    if (k === specKey(p.spec) || k === specKey(withHighAvailability(p.spec))) return p.key
  }
  return 'custom'
}

// Postgres max_connections set on a store's own database, by class. Others: memory / 16.
const DB_MAX_CONNECTIONS: Record<string, number> = {
  'db.t4g.micro': 60,
  'db.t4g.small': 120,
  'db.t4g.medium': 250,
  'db.t4g.large': 500,
}

export const dbMaxConnections = (cls: string, memoryMib: number | null) => DB_MAX_CONNECTIONS[cls] ?? Math.floor((memoryMib ?? 1024) / 16)

/** Per-pod database pool: connections are shared by every pod at its scaled-out count. */
export const DB_POOL_CAP = 15
export const DB_POOL_MIN = 3
export const DB_RESERVED_CONNECTIONS = 10
