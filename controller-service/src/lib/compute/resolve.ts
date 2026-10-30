import 'server-only'
import { controlPlanePool } from '@/lib/tenant-registry'
import { DEFAULT_SETTINGS, computeSpecEnabled, getCatalog } from './catalog'
import { legacySpecFor } from './legacy'
import { quoteSpec } from './pricing'
import { getTenantCompute } from './store'
import { dbBudget } from './validate'
import { dbMaxConnections, presetOf } from './presets'
import { priceOf, rdsCode, type Catalog, type ComputeSpec } from './spec'

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

export function computeParams(spec: ComputeSpec, catalog: Catalog) {
  const cls = spec.db.class ?? ''
  return {
    dbPoolMax: Math.max(2, dbBudget(spec, catalog).poolPerPod),
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
  const spec = opts.spec ?? chosen ?? legacySpecFor(plan)
  return { spec, ...computeParams(spec, await catalogOrDefault()), nodeGen: row?.node_gen ?? 0 }
}

/** The spec's price per hour (margin included, GST not); null when a part has no price. */
export async function rateFor(spec: ComputeSpec): Promise<number | null> {
  try {
    return Math.round(quoteSpec(spec, await catalogOrDefault()).inrHour * 10000) / 10000
  } catch {
    return null
  }
}

/**
 * Record what now runs and its hourly rate. While owners can't choose (flag off) the choice is the plan's,
 * so `desired` follows; otherwise a choice made meanwhile stays pending.
 */
export async function markComputeApplied(tenantId: string, spec: ComputeSpec, nodeGen: number): Promise<void> {
  const rate = await rateFor(spec)
  const follow = !computeSpecEnabled()
  await controlPlanePool().query(
    `INSERT INTO tenant_compute (tenant_id, preset, desired, applied, status, rate_inr_hour, node_gen, applied_at)
     VALUES ($1, $6, $2, $2, 'applied', $3, $4, now())
     ON CONFLICT (tenant_id) DO UPDATE SET
       applied = EXCLUDED.applied, rate_inr_hour = EXCLUDED.rate_inr_hour, node_gen = EXCLUDED.node_gen, applied_at = now(),
       desired = CASE WHEN $5 THEN EXCLUDED.applied ELSE tenant_compute.desired END,
       preset = CASE WHEN $5 THEN EXCLUDED.preset ELSE tenant_compute.preset END,
       status = CASE WHEN $5 OR tenant_compute.desired = EXCLUDED.applied THEN 'applied' ELSE 'pending' END,
       attempts = 0, last_error = NULL, updated_at = now()`,
    [tenantId, JSON.stringify(spec), rate, nodeGen, follow, presetOf(spec)]
  )
}
