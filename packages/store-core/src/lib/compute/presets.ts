import { SERVICE_NAMES, cloneSpec, type ComputeSpec, type PodSize, type PresetKey, type ServiceName, type ServiceSpec } from './spec'

// Pod sizes per service. Limits are the per-plan tiers' from before compute was configurable; requests are
// baseline use, since t4g servers burst above their share (they decide how many copies fit on a server).
type Resources = { requests: { cpu: string; memory: string }; limits: { cpu: string; memory: string } }
const r = (cpu: string, mem: string, limCpu: string, limMem: string): Resources => ({
  requests: { cpu, memory: mem },
  limits: { cpu: limCpu, memory: limMem },
})

export const POD_RESOURCES: Record<ServiceName, Record<PodSize, Resources>> = {
  storefront: { S: r('150m', '384Mi', '1', '640Mi'), M: r('200m', '512Mi', '1500m', '900Mi'), L: r('300m', '768Mi', '2', '1200Mi') },
  admin: { S: r('150m', '384Mi', '1', '640Mi'), M: r('200m', '512Mi', '1500m', '900Mi'), L: r('300m', '768Mi', '2', '1200Mi') },
  business: { S: r('100m', '256Mi', '1', '512Mi'), M: r('150m', '384Mi', '1500m', '640Mi'), L: r('200m', '512Mi', '2', '900Mi') },
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

// Basic runs Postgres on the same EC2 node. The 'basic' plan activates storefront/admin/messaging/
// documents only — the business portal is Pro-and-up. The Record<ServiceName,…> type still needs
// every key, so inactive services get the same {1,1,'S'} baseline the plan never activates.
const basicServices = (): Record<ServiceName, ServiceSpec> => all(svc(1, 1, 'S'))

export const PRESETS: Record<PresetKey, Preset> = {
  shared: {
    key: 'shared',
    label: 'Shared',
    blurb: 'A share of a server and database with other new stores.',
    spec: {
      node: { placement: 'pool', type: null, count: 1 },
      db: { mode: 'shared', class: null, storageGb: 10, multiAz: false },
      services: all(svc(1, 1, 'S')),
      storage: { s3Gb: 10 },
    },
  },
  basic: {
    key: 'basic',
    label: 'Basic',
    blurb: 'Own server with its own PostgreSQL — nightly backups to S3.',
    spec: {
      node: { placement: 'dedicated', type: 't4g.small', count: 1 },
      db: { mode: 'node', class: null, storageGb: 10, multiAz: false },
      services: basicServices(),
      storage: { s3Gb: 10 },
    },
  },
  small: {
    key: 'small',
    label: 'Small',
    blurb: 'Your own server and database, for a store getting started.',
    spec: {
      node: { placement: 'dedicated', type: 't4g.small', count: 1 },
      db: { mode: 'node', class: null, storageGb: 20, multiAz: false },
      // A second storefront copy takes the room a rollout needs anyway.
      services: { ...all(svc(1, 1, 'S')), storefront: svc(1, 2, 'S') },
      storage: { s3Gb: 20 },
    },
  },
  medium: {
    key: 'medium',
    label: 'Medium',
    blurb: 'Two copies of the storefront, so a restart never takes the store down.',
    spec: {
      node: { placement: 'dedicated', type: 't4g.medium', count: 1 },
      db: { mode: 'node', class: null, storageGb: 20, multiAz: false },
      services: { storefront: svc(2, 3, 'M'), admin: svc(1, 1, 'S'), business: svc(1, 1, 'S'), messaging: svc(2, 2, 'M'), documents: svc(2, 2, 'M') },
      storage: { s3Gb: 20 },
    },
  },
  large: {
    key: 'large',
    label: 'Large',
    blurb: 'For busy stores: scales the storefront up to four copies under load.',
    spec: {
      node: { placement: 'dedicated', type: 't4g.large', count: 1 },
      db: { mode: 'node', class: null, storageGb: 50, multiAz: false },
      services: { storefront: svc(2, 4, 'L'), admin: svc(1, 1, 'M'), business: svc(1, 1, 'S'), messaging: svc(2, 2, 'L'), documents: svc(2, 2, 'L') },
      storage: { s3Gb: 50 },
    },
  },
  xlarge: {
    key: 'xlarge',
    label: 'X-Large',
    blurb: 'High traffic and large catalogues.',
    spec: {
      node: { placement: 'dedicated', type: 't4g.xlarge', count: 1 },
      db: { mode: 'node', class: null, storageGb: 100, multiAz: false },
      services: { storefront: svc(3, 8, 'L'), admin: svc(2, 2, 'M'), business: svc(1, 2, 'S'), messaging: svc(3, 3, 'L'), documents: svc(3, 3, 'L') },
      storage: { s3Gb: 100 },
    },
  },
}

export const DEDICATED_PRESETS: PresetKey[] = ['small', 'medium', 'large', 'xlarge']
export const BASIC_PRESET: PresetKey[] = ['basic']

/** Stepped visitor-per-month bands shown in the traffic slider. */
export const TRAFFIC_BANDS: number[] = [1_000, 2_000, 5_000, 10_000, 25_000, 50_000, 100_000, 250_000, 500_000, 1_000_000, 2_000_000]

// Band thresholds → preset. ≤10k=small, ≤50k=medium, ≤250k=large, ≤1M=xlarge, >1M=xlarge+HA.
const BAND_PRESET_RANK: { max: number; key: Exclude<PresetKey, 'shared' | 'basic'> }[] = [
  { max: 10_000, key: 'small' },
  { max: 50_000, key: 'medium' },
  { max: 250_000, key: 'large' },
  { max: 1_000_000, key: 'xlarge' },
]

function bandPreset(visitorsPerMonth: number): Exclude<PresetKey, 'shared' | 'basic'> {
  for (const b of BAND_PRESET_RANK) if (visitorsPerMonth <= b.max) return b.key
  return 'xlarge'
}

const DEDICATED_RANK: Record<Exclude<PresetKey, 'shared'>, number> = { basic: 0, small: 1, medium: 2, large: 3, xlarge: 4 }

/**
 * The recommended spec for a plan at a traffic estimate: at least the plan's minPreset floor, and at least
 * the band for the chosen visitors/month. Above 1M visitors, applies high availability. Basic is a fixed
 * shape; it ignores traffic.
 */
export function recommendSpec(planSlug: string, visitorsPerMonth: number, plan: { minPreset?: PresetKey } | null): ComputeSpec {
  const floor = plan?.minPreset ?? 'small'
  if (floor === 'basic') return presetSpec('basic')
  const band = bandPreset(visitorsPerMonth)
  const floorRank = DEDICATED_RANK[floor as Exclude<PresetKey, 'shared'>] ?? 1
  const bandRank = DEDICATED_RANK[band]
  const key: Exclude<PresetKey, 'shared' | 'basic'> =
    (floorRank >= bandRank ? (floor as Exclude<PresetKey, 'shared' | 'basic'>) : band)
  const spec = presetSpec(key)
  return visitorsPerMonth > 1_000_000 ? withHighAvailability(spec) : spec
}

/** The band key for a visitor-per-month estimate, for "Recommended" marks on the size cards. */
export function recommendedPresetKey(planSlug: string, visitorsPerMonth: number, plan: { minPreset?: PresetKey } | null): Exclude<PresetKey, 'shared' | 'basic'> {
  const floor = plan?.minPreset ?? 'small'
  if (floor === 'basic') return 'small'
  const band = bandPreset(visitorsPerMonth)
  const floorRank = DEDICATED_RANK[floor as Exclude<PresetKey, 'shared'>] ?? 1
  const bandRank = DEDICATED_RANK[band]
  return floorRank >= bandRank ? (floor as Exclude<PresetKey, 'shared' | 'basic'>) : band
}

/** presetSpec clones the preset's spec; shared defaults s3Gb to 10 if the preset entry is missing it. */
export const presetSpec = (key: PresetKey): ComputeSpec => {
  const s = cloneSpec(PRESETS[key].spec)
  if (!s.storage) s.storage = { s3Gb: key === 'shared' ? 10 : (PRESETS[key].spec.storage?.s3Gb ?? 10) }
  return s
}

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
  const s3 = s.storage?.s3Gb ?? 0
  return [n.placement, n.type ?? '', n.count, d.mode, d.class ?? '', d.storageGb, d.multiAz ? 1 : 0, ...svcs, `s3:${s3}`].join('|')
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
  'db.t4g.micro': 50, // 100 ran a micro out of memory
  'db.t4g.small': 120,
  'db.t4g.medium': 250,
  'db.t4g.large': 500,
}

export const dbMaxConnections = (cls: string, memoryMib: number | null) => DB_MAX_CONNECTIONS[cls] ?? Math.floor((memoryMib ?? 1024) / 16)

/** Per-pod database pool: connections are shared by every pod at its scaled-out count. */
export const DB_POOL_CAP = 15
export const DB_POOL_MIN = 3
export const DB_RESERVED_CONNECTIONS = 10
