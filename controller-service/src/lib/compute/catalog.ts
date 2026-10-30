import 'server-only'
import { controlPlanePool } from '@/lib/tenant-registry'
import type { Catalog, PlanCompute, PresetKey, PriceRow, PricingSettings } from './spec'

// Prices and settings the calculator reads (compute_prices + platform_infra 'compute_pricing'), cached a minute.

export const DEFAULT_SETTINGS: PricingSettings = {
  usdInr: 88,
  margin: 0.25,
  gstRate: 0.18,
  platformShareUsd: 3,
  rootVolumeGb: 20,
  poolNodeType: 't4g.medium',
  poolCapacity: 4,
  sharedDbClass: 'db.t4g.small',
  sharedDbCapacity: 8,
  sharedDbStorageGb: 10,
  sharedDbMaxConnections: 200,
  minPrepayDays: 30,
  graceDays: 3,
}

const num = (v: unknown) => (v == null ? null : Number(v))
let cache: { at: number; catalog: Catalog } | null = null

export async function getCatalog(): Promise<Catalog> {
  if (cache && Date.now() - cache.at < 60_000) return cache.catalog
  const pool = controlPlanePool()
  const [prices, settings] = await Promise.all([
    pool.query(`SELECT * FROM compute_prices ORDER BY sort, code`),
    pool.query<{ value: string }>(`SELECT value FROM platform_infra WHERE key = 'compute_pricing'`),
  ])
  let stored: Partial<PricingSettings> = {}
  try {
    stored = JSON.parse(settings.rows[0]?.value ?? '{}')
  } catch {
    stored = {}
  }
  const catalog: Catalog = {
    prices: prices.rows.map(
      (r): PriceRow => ({
        code: r.code,
        kind: r.kind,
        label: r.label,
        vcpu: num(r.vcpu),
        memoryMib: num(r.memory_mib),
        usdHourly: num(r.usd_hourly),
        usdHourlyMultiAz: num(r.usd_hourly_multi_az),
        usdGbMonth: num(r.usd_gb_month),
        usdGbMonthMultiAz: num(r.usd_gb_month_multi_az),
        sellable: r.sellable,
        sort: r.sort,
      })
    ),
    settings: { ...DEFAULT_SETTINGS, ...stored },
  }
  cache = { at: Date.now(), catalog }
  return catalog
}

export function clearCatalogCache() {
  cache = null
}

export interface PlanOption extends PlanCompute {
  name: string
  tier: number
  monthlyPriceInr: number
}

/** Store plans with what each lets the owner choose. Inactive plans only when asked (Starter until it launches). */
export async function computePlans(opts: { includeInactive?: boolean } = {}): Promise<PlanOption[]> {
  const r = await controlPlanePool().query(
    `SELECT slug, name, tier, monthly_price_inr, default_preset, min_placement, advanced_compute
       FROM plans WHERE product = 'store' ${opts.includeInactive ? '' : 'AND is_active = true'} ORDER BY tier`
  )
  return r.rows.map(p => ({
    slug: p.slug,
    name: p.name,
    tier: p.tier,
    monthlyPriceInr: Number(p.monthly_price_inr),
    defaultPreset: (p.default_preset as PresetKey | null) ?? null,
    minPlacement: p.min_placement,
    advanced: p.advanced_compute,
  }))
}

export async function planCompute(slug: string): Promise<PlanOption | null> {
  return (await computePlans({ includeInactive: true })).find(p => p.slug === slug) ?? null
}

/** Whether the configurable-compute flow is on (onboarding step, owner page). Off until provisioning reads the spec. */
export const computeSpecEnabled = () => process.env.COMPUTE_SPEC_ENABLED === 'true'
