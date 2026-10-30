// A store's compute: where it runs, its database, and each service's pods. Stored in
// tenant_compute.desired / .applied; priced by pricing.ts and checked by validate.ts.

export const SERVICE_NAMES = ['storefront', 'admin', 'business', 'messaging', 'documents'] as const
export type ServiceName = (typeof SERVICE_NAMES)[number]

// controller: the store runs the old all-in-one {slug}-controller-service; services: storefront, admin
// and business each run on their own (service-roles.ts). Set only on what runs (applied), never chosen.
export type StoreLayout = 'controller' | 'services'

export type PodSize = 'S' | 'M' | 'L'
export const POD_SIZES: PodSize[] = ['S', 'M', 'L']

export interface ServiceSpec {
  replicas: number
  maxReplicas: number
  size: PodSize
}

export interface ComputeSpec {
  // pool: a share of a node with other Starter stores; dedicated: the store's own node(s).
  node: { placement: 'pool' | 'dedicated'; type: string | null; count: number }
  // shared: a database on a server shared with other Starter stores; dedicated: its own RDS.
  db: { mode: 'shared' | 'dedicated'; class: string | null; storageGb: number; multiAz: boolean }
  services: Record<ServiceName, ServiceSpec>
  layout?: StoreLayout
}

export type PresetKey = 'shared' | 'small' | 'medium' | 'large' | 'xlarge'
export type Placement = 'pool' | 'dedicated'

/** What a plan lets its owner choose (plans.default_preset / min_placement / advanced_compute). */
export interface PlanCompute {
  slug: string
  defaultPreset: PresetKey | null
  minPlacement: Placement
  advanced: boolean
}

export interface PriceRow {
  code: string
  kind: 'ec2' | 'rds' | 'rds_storage' | 'ebs'
  label: string
  vcpu: number | null
  memoryMib: number | null
  usdHourly: number | null
  usdHourlyMultiAz: number | null
  usdGbMonth: number | null
  usdGbMonthMultiAz: number | null
  sellable: boolean
  sort: number
}

export interface PricingSettings {
  usdInr: number
  margin: number
  gstRate: number
  platformShareUsd: number
  rootVolumeGb: number
  poolNodeType: string
  poolCapacity: number
  sharedDbClass: string
  sharedDbCapacity: number
  sharedDbStorageGb: number
  sharedDbMaxConnections: number
  minPrepayDays: number
  graceDays: number
}

export interface Catalog {
  prices: PriceRow[]
  settings: PricingSettings
}

export const HOURS_PER_MONTH = 730

export const ec2Code = (type: string) => `ec2:${type}`
export const rdsCode = (cls: string) => `rds:${cls}`

export function priceOf(catalog: Catalog, code: string): PriceRow | undefined {
  return catalog.prices.find(p => p.code === code)
}

/** Deep copy, so presets and stored specs are never edited in place. */
export const cloneSpec = (s: ComputeSpec): ComputeSpec => JSON.parse(JSON.stringify(s))

/** A stored spec in today's shape: one from before the split had a single `controller` service. */
export function normalizeSpec(raw: any): ComputeSpec {
  const s = JSON.parse(JSON.stringify(raw))
  const ctrl = s?.services?.controller
  if (ctrl) {
    s.services.storefront ??= ctrl
    s.services.admin ??= { replicas: 1, maxReplicas: 1, size: ctrl.size }
    s.services.business ??= { replicas: 1, maxReplicas: 1, size: 'S' }
    delete s.services.controller
    s.layout ??= 'controller'
  }
  return s
}

/** The business portal ({slug}.business host) is sold from Pro; other plans run no business service. */
export const hasBusinessPortal = (plan: string | null | undefined) => plan === 'pro' || plan === 'enterprise'

/** The services a store on this plan runs. */
export const activeServices = (plan: string | null | undefined): ServiceName[] =>
  SERVICE_NAMES.filter(n => n !== 'business' || hasBusinessPortal(plan))
