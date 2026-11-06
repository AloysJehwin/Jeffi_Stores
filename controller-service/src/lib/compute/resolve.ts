import 'server-only'
import { controlPlanePool } from '@/lib/tenant-registry'
import { DEFAULT_SETTINGS, computeSpecEnabled, getCatalog } from './catalog'
import { legacySpecFor } from '@/lib/compute/legacy'
import { pausedInrHour, quoteSpec, type PlanMargins } from './pricing'
import { getTenantCompute } from './store'
import { dbBudget } from '@/lib/compute/validate'
import { dbMaxConnections, presetOf } from '@/lib/compute/presets'
import { normalizeSpec, priceOf, rdsCode, type Catalog, type ComputeSpec, type StoreLayout } from '@/lib/compute/spec'

export interface ResolvedCompute {
  spec: ComputeSpec
  /** Per-pod database pool for every store pod (DB_POOL_MAX). */
  dbPoolMax: number
  /** Postgres max_connections for the store's own database. */
  maxConnections: number
  /** Generation of the store's own servers; a server type change starts the next one. */
  nodeGen: number
}

// Provisioning must not stop on a price read, so a missing catalog falls back to the class table.
export const catalogOrDefault = (): Promise<Catalog> => getCatalog().catch(() => ({ prices: [], settings: DEFAULT_SETTINGS }))

export function computeParams(spec: ComputeSpec, catalog: Catalog, plan?: string | null) {
  const cls = spec.db.class ?? ''
  return {
    dbPoolMax: Math.max(2, dbBudget(spec, catalog, plan).poolPerPod),
    maxConnections: dbMaxConnections(cls, priceOf(catalog, rdsCode(cls))?.memoryMib ?? null),
  }
}

/**
 * The compute a store runs or is being built with. With COMPUTE_SPEC_ENABLED it is the store's own
 * choice (`desired` while provisioning or resizing, `applied` to re-apply what runs); otherwise the
 * plan's tier, as before compute was configurable. `spec` pins one already chosen (a provisioning job).
 */
export async function resolveCompute(
  tenantId: string,
  plan: string | null,
  opts: { which?: 'desired' | 'applied'; spec?: ComputeSpec } = {}
): Promise<ResolvedCompute> {
  const row = await getTenantCompute(tenantId).catch(() => null)
  const chosen =
    computeSpecEnabled() && row ? (opts.which === 'applied' ? (row.applied ?? row.desired) : (row.desired ?? row.applied)) : null
  // Rendered as the store runs now: only reconcileLayout moves a store off the old all-in-one app. A new store
  // starts on its own services.
  const layout: StoreLayout = row?.applied ? (row.applied.layout ?? 'controller') : 'services'
  const spec = { ...(opts.spec ? normalizeSpec(opts.spec) : (chosen ?? legacySpecFor(plan))), layout }
  return { spec, ...computeParams(spec, await catalogOrDefault(), plan), nodeGen: row?.node_gen ?? 0 }
}

/** The spec's price per hour at the plan's margin for its database mode (the global one when no plan is given); no GST or plan fee. Null when a part has no price. */
export async function rateFor(spec: ComputeSpec, plan?: PlanMargins): Promise<number | null> {
  try {
    return Math.round(quoteSpec(spec, await catalogOrDefault(), plan).inrHour * 10000) / 10000
  } catch {
    return null
  }
}

/** The tenant's plan margins for rateFor, which picks one by the spec's database; {} (the catalog's) when its plan has none or can't be read. */
export async function tenantPlanMargin(tenantId: string): Promise<PlanMargins> {
  try {
    const r = await controlPlanePool().query<{ m: string | null; rds: string | null }>(
      `SELECT p.infra_margin AS m, p.rds_margin AS rds FROM tenants t JOIN plans p ON p.id = t.plan_id WHERE t.id = $1`,
      [tenantId]
    )
    const row = r.rows[0]
    if (!row) return {}
    const out: PlanMargins = {}
    if (row.m != null) out.infraMargin = Number(row.m)
    if (row.rds != null) out.rdsMargin = Number(row.rds)
    return out
  } catch {
    return {}
  }
}

/** What the spec still costs per hour while the store is paused; null when a part has no price. */
export async function pausedRateFor(spec: ComputeSpec, plan?: PlanMargins): Promise<number | null> {
  try {
    return pausedInrHour(spec, await catalogOrDefault(), plan)
  } catch {
    return null
  }
}

/**
 * Record what now runs and its hourly rate. While owners can't choose (flag off) the choice is the plan's,
 * so `desired` follows; otherwise a choice made meanwhile stays pending.
 */
export async function markComputeApplied(tenantId: string, spec: ComputeSpec, nodeGen: number): Promise<void> {
  const rate = await rateFor(spec, await tenantPlanMargin(tenantId))
  const follow = !computeSpecEnabled()
  await controlPlanePool().query(
    `INSERT INTO tenant_compute (tenant_id, preset, desired, applied, status, rate_inr_hour, node_gen, applied_at)
     VALUES ($1, $6, $2, $2, 'applied', $3, $4, now())
     ON CONFLICT (tenant_id) DO UPDATE SET
       applied = EXCLUDED.applied, rate_inr_hour = EXCLUDED.rate_inr_hour, node_gen = EXCLUDED.node_gen, applied_at = now(),
       desired = CASE WHEN $5 THEN EXCLUDED.applied ELSE tenant_compute.desired END,
       preset = CASE WHEN $5 THEN EXCLUDED.preset ELSE tenant_compute.preset END,
       status = CASE WHEN $5 OR (tenant_compute.desired - 'layout') = (EXCLUDED.applied - 'layout') THEN 'applied' ELSE 'pending' END,
       attempts = 0, last_error = NULL, updated_at = now()`,
    [tenantId, JSON.stringify(spec), rate, nodeGen, follow, presetOf(spec)]
  )
}
